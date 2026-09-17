/**
 * SPEC-006 — La pasada semanal.
 *
 * Lo que estos tests protegen: que un fallo con un cliente no deje sin
 * check-in a los demás, y que marcar «enviado» ocurra DESPUÉS de enviar.
 */
import { describe, expect, it } from 'vitest';
import type { CheckinCandidate, CheckinRepo, CheckinToRemind } from '../ports/checkin-ports.ts';
import { runWeeklyCheckins, type CheckinRunDeps } from './send.ts';

const LUNES = new Date('2026-03-16T09:00:00Z');
/** Entregada hace 8 días: toca la semana 1. */
const HACE_OCHO_DIAS = new Date('2026-03-08T09:00:00Z');

function candidato(overrides: Partial<CheckinCandidate> = {}): CheckinCandidate {
  return {
    clientId: 'c1',
    clientName: 'Carlos',
    clientChatId: 500,
    versionId: 'v1',
    state: 'SENT',
    sentAt: HACE_OCHO_DIAS,
    lastWeekSent: 0,
    ...overrides,
  };
}

function espia(
  opciones: {
    candidatos?: readonly CheckinCandidate[];
    recordatorios?: readonly CheckinToRemind[];
    fallaCon?: number;
  } = {},
): { deps: CheckinRunDeps; pasos: string[] } {
  const pasos: string[] = [];

  const repo: CheckinRepo = {
    candidates: () => Promise.resolve(opciones.candidatos ?? [candidato()]),
    createCheckin: (clientId, _v, week) => {
      pasos.push(`createCheckin:${clientId}:${week}`);
      return Promise.resolve(`chk-${clientId}-${week}`);
    },
    markSent: (id) => {
      pasos.push(`markSent:${id}`);
      return Promise.resolve();
    },
    pendingReminders: () => Promise.resolve(opciones.recordatorios ?? []),
    markReminded: (id) => {
      pasos.push(`markReminded:${id}`);
      return Promise.resolve();
    },
    findCheckin: () => Promise.resolve(null),
    findOpenCheckin: () => Promise.resolve(null),
    saveAnswers: () => Promise.resolve(),
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (chatId) => {
          pasos.push(`sendMessage:${chatId}`);
          if (chatId === opciones.fallaCon) {
            return Promise.reject(new Error('el cliente bloqueó el bot'));
          }
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    },
    pasos,
  };
}

/** Un check-in enviado 48 h antes del lunes: justo en el borde. */
function pendiente(overrides: Partial<CheckinToRemind> = {}): CheckinToRemind {
  return {
    checkinId: 'chk-1',
    clientChatId: 500,
    weekNumber: 1,
    state: 'PENDING',
    sentAt: new Date('2026-03-14T09:00:00Z'),
    reminderSentAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('a quién le toca', () => {
  it('CA-1 · una rutina entregada hace 8 días recibe el de la semana 1', async () => {
    const { deps, pasos } = espia();

    const resultado = await runWeeklyCheckins(deps, LUNES);

    expect(resultado).toMatchObject({ sent: 1, failed: 0 });
    expect(pasos).toContain('createCheckin:c1:1');
  });

  it('CA-6 · sin rutina entregada no recibe nada', async () => {
    const { deps, pasos } = espia({ candidatos: [candidato({ state: 'APPROVED' })] });

    const resultado = await runWeeklyCheckins(deps, LUNES);

    expect(resultado).toMatchObject({ sent: 0, skipped: 1 });
    expect(pasos).toEqual([]);
  });

  it('un cliente sin vincular se omite', async () => {
    const { deps, pasos } = espia({ candidatos: [candidato({ clientChatId: null })] });

    await runWeeklyCheckins(deps, LUNES);

    expect(pasos).toEqual([]);
  });

  it('la semana de la que ya salió uno no se repite', async () => {
    // CA-2, en el dominio: aquí ni se intenta. La garantía dura es el UNIQUE.
    const { deps, pasos } = espia({ candidatos: [candidato({ lastWeekSent: 1 })] });

    await runWeeklyCheckins(deps, LUNES);

    expect(pasos).toEqual([]);
  });

  it('el mismo día de la entrega todavía no hay nada que preguntar', async () => {
    const { deps, pasos } = espia({ candidatos: [candidato({ sentAt: LUNES })] });

    await runWeeklyCheckins(deps, LUNES);

    expect(pasos).toEqual([]);
  });
});

describe('el orden del envío', () => {
  it('se marca enviado DESPUÉS de enviar', async () => {
    // Al revés, un check-in constaría como mandado sin que nadie lo recibiera,
    // y no se volvería a intentar nunca.
    const { deps, pasos } = espia();

    await runWeeklyCheckins(deps, LUNES);

    expect(pasos.indexOf('sendMessage:500')).toBeLessThan(pasos.indexOf('markSent:chk-c1-1'));
  });

  it('si el envío falla, NO se marca enviado', async () => {
    const { deps, pasos } = espia({ fallaCon: 500 });

    const resultado = await runWeeklyCheckins(deps, LUNES);

    expect(resultado).toMatchObject({ sent: 0, failed: 1 });
    expect(pasos.some((p) => p.startsWith('markSent'))).toBe(false);
  });

  it('un cliente que falla no deja sin check-in a los demás', async () => {
    const { deps, pasos } = espia({
      candidatos: [
        candidato({ clientId: 'c1', clientChatId: 500 }),
        candidato({ clientId: 'c2', clientChatId: 600 }),
      ],
      fallaCon: 500,
    });

    const resultado = await runWeeklyCheckins(deps, LUNES);

    expect(resultado).toMatchObject({ sent: 1, failed: 1 });
    expect(pasos).toContain('markSent:chk-c2-1');
  });
});

describe('el recordatorio', () => {
  it('CA-5 · a las 48 horas sale uno', async () => {
    const { deps, pasos } = espia({ candidatos: [], recordatorios: [pendiente()] });

    const resultado = await runWeeklyCheckins(deps, LUNES);

    expect(resultado.reminded).toBe(1);
    expect(pasos).toContain('markReminded:chk-1');
  });

  it('CA-5 · y SOLO uno', async () => {
    // Recordar dos veces al que no contestó es acoso, no servicio.
    const { deps, pasos } = espia({
      candidatos: [],
      recordatorios: [pendiente({ reminderSentAt: new Date('2026-03-15T09:00:00Z') })],
    });

    await runWeeklyCheckins(deps, LUNES);

    expect(pasos).toEqual([]);
  });

  it('uno ya contestado no se recuerda', async () => {
    const { deps, pasos } = espia({
      candidatos: [],
      recordatorios: [pendiente({ state: 'COMPLETED' })],
    });

    await runWeeklyCheckins(deps, LUNES);

    expect(pasos).toEqual([]);
  });

  it('un recordatorio que falla no tumba la pasada', async () => {
    const { deps } = espia({ candidatos: [], recordatorios: [pendiente()], fallaCon: 500 });

    const resultado = await runWeeklyCheckins(deps, LUNES);

    expect(resultado).toMatchObject({ reminded: 0, failed: 1 });
  });
});
