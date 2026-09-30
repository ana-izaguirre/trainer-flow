/**
 * SPEC-004 — Qué pasa cuando el entrenador pulsa un botón.
 *
 * ┌─ AQUÍ ES DONDE EL PRINCIPIO SE HACE CUMPLIR ───────────────────────────┐
 * │ «La IA propone, el entrenador decide» no es una frase del README: son  │
 * │ estas dos comprobaciones. Si `canModifyVersion` cede, cualquiera       │
 * │ aprueba; si la máquina de estados cede, una rutina llega al cliente    │
 * │ sin que nadie la mire.                                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * El orden:
 *
 *   1. Responder el botón   → SIEMPRE, y lo primero (regla 2)
 *   2. Buscar la versión
 *   3. Autorizar            → denegado y no-existe dan la MISMA respuesta
 *   4. Consultar la máquina → ella decide qué es legal, no un `if` de aquí
 *   5. Aplicar              → y esa transición es la guarda contra el doble clic
 */
import { canModifyVersion } from '../authorization.ts';
import { describeErrors } from '../domain/draft.ts';
import { validateDraft } from '../domain/validate-draft.ts';
import type { Identity } from '../domain/identity.ts';
import { nextState } from '../domain/state-machine.ts';
import type { VersionEvent } from '../domain/state-machine.ts';
import type { VersionState } from '../domain/version.ts';
import type { ActionRepo, VersionForAction } from '../ports/action-ports.ts';
import type { GenerationTrigger } from '../ports/generation-trigger.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import type { CallbackAction } from './callback-data.ts';
import { escapeMarkdownV2 } from './format.ts';
import { buildKeyboard } from './keyboard.ts';

export interface ActionRequest {
  readonly action: CallbackAction;
  readonly versionId: string;
  readonly callbackQueryId: string;
}

export type ActionOutcome =
  /** No es su versión, o no existe. Las dos cosas responden igual. */
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'already_processed' }
  | {
      readonly kind: 'invalid_action';
      readonly state: VersionState;
      readonly action: CallbackAction;
    }
  /** Se pidió la generación. El resultado llega aparte, en otro mensaje. */
  | { readonly kind: 'generating'; readonly versionId: string }
  | { readonly kind: 'approved'; readonly versionId: string }
  | { readonly kind: 'rejected'; readonly versionId: string }
  /** SPEC-004 — se prendió la espera de instrucción. El resultado llega aparte. */
  | { readonly kind: 'editing'; readonly versionId: string }
  | { readonly kind: 'not_implemented'; readonly action: CallbackAction };

export interface ActionDeps {
  readonly repo: ActionRepo;
  readonly sender: TelegramSender;
  readonly generation: GenerationTrigger;
  /** Se propaga hasta `ai_generations` para poder seguir la petición. */
  readonly requestId: string;
}

/**
 * Qué evento de la máquina de estados dispara cada botón.
 *
 * `generate` NO está aquí a propósito: su transición la hace
 * `generate-version`, no esta función. Ver el recuadro de `generar`.
 */
const EVENTO: Partial<Record<CallbackAction, VersionEvent>> = {
  approve: 'APPROVE',
  reject: 'REJECT',
};

/** El estado, en palabras que el entrenador entienda. */
const ESTADO_EN_PALABRAS: Readonly<Record<VersionState, string>> = {
  NEW: 'todavía no tiene rutina',
  GENERATING: 'se está generando',
  DRAFT: 'es un borrador',
  APPROVED: 'ya está aprobada',
  SENT: 'ya fue enviada al cliente',
  REJECTED: 'fue rechazada',
};

/**
 * Lo mismo para una versión ajena que para una que no existe.
 *
 * Si se distinguieran, probar IDs diría cuáles existen.
 */
const RESPUESTA_NEUTRA = 'No puedo hacer eso con esta rutina\\.';

/** SPEC-004 regla 9. Comparte la columna con el editor manual (SPEC-008). */
const MAX_EDICIONES = 5;

