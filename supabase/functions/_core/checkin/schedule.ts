/**
 * SPEC-006 — Cuándo toca un check-in, y de qué semana.
 *
 * ┌─ POR QUÉ ESTO ES PURO Y NO UNA CONSULTA SQL ───────────────────────────┐
 * │ El número de semana decide QUÉ check-in se crea, y el                  │
 * │ `UNIQUE (client_id, version_id, week_number)` decide que no se         │
 * │ duplique. Si el cálculo se fuera un día, el cron crearía la semana 2   │
 * │ el mismo lunes que la 1 y el UNIQUE no lo vería: son claves distintas. │
 * │                                                                        │
 * │ La idempotencia del cron depende de que esto sea correcto.             │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { VersionState } from '../domain/version.ts';

const MS_POR_DIA = 86_400_000;
const DIAS_POR_SEMANA = 7;
const HORAS_HASTA_EL_RECORDATORIO = 48;

/**
 * Cuántas semanas completas pasaron desde la entrega.
 *
 * `0` significa «todavía no hay nada que preguntar»: el primer check-in es
 * tras la PRIMERA semana entrenada, no el día de la entrega.
 *
 * Nunca negativo: un reloj desincronizado no puede producir un `week_number`
 * que viole el CHECK de la tabla.
 */
export function calculateWeekNumber(sentAt: Date, now: Date): number {
  const dias = (now.getTime() - sentAt.getTime()) / MS_POR_DIA;
  return Math.max(0, Math.floor(dias / DIAS_POR_SEMANA));
}

export interface CheckinCandidate {
  readonly state: VersionState;
  readonly sentAt: Date;
  /** La última semana de la que ya se mandó check-in. `0` si ninguna. */
  readonly lastWeekSent: number;
  readonly linked: boolean;
}

export type CheckinDecision =
  | { readonly send: true; readonly weekNumber: number }
  | { readonly send: false };

const NO: CheckinDecision = { send: false };

export function shouldSendCheckin(candidate: CheckinCandidate, now: Date): CheckinDecision {
  // Solo una rutina entregada tiene semanas que contar (regla 1).
  if (candidate.state !== 'SENT') return NO;

  // Sin vincular no hay dónde mandarlo.
  if (!candidate.linked) return NO;

  const semana = calculateWeekNumber(candidate.sentAt, now);
  if (semana < 1) return NO;

  // Se manda la semana que toca AHORA, no las atrasadas: preguntar por la
  // semana 2 cuando va por la 4 pide un recuerdo que el cliente ya no tiene.
  //
  // Y un check-in sin responder no bloquea el siguiente (regla 8): lo que se
  // compara es la semana, no si la anterior se contestó.
  if (semana <= candidate.lastWeekSent) return NO;

  return { send: true, weekNumber: semana };
}

export interface PendingCheckin {
  readonly state: 'PENDING' | 'COMPLETED';
  readonly sentAt: Date;
  readonly reminderSentAt: Date | null;
}

/**
 * Un único recordatorio a las 48 horas (regla 6).
 *
 * Recordar dos veces al que no contestó es acoso, no servicio.
 */
export function needsReminder(checkin: PendingCheckin, now: Date): boolean {
  if (checkin.state !== 'PENDING') return false;
  if (checkin.reminderSentAt !== null) return false;

  const horas = (now.getTime() - checkin.sentAt.getTime()) / 3_600_000;
  return horas >= HORAS_HASTA_EL_RECORDATORIO;
}
