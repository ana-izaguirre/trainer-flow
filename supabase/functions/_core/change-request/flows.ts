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
import type { ChangeRequestRepo, OpenRequest } from '../ports/change-request-ports.ts';
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
    avisoAlEntrenador(version.clientName, version.versionNumber, reason, null),
    buildKeyboard(['revise'], versionId),
  );

  return { kind: 'requested', requestId: resultado.id };
}

/**
 * El detalle que escribe después. Se le AÑADE al comentario que ya hubiera
 * —no lo reemplaza— y se le reenvía al entrenador tal cual (regla 4).
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

  const solicitud = await deps.repo.findRequest(requestId);
  if (solicitud === null) return { kind: 'denied' };

  await deps.sender.sendMessage(
    actor.telegramChatId,
    guardado.truncated
      ? '📨 Enviado a tu entrenador\\. Guardé hasta el límite: el resto no entró\\.'
      : '📨 Enviado a tu entrenador\\. Te aviso aquí cuando tenga tu nueva rutina\\.',
  );

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

  return { kind: 'commented', requestId, truncated: guardado.truncated };
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
