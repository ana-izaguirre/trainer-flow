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
import type { Identity } from '../domain/identity.ts';
import { nextState } from '../domain/state-machine.ts';
import type { VersionEvent } from '../domain/state-machine.ts';
import type { VersionState } from '../domain/version.ts';
import type { ActionRepo } from '../ports/action-ports.ts';
import type { GenerationTrigger } from '../ports/generation-trigger.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import type { CallbackAction } from './callback-data.ts';

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
const RESPUESTA_NEUTRA = 'No puedo hacer eso con esta rutina.';

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

  const evento = EVENTO[request.action];
  if (evento === undefined) {
    // Un botón que no hace nada y no lo dice es peor que uno que no existe.
    await deps.sender.sendMessage(actor.telegramChatId, 'Eso todavía no está listo.');
    return { kind: 'not_implemented', action: request.action };
  }

  // ── 4. La máquina decide, no un `if` escrito aquí ──────────────────────
  const destino = nextState(version.state, evento);
  if (destino === null) {
    await deps.sender.sendMessage(
      actor.telegramChatId,
      `No puedo: esta rutina ${ESTADO_EN_PALABRAS[version.state]}.`,
    );
    return { kind: 'invalid_action', state: version.state, action: request.action };
  }

  // ── 5. La transición ES la guarda contra el doble clic ─────────────────
  // Una comprobación previa la pasarían las dos pulsaciones simultáneas.
  if (!(await deps.repo.transition(request.versionId, version.state, destino))) {
    await deps.sender.sendMessage(actor.telegramChatId, 'Esta rutina ya fue procesada.');
    return { kind: 'already_processed' };
  }

  if (destino === 'APPROVED') {
    // Enviarla al cliente es SPEC-005: esto solo deja la versión lista.
    await deps.sender.sendMessage(
      actor.telegramChatId,
      `✅ Rutina aprobada para ${version.clientName}.`,
    );
    return { kind: 'approved', versionId: request.versionId };
  }

  await deps.sender.sendMessage(
    actor.telegramChatId,
    `❌ Rutina rechazada. Puedes empezar otra para ${version.clientName}.`,
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
      `No puedo: esta rutina ${ESTADO_EN_PALABRAS[version.state]}.`,
    );
    return { kind: 'invalid_action', state: version.state, action: 'generate' };
  }

  // Se avisa ANTES de disparar: generar tarda, y un botón que no responde
  // invita a volver a pulsarlo.
  await deps.sender.sendMessage(
    actor.telegramChatId,
    `🤖 Generando la rutina de ${version.clientName}. Te la mando en cuanto esté.`,
  );

  try {
    await deps.generation.trigger(version.versionId, deps.requestId);
  } catch {
    // La versión sigue en NEW: puede volver a pulsar, o usar una plantilla.
    // El detalle del fallo va a los logs del handler, no al entrenador.
    await deps.sender.sendMessage(
      actor.telegramChatId,
      'No pude arrancar la generación. Puedes reintentar o usar una plantilla.',
    );
    return { kind: 'invalid_action', state: version.state, action: 'generate' };
  }

  return { kind: 'generating', versionId: version.versionId };
}
