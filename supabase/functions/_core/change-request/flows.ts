/**
 * SPEC-010 — El cliente pide un cambio, el entrenador responde con una v2.
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
 */
import { canRequestChange } from '../authorization.ts';
import type { Identity } from '../domain/identity.ts';
import {
  buildChangeCallback,
  CHANGE_REASONS,
  REASON_LABELS,
  type ChangeReason,
} from '../domain/change-request.ts';
import type { ChangeRequestRepo } from '../ports/change-request-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildKeyboard, type InlineKeyboard } from '../telegram/keyboard.ts';

export interface ChangeRequestDeps {
  readonly repo: ChangeRequestRepo;
  readonly sender: TelegramSender;
}

export type ChangeOutcome =
  /** Ajena, no existe, o no está en SENT. Las tres responden igual. */
  | { readonly kind: 'denied' }
  | { readonly kind: 'asked_reason'; readonly versionId: string }
  | { readonly kind: 'requested'; readonly requestId: string }
  | { readonly kind: 'accepted'; readonly versionId: string }
  | { readonly kind: 'commented'; readonly requestId: string }
  | { readonly kind: 'revision_started'; readonly versionId: string };

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

/** ✏️ — se le preguntan los siete motivos. Todavía no se guarda nada. */
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

  await deps.sender.sendMessage(
    actor.telegramChatId,
    '¿Qué quieres ajustar?\n\nDespués puedes escribirme el detalle\\.',
    tecladoDeMotivos(versionId),
  );

  return { kind: 'asked_reason', versionId };
}

/** El motivo elegido. Se guarda y el entrenador se entera en el momento. */
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

  const requestId = await deps.repo.request(versionId, version.client.clientId, reason);

  await deps.sender.sendMessage(
    actor.telegramChatId,
    'Anotado\\. Se lo paso a tu entrenador\\.\n\n' +
      'Si quieres, escríbeme el detalle en un mensaje\\.',
  );

  // El entrenador se entera ya, con el botón para empezar la v2.
  await deps.sender.sendMessage(
    version.trainerChatId,
    avisoAlEntrenador(version.clientName, version.versionNumber, reason, null),
    buildKeyboard(['revise'], versionId),
  );

  return { kind: 'requested', requestId };
}

/** El detalle que escribe después. Se le reenvía al entrenador tal cual. */
export async function addComment(
  requestId: string,
  clientId: string,
  comment: string,
  actor: Identity,
  deps: ChangeRequestDeps,
): Promise<ChangeOutcome> {
  if (!(await deps.repo.addComment(requestId, clientId, comment))) {
    return { kind: 'denied' };
  }

  const solicitud = await deps.repo.findRequest(requestId);
  if (solicitud === null) return { kind: 'denied' };

  await deps.sender.sendMessage(actor.telegramChatId, 'Apuntado también\\.');

  const version = await deps.repo.findVersion(solicitud.versionId);
  if (version !== null) {
    await deps.sender.sendMessage(
      version.trainerChatId,
      avisoAlEntrenador(
        solicitud.clientName,
        solicitud.versionNumber,
        solicitud.reason,
        solicitud.comment,
      ),
      buildKeyboard(['revise'], solicitud.versionId),
    );
  }

  return { kind: 'commented', requestId };
}

/**
 * ✏️ Crear v2 — el entrenador empieza la revisión.
 *
 * La versión nace en `NEW`, así que salen los mismos tres botones de
 * SPEC-008: no hay un camino especial por ser una revisión.
 *
 * **La solicitud sigue abierta** hasta que la v2 se envíe (regla 12).
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

  const nueva = await deps.repo.createRevision(version.planId, actor.profileId);

  await deps.sender.sendMessage(
    actor.telegramChatId,
    `✏️ Versión nueva para ${escapeMarkdownV2(version.clientName)}\\. ¿Cómo la preparamos?`,
    buildKeyboard(['generate', 'template', 'manual'], nueva),
  );

  return { kind: 'revision_started', versionId: nueva };
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

/** El aviso lleva el comentario ENTERO: el entrenador decide, y necesita leerlo. */
function avisoAlEntrenador(
  clientName: string,
  versionNumber: number,
  reason: ChangeReason,
  comment: string | null,
): string {
  const lineas = [
    `🔔 *${escapeMarkdownV2(clientName)}* pidió un cambio`,
    '',
    `Rutina v${versionNumber}`,
    `Motivo: ${REASON_LABELS[reason]}`,
  ];

  if (comment !== null && comment.trim().length > 0) {
    lineas.push(`Comentario: _${escapeMarkdownV2(comment)}_`);
  }

  return lineas.join('\n');
}
