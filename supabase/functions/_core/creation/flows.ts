/**
 * SPEC-008 — Los dos caminos que no pasan por la IA.
 *
 * ┌─ ESTE ARCHIVO ES EL SEGURO DEL PRODUCTO ───────────────────────────────┐
 * │ Es lo que hace cierto que «el sistema funciona completo sin IA». No    │
 * │ importa ningún proveedor, ni directa ni indirectamente. Con la IA      │
 * │ caída, el entrenador sigue creando rutinas por aquí.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ UNA RUTINA MANUAL SE VALIDA IGUAL DE ESTRICTO ────────────────────────┐
 * │ Las tres fuentes pasan por `validateDraft`. No hay un camino blando    │
 * │ para lo que escribe el entrenador y otro duro para lo que devuelve la  │
 * │ IA: sería tener dos definiciones de «rutina válida» (regla 4).         │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { canModifyVersion } from '../authorization.ts';
import type { Identity } from '../domain/identity.ts';
import { nextState } from '../domain/state-machine.ts';
import { describeErrors } from '../domain/draft.ts';
import { validateDraft } from '../domain/validate-draft.ts';
import type { Workout } from '../domain/workout.ts';
import type { CreationRepo, VersionForCreation } from '../ports/creation-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { applyTemplate, findTemplate, templatesFor } from '../templates.ts';
import { buildDraftReady } from '../telegram/notify.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildTemplateCallback } from '../telegram/template-callback.ts';
import type { InlineKeyboard } from '../telegram/keyboard.ts';

export interface CreationDeps {
  readonly repo: CreationRepo;
  readonly sender: TelegramSender;
}

export type CreationOutcome =
  /** Se listaron las plantillas. **Nada se cargó**: falta elegir (regla 8). */
  | { readonly kind: 'listed'; readonly count: number }
  | { readonly kind: 'filled'; readonly versionId: string; readonly source: string }
  /** Ajena, inexistente, o ya no está en el estado que permitía cargar. */
  | { readonly kind: 'rejected'; readonly reason: string };

/** Una rutina manual nace así: sin días, y por eso no se puede aprobar. */
const VACIA: Workout = { summary: 'Rutina en preparación', days: [], warnings: [] };

const AYUDA_EDITOR = [
  '✍️ Borrador vacío creado\\. Ve añadiendo:',
  '',
  '`/dia 1 Empuje` — nombra un día',
  '`/add 1 Press banca 4x8 90` — añade un ejercicio',
  '`/quitar 1 2` — quita el ejercicio 2 del día 1',
  '`/nota 1 1 baja controlado` — pone una nota',
  '`/ver` — enseña cómo va',
  '',
  'Cuando esté, te salen los botones para aprobarla\\.',
].join('\n');

/**
 * 📋 — se listan las plantillas aplicables.
 *
 * **No se carga ninguna, ni aunque solo encaje una** (regla 8). Y se ORDENAN,
 * no se filtran: un cliente con criterios poco comunes no puede quedarse sin
 * opciones justo cuando la IA acaba de fallar (regla 7).
 */
export async function listTemplates(
  versionId: string,
  actor: Identity,
  deps: CreationDeps,
): Promise<CreationOutcome> {
  const chatId = actor.telegramChatId;
  const version = await versionPropia(versionId, actor, deps);
  if (version === null) return rechazar(chatId, deps, 'no existe o no es suya');

  // No se ofrecen botones que al pulsarse van a rechazarse.
  if (nextState(version.state, 'LOAD_TEMPLATE') === null) {
    return rechazarPorEstado(chatId, deps, version.state);
  }

  const aplicables = templatesFor({
    ...(version.daysPerWeek === null ? {} : { daysPerWeek: version.daysPerWeek }),
    ...(version.level === null ? {} : { level: version.level }),
    ...(version.equipment === null ? {} : { equipment: version.equipment }),
  });

  await deps.sender.sendMessage(
    chatId,
    [
      `📋 *Plantillas para ${escapeMarkdownV2(version.clientName)}*`,
      '',
      'La primera es la que mejor encaja con su evaluación\\.',
    ].join('\n'),
    teclado(aplicables, versionId),
  );

  return { kind: 'listed', count: aplicables.length };
}

/** La segunda pulsación: se carga la elegida. */
export async function loadTemplate(
  templateId: string,
  versionId: string,
  actor: Identity,
  deps: CreationDeps,
): Promise<CreationOutcome> {
  const chatId = actor.telegramChatId;
  const template = findTemplate(templateId);
  // Un `callback_data` lo fabrica cualquiera: la forma no basta.
  if (template === undefined) return rechazar(chatId, deps, 'plantilla desconocida');

  const version = await versionPropia(versionId, actor, deps);
  if (version === null) return rechazar(chatId, deps, 'no existe o no es suya');

  // `LOAD_TEMPLATE` solo sale de NEW. Sin esto, un botón viejo de un mensaje
  // de hace semanas reescribía una rutina ya ENVIADA y la devolvía a DRAFT.
  if (nextState(version.state, 'LOAD_TEMPLATE') === null) {
    return rechazarPorEstado(chatId, deps, version.state);
  }

  // Regla 9: sin el aviso, un cliente con limitaciones haría fallar
  // `validateDraft` y el entrenador no podría ni cargar la plantilla.
  const draft = applyTemplate(template, {
    daysPerWeek: version.daysPerWeek ?? template.daysPerWeek,
    hasLimitations: version.hasLimitations,
  });

  return escribir(draft.raw as Workout, version, 'template', template.id, chatId, deps);
}