export async function handleAction(
  request: ActionRequest,
  actor: Identity,
  deps: ActionDeps,
): Promise<ActionOutcome> {
  // ── 1. El botón, antes que nada ────────────────────────────────────────
  // Telegram lo deja girando si se tarda unos segundos, y el entrenador
  // vuelve a pulsar (regla 2). Se responde incluso si luego se deniega.
  await deps.sender.answerCallback(request.callbackQueryId);

  const version = await deps.repo.findVersion(request.versionId);

  // ── 2 y 3. Existir y ser suya son la misma respuesta ───────────────────
  if (version === null || !canModifyVersion(actor, version).allowed) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'unauthorized' };
  }

  // ── El botón de generar, antes del despacho normal ─────────────────────
  if (request.action === 'generate') return generar(version, actor, deps);

  // ── «✏️ Editar»: prende la espera de instrucción ────────────────────────
  // El siguiente mensaje de TEXTO LIBRE de este entrenador se interpreta
  // como la instrucción (webhook.ts + _core/ai/edit-version.ts). Aquí solo
  // se decide si corresponde preguntar.
  if (request.action === 'edit') {
    if (version.state !== 'DRAFT') {
      await deps.sender.sendMessage(
        actor.telegramChatId,
        `No puedo: esta rutina ${ESTADO_EN_PALABRAS[version.state]}\\.`,
      );
      return { kind: 'invalid_action', state: version.state, action: 'edit' };
    }

    // Sin evaluación de Tally no hay `goal`/`level`/etc. con qué llamar a la
    // IA (una de plantilla o manual, SPEC-008 §11): sigue siendo el editor
    // de siempre, sin prender ninguna espera que nunca se resolvería.
    if (version.constraints === null) {
      await deps.sender.sendMessage(
        actor.telegramChatId,
        'Para editarla escribe /ver: desde ahí se retoca con /add, /quitar, /nota y /dia\\.',
      );
      return { kind: 'not_implemented', action: 'edit' };
    }

    // Regla 9: con 5 ya hechas, no se pregunta nada — ni siquiera se prende
    // la espera. Reescribir la instrucción no cambia el límite.
    if (version.editCount >= MAX_EDICIONES) {
      await deps.sender.sendMessage(
        actor.telegramChatId,
        `Ya editaste esta rutina ${MAX_EDICIONES} veces\\. Mejor recházala y arranca una nueva\\.`,
      );
      return { kind: 'invalid_action', state: version.state, action: 'edit' };
    }

    // Guarda de concurrencia, igual que `transition`: si alguien se
    // adelantó (aprobó o rechazó) entre que se buscó la versión y aquí.
    if (!(await deps.repo.startEditWait(version.versionId))) {
      await deps.sender.sendMessage(actor.telegramChatId, 'Esta rutina ya fue procesada\\.');
      return { kind: 'already_processed' };
    }

    await deps.sender.sendMessage(
      actor.telegramChatId,
      `¿Qué quieres cambiar en la rutina de ${escapeMarkdownV2(version.clientName)}?`,
    );
    return { kind: 'editing', versionId: version.versionId };
  }

  const evento = EVENTO[request.action];
  if (evento === undefined) {
    // Un botón que no hace nada y no lo dice es peor que uno que no existe.
    await deps.sender.sendMessage(actor.telegramChatId, 'Eso todavía no está listo\\.');
    return { kind: 'not_implemented', action: request.action };
  }

  // ── 3.5. Aprobar valida. Es la última puerta antes de que salga ────────
  // Antes no lo hacía: solo `generate-version` llamaba a `validateDraft`, así
  // que una rutina hecha a mano podía aprobarse y enviarse sin haber pasado
  // nunca por ahí (SPEC-008 regla 11).
  if (request.action === 'approve') {
    const problema = porQueNoSePuedeAprobar(version);

    if (problema !== null) {
      await deps.sender.sendMessage(
        actor.telegramChatId,
        `No puedo aprobarla: ${escapeMarkdownV2(problema)}`,
      );
      return { kind: 'invalid_action', state: version.state, action: 'approve' };
    }
  }

  // ── 4. La máquina decide, no un `if` escrito aquí ──────────────────────
  const destino = nextState(version.state, evento);
  if (destino === null) {
    await deps.sender.sendMessage(
      actor.telegramChatId,
      `No puedo: esta rutina ${ESTADO_EN_PALABRAS[version.state]}\\.`,
    );
    return { kind: 'invalid_action', state: version.state, action: request.action };
  }

  // ── 5. La transición ES la guarda contra el doble clic ─────────────────
  // Una comprobación previa la pasarían las dos pulsaciones simultáneas.
  if (!(await deps.repo.transition(request.versionId, version.state, destino))) {
    await deps.sender.sendMessage(actor.telegramChatId, 'Esta rutina ya fue procesada\\.');
    return { kind: 'already_processed' };
  }

  if (destino === 'APPROVED') {
    // Enviarla al cliente es SPEC-005, y el webhook encadena las dos: aprobar
    // ES enviar. Decirlo aquí evita que el entrenador busque un botón de
    // enviar que no existe — y el mensaje de entrega llega justo después.
    await deps.sender.sendMessage(
      actor.telegramChatId,
      `✅ Rutina aprobada para ${escapeMarkdownV2(version.clientName)}\\. Enviándosela…`,
    );
    return { kind: 'approved', versionId: request.versionId };
  }

  // SPEC-022 M3. «Puedes empezar otra» no decía cómo. El botón es la misma
  // acción que la ficha ofrece sobre una versión `REJECTED` (`startRevision`,
  // que comprueba de nuevo que el entrenador sea el dueño). Sin estados ni
  // transiciones nuevas: la v2 nace en `NEW`.
  await deps.sender.sendMessage(
    actor.telegramChatId,
    `❌ Rutina rechazada\\. Pulsa ✏️ Crear v2 para empezar otra\n` +
      `para ${escapeMarkdownV2(version.clientName)}\\.`,
    buildKeyboard(['revise'], request.versionId),
  );
  return { kind: 'rejected', versionId: request.versionId };
}


