/**
 * SPEC-006 — La pasada semanal: a quién le toca check-in y a quién recordarle.
 *
 * ┌─ CREAR, ENVIAR, Y SOLO ENTONCES MARCAR ────────────────────────────────┐
 * │ Es el mismo orden que la entrega de la rutina, y por la misma razón:   │
 * │ marcar antes de enviar produce un check-in que consta como mandado y   │
 * │ que nadie recibió. Nunca se vuelve a intentar, y el cliente se queda   │
 * │ esa semana sin que se lo pregunten.                                    │
 * │                                                                        │
 * │ Al revés el riesgo es preguntar dos veces, que es molesto y no grave.  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Un fallo con un cliente NO puede dejar sin check-in a los demás: cada uno
 * va en su propio `try`.
 */
import type { CheckinRepo } from '../ports/checkin-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { buildCheckinMessage, buildReminderMessage } from './format.ts';
import { needsReminder, shouldSendCheckin } from './schedule.ts';

export interface CheckinRunDeps {
  readonly repo: CheckinRepo;
  readonly sender: TelegramSender;
}

export interface CheckinRunResult {
  readonly sent: number;
  readonly reminded: number;
  readonly skipped: number;
  /** Cuántos fallaron al enviar. El detalle va a los logs, no aquí. */
  readonly failed: number;
}

export async function runWeeklyCheckins(
  deps: CheckinRunDeps,
  now: Date,
): Promise<CheckinRunResult> {
  let sent = 0;
  let reminded = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of await deps.repo.candidates()) {
    const decision = shouldSendCheckin(
      {
        state: candidate.state,
        sentAt: candidate.sentAt,
        lastWeekSent: candidate.lastWeekSent,
        linked: candidate.clientChatId !== null,
      },
      now,
    );

    if (!decision.send || candidate.clientChatId === null) {
      skipped += 1;
      continue;
    }

    try {
      // El UNIQUE de la tabla es lo que impide el duplicado (regla 3). Si ya
      // existía, se devuelve el mismo id y se reintenta el envío.
      const checkinId = await deps.repo.createCheckin(
        candidate.clientId,
        candidate.versionId,
        decision.weekNumber,
      );

      const mensaje = buildCheckinMessage(decision.weekNumber, checkinId);
      await deps.sender.sendMessage(candidate.clientChatId, mensaje.text, mensaje.keyboard);
      await deps.repo.markSent(checkinId);
      sent += 1;
    } catch {
      // El cliente pudo bloquear el bot. La fila se queda sin `sent_at` y la
      // semana que viene se reintenta sola.
      failed += 1;
    }
  }

  for (const checkin of await deps.repo.pendingReminders()) {
    if (!needsReminder(checkin, now)) {
      skipped += 1;
      continue;
    }

    try {
      const mensaje = buildReminderMessage(checkin.weekNumber, checkin.checkinId);
      await deps.sender.sendMessage(checkin.clientChatId, mensaje.text, mensaje.keyboard);
      await deps.repo.markReminded(checkin.checkinId);
      reminded += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, reminded, skipped, failed };
}