/** ✍️ — un borrador vacío y las instrucciones para llenarlo. */
export async function startManual(
  versionId: string,
  actor: Identity,
  deps: CreationDeps,
): Promise<CreationOutcome> {
  const chatId = actor.telegramChatId;
  const version = await versionPropia(versionId, actor, deps);
  if (version === null) return rechazar(chatId, deps, 'no existe o no es suya');

  // `CREATE_MANUAL` solo sale de NEW. `fill_version` escribe `state='DRAFT'`
  // sin mirar de dónde viene, así que si esto no lo comprueba, no lo
  // comprueba nadie.
  if (nextState(version.state, 'CREATE_MANUAL') === null) {
    return rechazarPorEstado(chatId, deps, version.state);
  }

  // Se guarda sin pasar por `validateDraft`: una rutina vacía NO es válida, y
  // ese es justo el estado en el que tiene que quedar para poder editarla.
  // La validación entra en cada edición y, sobre todo, al aprobar.
  if (!(await deps.repo.fillVersion(versionId, version.state, 'manual', null, VACIA))) {
    return rechazar(chatId, deps, 'ya se estaba preparando');
  }

  await deps.sender.sendMessage(chatId, AYUDA_EDITOR);
  return { kind: 'filled', versionId, source: 'manual' };
}

/** Validar, escribir y enseñar el borrador con sus botones. */
async function escribir(
  workout: Workout,
  version: VersionForCreation,
  source: 'template' | 'manual',
  templateId: string | null,
  chatId: number,
  deps: CreationDeps,
): Promise<CreationOutcome> {
  // Regla 4: la plantilla pasa por la MISMA puerta que la IA, con las mismas
  // restricciones del cliente. Si no encajaran, se dice — no se cuela.
  const validado = validateDraft(
    { source, raw: workout },
    {
      daysPerWeek: version.daysPerWeek ?? workout.days.length,
      hasLimitations: version.hasLimitations,
    },
  );
  if (!validado.ok) {
    await deps.sender.sendMessage(
      chatId,
      `No pude cargarla: ${escapeMarkdownV2(describeErrors(validado.errors))}`,
    );
    return { kind: 'rejected', reason: 'invalid_draft' };
  }

  if (
    !(await deps.repo.fillVersion(version.versionId, version.state, source, templateId, validado.workout))
  ) {
    return rechazar(chatId, deps, 'ya se estaba preparando');
  }

  const aviso = buildDraftReady(
    validado.workout,
    { clientName: version.clientName, versionNumber: version.versionNumber },
    version.versionId,
  );
  await deps.sender.sendMessage(chatId, aviso.text, aviso.keyboard);

  return { kind: 'filled', versionId: version.versionId, source };
}

/** Un botón, tres filas: en un móvil cuatro nombres largos no caben en una. */
function teclado(
  templates: readonly { id: string; name: string; daysPerWeek: number }[],
  versionId: string,
): InlineKeyboard {
  return {
    inline_keyboard: templates.map((t) => [
      {
        text: `${t.name} · ${t.daysPerWeek}d`,
        callback_data: buildTemplateCallback(t.id, versionId),
      },
    ]),
  };
}

/** Lo mismo para una ajena que para una que no existe. */
/**
 * Carga la versión Y comprueba que sea de quien actúa.
 *
 * ┌─ POR QUÉ DEVUELVE `null` EN LOS DOS CASOS ─────────────────────────────┐
 * │ «No existe» y «no es tuya» salen por la misma puerta, con el mismo     │
 * │ mensaje. Quien prueba identificadores a ver qué pega no aprende cuáles │
 * │ son reales (SPEC-013 regla 2).                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Va ANTES de la primera escritura, no entre medias.
 */
async function versionPropia(
  versionId: string,
  actor: Identity,
  deps: CreationDeps,
): Promise<VersionForCreation | null> {
  const version = await deps.repo.findVersion(versionId);
  if (version === null) return null;

  return canModifyVersion(actor, version).allowed ? version : null;
}

async function rechazar(
  chatId: number,
  deps: CreationDeps,
  reason: string,
): Promise<CreationOutcome> {
  await deps.sender.sendMessage(chatId, 'No puedo hacer eso con esta rutina\\.');
  return { kind: 'rejected', reason };
}

/**
 * Rechazo por ESTADO, no por pertenencia.
 *
 * Aquí sí se explica el motivo: solo llega el dueño de la rutina, que ya tiene
 * acceso. No hay nada que filtrar y sí algo que aclararle — normalmente ha
 * pulsado un botón viejo de un mensaje de hace semanas.
 */
async function rechazarPorEstado(
  chatId: number,
  deps: CreationDeps,
  estado: string,
): Promise<CreationOutcome> {
  await deps.sender.sendMessage(
    chatId,
    'Esa rutina ya no está en preparación, así que no puedo cambiarle el contenido\\.',
  );
  return { kind: 'rejected', reason: `estado ${estado}` };
}