/**
 * «🤖 Generar con IA».
 *
 * ┌─ AQUÍ NO SE TRANSICIONA, Y ES DELIBERADO ──────────────────────────────┐
 * │ `NEW → GENERATING` la hace `generate-version`, y esa transición es lo  │
 * │ que serializa dos pulsaciones rápidas: la segunda encuentra            │
 * │ `GENERATING` y no llama al proveedor.                                  │
 * │                                                                        │
 * │ Si se transicionara aquí, la propia función se encontraría el estado   │
 * │ ya cambiado y se negaría a trabajar. El botón no haría nada.           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Sí se consulta la máquina antes: sirve para decir POR QUÉ no se puede,
 * en vez de disparar a ciegas algo que va a rebotar.
 */
async function generar(
  version: { state: VersionState; versionId: string; clientName: string },
  actor: Identity,
  deps: ActionDeps,
): Promise<ActionOutcome> {
  if (nextState(version.state, 'GENERATE') === null) {
    await deps.sender.sendMessage(
      actor.telegramChatId,
      `No puedo: esta rutina ${ESTADO_EN_PALABRAS[version.state]}\\.`,
    );
    return { kind: 'invalid_action', state: version.state, action: 'generate' };
  }

  // Se avisa ANTES de disparar: generar tarda, y un botón que no responde
  // invita a volver a pulsarlo.
  await deps.sender.sendMessage(
    actor.telegramChatId,
    `🤖 Generando la rutina de ${escapeMarkdownV2(version.clientName)}\\. Te la mando en cuanto esté\\.`,
  );

  try {
    await deps.generation.trigger(version.versionId, deps.requestId);
  } catch {
    // La versión sigue en NEW: puede volver a pulsar, o usar una plantilla.
    // El detalle del fallo va a los logs del handler, no al entrenador.
    await deps.sender.sendMessage(
      actor.telegramChatId,
      'No pude arrancar la generación\\. Puedes reintentar o usar una plantilla\\.',
    );
    return { kind: 'invalid_action', state: version.state, action: 'generate' };
  }

  return { kind: 'generating', versionId: version.versionId };
}


/**
 * Por qué esta rutina no se puede aprobar, o `null` si sí se puede.
 *
 * Es la MISMA validación que se le exige a la IA: no hay un camino blando
 * para lo que escribe el entrenador (SPEC-008 regla 4).
 */
function porQueNoSePuedeAprobar(version: VersionForAction): string | null {
  if (version.content === null) return 'todavía no tiene contenido.';

  // Sin evaluación se valida la forma, no el encaje con unos criterios que
  // no existen: una rutina manual no tiene formulario detrás.
  const validado = validateDraft({ source: 'manual', raw: version.content }, version.constraints);

  return validado.ok ? null : describeErrors(validado.errors);
}
