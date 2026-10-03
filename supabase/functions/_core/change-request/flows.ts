/**
 * SPEC-010, SPEC-030 — El cliente pide un cambio, el entrenador responde con
 * una v2, y ninguno de los dos se queda sin saber en qué va.
 *
 * ┌─ LA RUTINA ENVIADA NO SE TOCA ─────────────────────────────────────────┐
 * │ Una solicitud es una fila aparte. Ni el contenido de la v1, ni su      │
 * │ estado, ni su `sent_at` cambian nunca (regla 4). El cliente conserva   │
 * │ en su chat exactamente lo que recibió.                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Y NO CREA NINGUNA VERSIÓN ────────────────────────────────────────────┐
 * │ La v2 nace cuando el entrenador decide empezarla (regla 3). Si la      │
 * │ creara la solicitud, un cliente quejica llenaría el plan de versiones  │
 * │ vacías que nadie pidió.                                                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ UNA ABIERTA NO SE PISA (SPEC-030 regla 1) ────────────────────────────┐
 * │ Pulsar «Pedir un cambio» o un motivo con una solicitud ya abierta no   │
 * │ crea nada ni avisa dos veces: enseña el estado de la que ya había.     │
 * │ Quién decide si se creó es el propio `INSERT` de la base —el `created` │
 * │ de `request()`—, no una comprobación previa que una carrera pasaría.   │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { canRequestChange } from '../authorization.ts';
import type { Identity } from '../domain/identity.ts';
import {
  buildChangeCallback,
  CHANGE_REASONS,
  REASON_LABELS,
  type ChangeReason,
} from '../domain/change-request.ts';
import { isTerminal } from '../domain/state-machine.ts';
import { SIGUIENTE_PASO } from '../creation/flows.ts';
import type { ChangeRequestRepo, OpenRequest, VersionForRequest } from '../ports/change-request-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildKeyboard, type InlineKeyboard } from '../telegram/keyboard.ts';

export interface ChangeRequestDeps {
  readonly repo: ChangeRequestRepo;
  readonly sender: TelegramSender;
  /** Igual que en `generate-version.ts`: `_core` no llama a `Date.now()`. */
  readonly now: () => Date;
}

export type ChangeOutcome =
  /** Ajena, no existe, o no está en SENT. Las tres responden igual. */
  | { readonly kind: 'denied' }
  | { readonly kind: 'asked_reason'; readonly versionId: string }
  | { readonly kind: 'requested'; readonly requestId: string }
  /** SPEC-030 regla 1: ya había una abierta. No se avisó de nuevo. */
  | { readonly kind: 'already_requested'; readonly requestId: string }
  | { readonly kind: 'accepted'; readonly versionId: string }
  | { readonly kind: 'commented'; readonly requestId: string; readonly truncated: boolean }
  | { readonly kind: 'revision_started'; readonly versionId: string }
  /** Ya hay una v2+ sin resolver: no se crea otra (ver `startRevision`). */
  | { readonly kind: 'revision_in_progress'; readonly versionId: string };

/**
 * Lo mismo para una versión ajena que para una que no existe o no está
 * enviada. Si se distinguieran, probar IDs diría cuáles existen.
 */
const RESPUESTA_NEUTRA = 'No puedo hacer eso con esta rutina\\.';

/** 👍 — se registra y ya. `SENT` es terminal: no hay estado que cambiar. */
export async function acceptVersion(
  versionId: string,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<ChangeOutcome> {
  const version = await deps.repo.findVersion(versionId);

  if (version === null || !canRequestChange(actor, version).allowed) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'denied' };
  }

  await deps.repo.recordAccepted(versionId, version.client.clientId);
  await deps.sender.sendMessage(actor.telegramChatId, '💪 Genial\\. A entrenar\\.');

  return { kind: 'accepted', versionId };
}

/**
 * ✏️ — se le preguntan los siete motivos. Todavía no se guarda nada, salvo
 * que ya tenga una abierta: entonces se enseña su estado (regla 1) en vez de
 * volver a preguntar.
 */
export async function askReason(
  versionId: string,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<ChangeOutcome> {
  const version = await deps.repo.findVersion(versionId);

  // La MISMA comprobación que para pedir el cambio: preguntar el motivo sobre
  // una rutina ajena ya sería confirmar que existe.
  if (version === null || !canRequestChange(actor, version).allowed) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'denied' };
  }

  const abierta = await deps.repo.openForClient(actor.profileId);
  if (abierta !== null) return estadoAbierto(abierta, actor, deps);

  await deps.sender.sendMessage(
    actor.telegramChatId,
    '¿Qué quieres ajustar?\n\nDespués puedes escribirme el detalle\\.',
    tecladoDeMotivos(versionId),
  );

  return { kind: 'asked_reason', versionId };
}

