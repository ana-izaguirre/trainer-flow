/**
 * SPEC-006 — Lo que pasa cuando el cliente contesta.
 *
 * Las dos cosas que protege este archivo:
 *
 *   · Nadie contesta el check-in de otro (CA-7). El `checkinId` viaja en el
 *     `callback_data` y cualquiera puede fabricarlo.
 *   · Una molestia avisa al entrenador EN EL MOMENTO, sin esperar a que el
 *     check-in esté completo (regla 7).
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import type { CheckinForReply, CheckinRepo } from '../ports/checkin-ports.ts';
import type { CheckinAnswers } from './answers.ts';
import { handleCheckinAnswer, handleCheckinText, type ReplyDeps } from './reply.ts';

const CLIENTE: Identity = {
  profileId: 'p-cliente',
  role: 'client',
  telegramUserId: 500,
  telegramChatId: 500,
};

const VACIAS: CheckinAnswers = { sessions: null, feeling: null, discomfort: null };
const CHECKIN_ID = 'chk-1';

function checkin(overrides: Partial<CheckinForReply> = {}): CheckinForReply {
  return {
    checkinId: CHECKIN_ID,
    clientProfileId: 'p-cliente',
    clientName: 'Carlos',
    weekNumber: 3,
    state: 'PENDING',
    answers: VACIAS,
    trainerChatId: 10,
    daysPerWeek: 4,
    ...overrides,
  };
}

interface Espia {
  readonly deps: ReplyDeps;
  readonly pasos: string[];
  readonly mensajes: { chatId: number; text: string }[];
  readonly guardadas: CheckinAnswers[];
}

function espia(opciones: { registro?: CheckinForReply | null } = {}): Espia {
  const pasos: string[] = [];
  const mensajes: { chatId: number; text: string }[] = [];
  const guardadas: CheckinAnswers[] = [];
  const registro = opciones.registro === undefined ? checkin() : opciones.registro;

  const repo: CheckinRepo = {
    candidates: () => Promise.resolve([]),
    createCheckin: () => Promise.resolve(CHECKIN_ID),
    markSent: () => Promise.resolve(),
    pendingReminders: () => Promise.resolve([]),
    markReminded: () => Promise.resolve(),
    findCheckin: () => {
      pasos.push('findCheckin');
      return Promise.resolve(registro);
    },
    findOpenCheckin: () => {
      pasos.push('findOpenCheckin');
      return Promise.resolve(registro);
    },
    saveAnswers: (_id, answers, completed) => {
      pasos.push(`saveAnswers:${completed}`);
      guardadas.push(answers);
      return Promise.resolve();
    },
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (chatId, text) => {
          pasos.push(`sendMessage:${chatId}`);
          mensajes.push({ chatId, text });
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    },
    pasos,
    mensajes,
    guardadas,
  };
}

// ---------------------------------------------------------------------------

describe('CA-7 · solo se contesta el check-in propio', () => {
  it.each([
    ['uno de otro cliente', checkin({ clientProfileId: 'otro-perfil' })],
    ['uno sin dueño', checkin({ clientProfileId: null })],
    ['uno que no existe', null],
    ['uno ya cerrado', checkin({ state: 'COMPLETED' as const })],
  ])('rechaza %s', async (_nombre, registro) => {
    const { deps, pasos, mensajes } = espia({ registro });

    const outcome = await handleCheckinAnswer(
      CHECKIN_ID,
      { field: 'feeling', value: 'good' },
      CLIENTE,
      deps,
    );

    expect(outcome).toEqual({ kind: 'rejected' });
    expect(pasos.some((p) => p.startsWith('saveAnswers'))).toBe(false);
    // La misma respuesta para los cuatro: distinguirlos permitiría enumerar.
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]?.chatId).toBe(500);
  });
});

describe('guardar una respuesta', () => {
  it('una sola respuesta no completa el check-in', async () => {
    const { deps, pasos, guardadas } = espia();

    const outcome = await handleCheckinAnswer(
      CHECKIN_ID,
      { field: 'sessions', value: '3' },
      CLIENTE,
      deps,
    );

    expect(outcome).toMatchObject({ kind: 'saved', completed: false });
    expect(guardadas[0]?.sessions).toBe(3);
    expect(pasos).toContain('saveAnswers:false');
  });

  it('la tercera lo completa y se le dan las gracias', async () => {
    // CA-3.
    const { deps, mensajes } = espia({
      registro: checkin({ answers: { sessions: 3, feeling: 'good', discomfort: null } }),
    });

    const outcome = await handleCheckinAnswer(
      CHECKIN_ID,
      { field: 'discomfort', value: 'none' },
      CLIENTE,
      deps,
    );

    expect(outcome).toMatchObject({ kind: 'saved', completed: true });
    expect(mensajes.some((m) => m.chatId === 500 && m.text.includes('Anotado'))).toBe(true);
  });

  it('el cero cuenta como respuesta', async () => {
    // «Cero sesiones» es la respuesta más importante de todas.
    const { deps, guardadas } = espia({
      registro: checkin({ answers: { sessions: null, feeling: 'hard', discomfort: '' } }),
    });

    const outcome = await handleCheckinAnswer(
      CHECKIN_ID,
      { field: 'sessions', value: '0' },
      CLIENTE,
      deps,
    );

    expect(guardadas[0]?.sessions).toBe(0);
    expect(outcome).toMatchObject({ completed: true });
  });
});

describe('regla 7 · el aviso al entrenador no espera', () => {
  it('CA-4 · una molestia avisa EN EL MOMENTO', async () => {
    const { deps, mensajes } = espia();

    const outcome = await handleCheckinText('me molesta el hombro derecho', CLIENTE, deps);

    expect(outcome).toMatchObject({ trainerAlerted: true, completed: false });
    const alEntrenador = mensajes.find((m) => m.chatId === 10);
    expect(alEntrenador?.text).toContain('hombro');
    expect(alEntrenador?.text).toContain('Carlos');
  });

  it('el aviso sale aunque el check-in NO esté completo', async () => {
    // Esperar a las tres respuestas retrasaría el aviso días.
    const { deps, pasos } = espia();

    await handleCheckinText('me duele la rodilla', CLIENTE, deps);

    expect(pasos).toContain('sendMessage:10');
    expect(pasos).toContain('saveAnswers:false');
  });

  it('un «muy duro» también avisa', async () => {
    // Tres semanas de eso sin que nadie mire es cómo se abandona un plan.
    const { deps, mensajes } = espia();

    const outcome = await handleCheckinAnswer(
      CHECKIN_ID,
      { field: 'feeling', value: 'hard' },
      CLIENTE,
      deps,
    );

    expect(outcome).toMatchObject({ trainerAlerted: true });
    expect(mensajes.some((m) => m.chatId === 10 && m.text.includes('dura'))).toBe(true);
  });

  it('«ninguna molestia» NO avisa', async () => {
    const { deps, mensajes } = espia();

    const outcome = await handleCheckinAnswer(
      CHECKIN_ID,
      { field: 'discomfort', value: 'none' },
      CLIENTE,
      deps,
    );

    expect(outcome).toMatchObject({ trainerAlerted: false });
    expect(mensajes.some((m) => m.chatId === 10)).toBe(false);
  });

  it('un «bien» tampoco', async () => {
    const { deps, mensajes } = espia();

    await handleCheckinAnswer(CHECKIN_ID, { field: 'feeling', value: 'good' }, CLIENTE, deps);

    expect(mensajes.some((m) => m.chatId === 10)).toBe(false);
  });
});

describe('un texto suelto', () => {
  it('sin check-in abierto no es una respuesta', async () => {
    const { deps, pasos } = espia({ registro: null });

    const outcome = await handleCheckinText('hola', CLIENTE, deps);

    expect(outcome).toEqual({ kind: 'no_open_checkin' });
    expect(pasos.some((p) => p.startsWith('saveAnswers'))).toBe(false);
  });

  it('si ya contestó la molestia, un mensaje nuevo no la pisa', async () => {
    // Si no, contarle algo al bot después borraría lo que reportó.
    const { deps, pasos } = espia({
      registro: checkin({ answers: { sessions: null, feeling: null, discomfort: '' } }),
    });

    const outcome = await handleCheckinText('por cierto, gracias', CLIENTE, deps);

    expect(outcome).toEqual({ kind: 'no_open_checkin' });
    expect(pasos.some((p) => p.startsWith('saveAnswers'))).toBe(false);
  });

  it('un texto larguísimo se trunca a 500', async () => {
    const { deps, guardadas } = espia();

    await handleCheckinText('a'.repeat(900), CLIENTE, deps);

    expect(guardadas[0]?.discomfort).toHaveLength(500);
  });
});
