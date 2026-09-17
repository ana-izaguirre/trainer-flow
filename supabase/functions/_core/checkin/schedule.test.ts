/**
 * SPEC-006 — Cuándo toca un check-in, y de qué semana.
 *
 * ┌─ POR QUÉ ESTO ES PURO Y NO UNA CONSULTA SQL ───────────────────────────┐
 * │ El número de semana decide QUÉ check-in se crea, y el `UNIQUE` de la   │
 * │ tabla decide que no se duplique. Si el cálculo se fuera un día, el     │
 * │ cron crearía la semana 2 el mismo lunes que la 1 y el UNIQUE no lo     │
 * │ vería: son claves distintas.                                          │
 * │                                                                        │
 * │ La idempotencia del cron depende de que esto sea correcto, así que se  │
 * │ prueba aparte y con los bordes.                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import { calculateWeekNumber, shouldSendCheckin, needsReminder } from './schedule.ts';

const enviada = (dias: number) => new Date(Date.UTC(2026, 0, 1 + dias, 9, 0, 0));
const LUNES = new Date(Date.UTC(2026, 0, 1, 9, 0, 0));

// ---------------------------------------------------------------------------

describe('de qué semana es el check-in', () => {
  it.each([
    [7, 1],
    [8, 1],
    [13, 1],
    [14, 2],
    [21, 3],
    [70, 10],
  ])('a los %s días de enviada, es la semana %s', (dias, semana) => {
    expect(calculateWeekNumber(LUNES, enviada(dias))).toBe(semana);
  });

  it('antes de los 7 días no hay semana que preguntar', () => {
    // El primer check-in es tras la PRIMERA semana entrenada, no el día de la
    // entrega: no hay nada que contar todavía.
    for (const dias of [0, 1, 6]) {
      expect(calculateWeekNumber(LUNES, enviada(dias))).toBe(0);
    }
  });

  it('a los 7 días exactos ya cuenta', () => {
    // El borde: excluirlo retrasaría cada check-in una semana entera.
    expect(calculateWeekNumber(LUNES, enviada(7))).toBe(1);
  });

  it('una hora antes de los 7 días todavía no', () => {
    const casiSiete = new Date(LUNES.getTime() + 7 * 86_400_000 - 3_600_000);
    expect(calculateWeekNumber(LUNES, casiSiete)).toBe(0);
  });

  it('una fecha de envío en el futuro no da semanas negativas', () => {
    // Relojes desincronizados no pueden producir un `week_number` que viole
    // el CHECK de la tabla.
    expect(calculateWeekNumber(enviada(10), LUNES)).toBe(0);
  });
});

describe('a quién le toca', () => {
  const base = { state: 'SENT' as const, sentAt: LUNES, lastWeekSent: 0, linked: true };

  it('un plan enviado hace 7 días, sí', () => {
    expect(shouldSendCheckin({ ...base }, enviada(7))).toEqual({ send: true, weekNumber: 1 });
  });

  it('un plan que no está en SENT, no', () => {
    // CA-6. Una rutina aprobada pero no entregada no tiene semanas que contar.
    for (const state of ['NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'REJECTED'] as const) {
      expect(shouldSendCheckin({ ...base, state }, enviada(7)).send).toBe(false);
    }
  });

  it('un cliente sin vincular, no', () => {
    // No hay dónde mandárselo.
    expect(shouldSendCheckin({ ...base, linked: false }, enviada(7)).send).toBe(false);
  });

  it('si ya se mandó el de esta semana, no se repite', () => {
    // CA-2. El UNIQUE de la tabla es la garantía dura; esto evita el intento.
    expect(shouldSendCheckin({ ...base, lastWeekSent: 1 }, enviada(7)).send).toBe(false);
  });

  it('pero el de la semana siguiente sí sale', () => {
    // Regla 8: un check-in sin responder no bloquea el de la semana que viene.
    expect(shouldSendCheckin({ ...base, lastWeekSent: 1 }, enviada(14))).toEqual({
      send: true,
      weekNumber: 2,
    });
  });

  it('antes de la primera semana, no', () => {
    expect(shouldSendCheckin({ ...base }, enviada(3)).send).toBe(false);
  });

  it('si el cron se saltó una semana, manda la que toca AHORA', () => {
    // No se envían atrasados: preguntar por la semana 2 cuando va por la 4
    // pide un recuerdo que el cliente ya no tiene.
    expect(shouldSendCheckin({ ...base, lastWeekSent: 1 }, enviada(28))).toEqual({
      send: true,
      weekNumber: 4,
    });
  });
});

describe('el recordatorio', () => {
  const pendiente = { state: 'PENDING' as const, sentAt: LUNES, reminderSentAt: null };

  it('a las 48 horas sin responder', () => {
    expect(needsReminder(pendiente, enviada(2))).toBe(true);
  });

  it('antes de las 48, no', () => {
    expect(needsReminder(pendiente, enviada(1))).toBe(false);
  });

  it('solo UNO: si ya se mandó, no se repite', () => {
    // CA-5. Recordar dos veces al que no contestó es acoso, no servicio.
    expect(needsReminder({ ...pendiente, reminderSentAt: enviada(2) }, enviada(5))).toBe(false);
  });

  it('un check-in ya respondido no se recuerda', () => {
    expect(needsReminder({ ...pendiente, state: 'COMPLETED' }, enviada(5))).toBe(false);
  });
});