/**
 * El motivo elegido. Se guarda y el entrenador se entera en el momento —
 * salvo que ya hubiera una solicitud abierta (regla 1): entonces se enseña
 * su estado, y NO se avisa dos veces (regla 2).
 */
export async function requestChange(
  reason: ChangeReason,
  versionId: string,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<ChangeOutcome> {
  const version = await deps.repo.findVersion(versionId);

  if (version === null || !canRequestChange(actor, version).allowed) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'denied' };
  }

  const resultado = await deps.repo.request(versionId, version.client.clientId, reason);

  // Regla 2: quien decide si se avisa es el propio INSERT, no una
  // comprobación de antes que una pulsación simultánea pasaría igual.
  if (!resultado.created) {
    const abierta = await deps.repo.openForClient(actor.profileId);
    if (abierta !== null) return estadoAbierto(abierta, actor, deps);
    // No debería pasar —`created=false` implica que había una—, pero el
    // cliente nunca se queda sin respuesta (regla 8).
    return { kind: 'already_requested', requestId: resultado.id };
  }

  await deps.sender.sendMessage(
    actor.telegramChatId,
    `✅ Listo\\. Le pasé a tu entrenador que quieres un cambio: ${escapeMarkdownV2(REASON_LABELS[reason])}\\.\n\n` +
      'Cuando prepare tu nueva versión, te llega aquí mismo\\. Mientras, sigue con tu rutina actual\\.\n\n' +
      '¿Quieres darle más detalle\\? Escríbelo en tu próximo mensaje\\.',
    null,
    // Regla 3: Telegram abre el teclado con la respuesta ya enlazada aquí.
    true,
  );

  // El entrenador se entera ya, con el botón para empezar la v2.
  await deps.sender.sendMessage(
    version.trainerChatId,
    avisoAlEntrenador(version.clientName, version.versionNumber, reason),
    buildKeyboard(['revise'], versionId),
  );

  return { kind: 'requested', requestId: resultado.id };
}

