/**
 * SPEC-030 regla 13 — El cliente nunca abrió su enlace, 48 horas después.
 *
 * ┌─ MISMO PATRÓN QUE checkin/send.ts ─────────────────────────────────────┐
 * │ Enviar y SOLO ENTONCES marcar: si el aviso falla, la fila se queda sin │
 * │ `link_reminder_sent_at` y el próximo barrido lo reintenta solo. Al     │
 * │ revés el riesgo es avisar dos veces, que es molesto y no grave.        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Vive junto a `delivery.ts` porque es lo mismo que resuelve el botón
 * `🔗 Reenviar enlace`: recordar que hay una rutina esperando.
 */
import type { AwaitingLinkReminder, LinkReminderRepo } from '../ports/link-reminder-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildKeyboard } from '../telegram/keyboard.ts';

export interface LinkReminderDeps {
  readonly repo: LinkReminderRepo;
  readonly sender: TelegramSender;
  /** Horas en APPROVED sin vincular antes de avisar. Config, no secreto. */
  readonly minHours: number;
}

export interface LinkReminderResult {
  readonly checked: number;
  readonly reminded: number;
  /** Cuántos fallaron al enviar. El detalle va a los logs, no aquí. */
  readonly failed: number;
}

export async function sweepUnopenedLinks(deps: LinkReminderDeps): Promise<LinkReminderResult> {
  const candidatas = await deps.repo.awaitingReminder(deps.minHours);
  let reminded = 0;
  let failed = 0;

  for (const version of candidatas) {
    try {
      await deps.sender.sendMessage(
        version.trainerChatId,
        mensaje(version),
        buildKeyboard(['link'], version.versionId),
      );
      await deps.repo.markReminded(version.versionId);
      reminded += 1;
    } catch {
      // Un cliente pudo cambiar de opinión, Telegram pudo fallar. La versión
      // sigue sin marcar: el próximo barrido, a los 5 minutos, lo reintenta.
      failed += 1;
    }
  }

  return { checked: candidatas.length, reminded, failed };
}

function mensaje(version: AwaitingLinkReminder): string {
  return (
    `🔗 ${escapeMarkdownV2(version.clientName)} todavía no abrió su enlace\\. ` +
    'Su rutina sigue esperando\\.'
  );
}