/**
 * El detalle que escribe después. Se le AÑADE al comentario que ya hubiera
 * —no lo reemplaza— (regla 4).
 *
 * ┌─ YA NO LE REENVÍA UN AVISO AL ENTRENADOR ──────────────────────────────┐
 * │ El aviso original (`requestChange`) ya tiene el botón para empezar la  │
 * │ v2. Repetirlo por cada mensaje del cliente era una notificación nueva  │
 * │ sin límite sobre el mismo botón, mientras el cambio sigue en curso: no │
 * │ hay nada nuevo que decidir por escribir más. El comentario queda       │
 * │ guardado, y lo ve cuando decide atender la solicitud, no mensaje a     │
 * │ mensaje.                                                               │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export async function addComment(
  requestId: string,
  clientId: string,
  comment: string,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<ChangeOutcome> {
  const guardado = await deps.repo.addComment(requestId, clientId, comment);
  if (!guardado.saved) return { kind: 'denied' };

  await deps.sender.sendMessage(
    actor.telegramChatId,
    guardado.truncated
      ? '📝 Guardado\\. Guardé hasta el límite: el resto no entró\\.'
      : '📝 Guardado\\. Tu entrenador lo verá cuando revise tu pedido\\.',
  );

  return { kind: 'commented', requestId, truncated: guardado.truncated };
}

/**
 * ✏️ Crear v2 — el entrenador empieza la revisión.
 *
 * La versión nace en `NEW`, así que salen los mismos tres botones de
 * SPEC-008: no hay un camino especial por ser una revisión.
 *
 * **La solicitud sigue abierta** hasta que la v2 se envíe (regla 12).
 *
 * ┌─ POR QUÉ COMPRUEBA LA VIGENTE, NO SOLO ESTA ──────────────────────────┐
 * │ Cada comentario que el cliente escribe (`addComment`) le reenvía al   │
 * │ entrenador un aviso nuevo, y los tres —el original y los de cada      │
 * │ comentario— llevan su propio botón apuntando a esta MISMA v1. Sin     │
 * │ esta comprobación, tocar el botón en más de un aviso crea una v3 por  │
 * │ encima de la v2 que ya está en marcha, sin que el entrenador lo pida  │
 * │ (regla 3: la v2 nace de UNA decisión, no de varias por accidente).    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Y POR QUÉ LA CREACIÓN VUELVE A COMPROBARLO, BAJO EL LOCK ─────────────┐
 * │ La comprobación de arriba y el INSERT son dos pasos separados: dos     │
 * │ callbacks casi simultáneos —dos avisos distintos, o Telegram           │
 * │ reintentando el mismo— podrían leer los dos "todavía terminal" antes   │
 * │ de que cualquiera cree la suya. `createRevisionIfCurrent` repite la    │
 * │ comprobación DENTRO de la transacción que ya bloquea el plan, así que  │
 * │ sigue siendo el propio INSERT quien decide — el mismo principio que    │
 * │ el `UNIQUE` de SPEC-030 regla 1, aplicado aquí porque no hay un índice  │
 * │ que lo exprese (no es "una fila o ninguna", es "la vigente cambió").   │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export async function startRevision(
  versionId: string,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<ChangeOutcome> {
  const version = await deps.repo.findVersion(versionId);

  // Solo su entrenador. `canRequestChange` es del cliente, así que aquí la
  // pertenencia se comprueba contra el `trainerId` de la ficha.
  if (version === null || actor.role !== 'trainer' || version.client.trainerId !== actor.profileId) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'denied' };
  }

  if (!isTerminal(version.currentVersionState)) {
    await avisarEnMarcha(version, actor, deps);
    return { kind: 'revision_in_progress', versionId: version.currentVersionId };
  }

  const nueva = await deps.repo.createRevisionIfCurrent(
    version.planId,
    actor.profileId,
    version.currentVersionId,
  );

  if (nueva === null) {
    // Perdió la carrera: otro callback, casi al mismo instante, ya creó la
    // suya bajo el mismo lock. `version` quedó desactualizada en ESE
    // instante —su `currentVersionId` sigue siendo el de la v1 de entrada—,
    // así que hay que releerla: devolver ese id viejo sería apuntar a la
    // rutina equivocada.
    const actualizada = await deps.repo.findVersion(versionId);
    if (actualizada === null) {
      await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
      return { kind: 'denied' };
    }

    await avisarEnMarcha(actualizada, actor, deps);
    return { kind: 'revision_in_progress', versionId: actualizada.currentVersionId };
  }

  await deps.sender.sendMessage(
    actor.telegramChatId,
    `✏️ Versión nueva para ${escapeMarkdownV2(version.clientName)}\\. ¿Cómo la preparamos?`,
    buildKeyboard(['generate', 'template', 'manual'], nueva),
  );

  return { kind: 'revision_started', versionId: nueva };
}

/** El estado de la vigente, en las mismas palabras que ya usa SPEC-008. */
async function avisarEnMarcha(
  version: VersionForRequest,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<void> {
  await deps.sender.sendMessage(
    actor.telegramChatId,
    `✏️ La v${version.currentVersionNumber} de ${escapeMarkdownV2(version.clientName)} ya está en marcha\\.\n\n` +
      escapeMarkdownV2(SIGUIENTE_PASO[version.currentVersionState]),
  );
}

/**
 * SPEC-030 regla 1 y 6 — el estado de una solicitud que ya estaba abierta.
 * No crea nada ni avisa al entrenador: solo le dice al cliente dónde está y
 * lo invita, otra vez, a escribir el detalle si quiere.
 */
async function estadoAbierto(
  abierta: OpenRequest,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<ChangeOutcome> {
  await deps.repo.touchAsk(abierta.requestId, abierta.clientId);

  await deps.sender.sendMessage(
    actor.telegramChatId,
    `🕐 Ya le pediste un cambio a tu entrenador ${haceCuanto(abierta.createdAt, deps.now())}: ` +
      `${escapeMarkdownV2(REASON_LABELS[abierta.reason])}\\.\n\n` +
      'Está preparando tu nueva versión\\. Si quieres añadir algo, escríbelo en tu próximo mensaje\\.',
    null,
    // Regla 3, igual que arriba.
    true,
  );

  return { kind: 'already_requested', requestId: abierta.requestId };
}

function haceCuanto(desde: Date, ahora: Date): string {
  const dias = Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 86_400_000));
  if (dias === 0) return 'hoy';
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/** Dos por fila salvo el último: siete botones en una columna no se leen. */
function tecladoDeMotivos(versionId: string): InlineKeyboard {
  const filas: { text: string; callback_data: string }[][] = [];

  for (let i = 0; i < CHANGE_REASONS.length; i += 2) {
    filas.push(
      CHANGE_REASONS.slice(i, i + 2).map((reason) => ({
        text: REASON_LABELS[reason],
        callback_data: buildChangeCallback(reason, versionId),
      })),
    );
  }

  return { inline_keyboard: filas };
}

/**
 * El aviso con el que se entera el entrenador, al pedirse el cambio.
 *
 * Nunca lleva el comentario: en este punto todavía no existe —se escribe
 * DESPUÉS, y ya no se reenvía (ver el docstring de `addComment`)—, así que
 * el entrenador lo lee cuando decide atender la solicitud, no aquí.
 */
function avisoAlEntrenador(clientName: string, versionNumber: number, reason: ChangeReason): string {
  return [
    `🔔 *${escapeMarkdownV2(clientName)}* pidió un cambio`,
    '',
    `Rutina v${versionNumber}`,
    `Motivo: ${REASON_LABELS[reason]}`,
  ].join('\n');
}
