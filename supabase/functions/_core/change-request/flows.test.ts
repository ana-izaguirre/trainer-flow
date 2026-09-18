/**
 * SPEC-010 — El cliente pide un cambio.
 *
 * ┌─ LO QUE MÁS IMPORTA AQUÍ ──────────────────────────────────────────────┐
 * │ Que pedir un cambio no toque la rutina enviada. Ni su contenido, ni su │
 * │ estado, ni su fecha: el cliente conserva en su chat exactamente lo que │
 * │ recibió (regla 4).                                                     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import { CHANGE_REASONS } from '../domain/change-request.ts';
import type {
  ChangeRequestRepo,
  VersionForRequest,
} from '../ports/change-request-ports.ts';
import {
  acceptVersion,
  addComment,
  askReason,
  requestChange,
  startRevision,
  type ChangeRequestDeps,
} from './flows.ts';

const VERSION_ID = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

const CLIENTE: Identity = {
  profileId: 'p-cliente',
  role: 'client',
  telegramUserId: 500,
  telegramChatId: 500,
};

const ENTRENADOR: Identity = {
  profileId: 'p-trainer',
  role: 'trainer',
  telegramUserId: 900,
  telegramChatId: 10,
};

function version(extra: Partial<VersionForRequest> = {}): VersionForRequest {
  return {
    versionId: VERSION_ID,
    state: 'SENT',
    planId: 'plan-1',
    clientName: 'Carlos Pérez',
    versionNumber: 1,
    trainerChatId: 10,
    client: { clientId: 'c1', trainerId: 'p-trainer', profileId: 'p-cliente' },
    ...extra,
  };
}

interface Espia {
  readonly deps: ChangeRequestDeps;
  readonly pasos: string[];
  readonly mensajes: { chatId: number; text: string; keyboard?: unknown }[];
}

function espia(
  opciones: {
    version?: VersionForRequest | null;
    comentarioFalla?: boolean;
    solicitud?: null;
  } = {},
): Espia {
  const pasos: string[] = [];
  const mensajes: { chatId: number; text: string; keyboard?: unknown }[] = [];

  const repo: ChangeRequestRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(opciones.version === undefined ? version() : opciones.version);
    },
    request: (_v, _c, reason) => {
      pasos.push(`request:${reason}`);
      return Promise.resolve('req-1');
    },
    openForClient: () => Promise.resolve(null),
    addComment: () => {
      pasos.push('addComment');
      return Promise.resolve(!(opciones.comentarioFalla ?? false));
    },
    findRequest: () =>
      opciones.solicitud === null
        ? Promise.resolve(null)
        : Promise.resolve({
            requestId: 'req-1',
            versionId: VERSION_ID,
            planId: 'plan-1',
            versionNumber: 1,
            state: 'OPEN' as const,
            reason: 'too_hard' as const,
            comment: 'No termino la semana 1',
            clientName: 'Carlos Pérez',
                trainerId: 'p-trainer',
                sentDaysAgo: 9,
          }),
    createRevision: (planId) => {
      pasos.push(`createRevision:${planId}`);
      return Promise.resolve('9f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b');
    },
    recordAccepted: () => {
      pasos.push('recordAccepted');
      return Promise.resolve();
    },
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (chatId, text, keyboard) => {
          pasos.push(`sendMessage:${chatId}`);
          mensajes.push({ chatId, text, ...(keyboard === undefined ? {} : { keyboard }) });
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    },
    pasos,
    mensajes,
  };
}

// ---------------------------------------------------------------------------

describe('🔴 la autorización es la misma para los tres botones del cliente', () => {
  const casos = [
    ['una versión que no existe', null],
    ['una versión ajena', version({ client: { clientId: 'c2', trainerId: 'p-trainer', profileId: 'otro' } })],
    ['CA-6 · una que no está enviada', version({ state: 'DRAFT' })],
    ['una aprobada pero sin enviar', version({ state: 'APPROVED' })],
  ] as const;

  it.each(casos)('👍 me sirve se deniega sobre %s', async (_n, v) => {
    const { deps, pasos, mensajes } = espia({ version: v });

    expect(await acceptVersion(VERSION_ID, CLIENTE, deps)).toEqual({ kind: 'denied' });
    expect(pasos).not.toContain('recordAccepted');
    // CA-7: la misma respuesta para las cuatro. Distinguirlas permitiría
    // averiguar qué versiones existen probando IDs.
    expect(mensajes[0]?.text).toContain('No puedo');
  });

  it.each(casos)('✏️ pedir un cambio se deniega sobre %s', async (_n, v) => {
    const { deps, mensajes } = espia({ version: v });

    expect(await askReason(VERSION_ID, CLIENTE, deps)).toEqual({ kind: 'denied' });
    // Ni siquiera se le enseñan los motivos: eso ya confirmaría que existe.
    expect(mensajes[0]?.keyboard).toBeUndefined();
  });

  it.each(casos)('el motivo se deniega sobre %s', async (_n, v) => {
    const { deps, pasos } = espia({ version: v });

    expect(await requestChange('too_hard', VERSION_ID, CLIENTE, deps)).toEqual({ kind: 'denied' });
    expect(pasos.some((p) => p.startsWith('request:'))).toBe(false);
  });

  it('un ENTRENADOR no puede pedirse un cambio a sí mismo', async () => {
    const { deps, pasos } = espia();

    expect(await requestChange('too_hard', VERSION_ID, ENTRENADOR, deps)).toEqual({
      kind: 'denied',
    });
    expect(pasos.some((p) => p.startsWith('request:'))).toBe(false);
  });
});

describe('👍 me sirve', () => {
  it('CA-9 · se registra y NO cambia el estado', async () => {
    // `SENT` ya es terminal: no hay estado al que ir.
    const { deps, pasos, mensajes } = espia();

    const outcome = await acceptVersion(VERSION_ID, CLIENTE, deps);

    expect(outcome).toEqual({ kind: 'accepted', versionId: VERSION_ID });
    expect(pasos).toContain('recordAccepted');
    expect(mensajes[0]?.chatId).toBe(500);
  });
});

describe('✏️ pedir un cambio', () => {
  it('primero se preguntan los motivos, sin guardar nada', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await askReason(VERSION_ID, CLIENTE, deps);

    expect(outcome).toMatchObject({ kind: 'asked_reason' });
    expect(pasos.some((p) => p.startsWith('request:'))).toBe(false);
    expect(mensajes[0]?.keyboard).toBeDefined();
  });

  it('los siete motivos van en el teclado', async () => {
    const { deps, mensajes } = espia();

    await askReason(VERSION_ID, CLIENTE, deps);

    const k = mensajes[0]!.keyboard as { inline_keyboard: unknown[][] };
    expect(k.inline_keyboard.flat()).toHaveLength(CHANGE_REASONS.length);
  });

  it.each(CHANGE_REASONS)('CA-1 · el motivo %s se guarda', async (reason) => {
    const { deps, pasos } = espia();

    const outcome = await requestChange(reason, VERSION_ID, CLIENTE, deps);

    expect(outcome).toMatchObject({ kind: 'requested' });
    expect(pasos).toContain(`request:${reason}`);
  });

  it('el entrenador se entera EN EL MOMENTO, con el botón de la v2', async () => {
    const { deps, mensajes } = espia();

    await requestChange('too_hard', VERSION_ID, CLIENTE, deps);

    const alEntrenador = mensajes.find((m) => m.chatId === 10);
    expect(alEntrenador?.text).toContain('Carlos');
    expect(alEntrenador?.text).toContain('Muy difícil');
    expect(alEntrenador?.keyboard).toBeDefined();
  });

  it('al cliente se le invita a escribir el detalle', async () => {
    const { deps, mensajes } = espia();

    await requestChange('other', VERSION_ID, CLIENTE, deps);

    expect(mensajes.find((m) => m.chatId === 500)?.text).toContain('detalle');
  });
});

describe('el comentario', () => {
  it('se guarda y se le reenvía al entrenador', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await addComment('req-1', 'c1', 'No termino la semana 1', CLIENTE, deps);

    expect(outcome).toMatchObject({ kind: 'commented' });
    expect(pasos).toContain('addComment');
    expect(mensajes.find((m) => m.chatId === 10)?.text).toContain('No termino');
  });

  it('si la solicitud desaparece entre guardar y leer, no revienta', async () => {
    const { deps, mensajes } = espia({ solicitud: null });

    expect(await addComment('req-1', 'c1', 'hola', CLIENTE, deps)).toEqual({ kind: 'denied' });
    expect(mensajes).toEqual([]);
  });

  it('sobre una solicitud que ya no es suya, no se guarda', async () => {
    const { deps, mensajes } = espia({ comentarioFalla: true });

    expect(await addComment('req-1', 'c1', 'hola', CLIENTE, deps)).toEqual({ kind: 'denied' });
    expect(mensajes).toEqual([]);
  });
});

describe('✏️ crear v2', () => {
  it('CA-2 · crea la versión y ofrece los tres caminos de SPEC-008', async () => {
    // No hay un camino especial por ser revisión: es el mismo que la primera.
    const { deps, pasos, mensajes } = espia();

    const outcome = await startRevision(VERSION_ID, ENTRENADOR, deps);

    expect(outcome).toMatchObject({ kind: 'revision_started' });
    expect(pasos).toContain('createRevision:plan-1');
    expect(mensajes.at(-1)?.keyboard).toBeDefined();
  });

  it('CA-12 · NO resuelve la solicitud: eso pasa al enviar', async () => {
    // Una revisión abandonada dejaría al cliente sin respuesta y sin solicitud
    // abierta que lo recordara.
    const { deps, pasos } = espia();

    await startRevision(VERSION_ID, ENTRENADOR, deps);

    expect(pasos.some((p) => p.includes('resolve'))).toBe(false);
  });

  it('un CLIENTE no puede crear la revisión', async () => {
    const { deps, pasos } = espia();

    expect(await startRevision(VERSION_ID, CLIENTE, deps)).toEqual({ kind: 'denied' });
    expect(pasos.some((p) => p.startsWith('createRevision'))).toBe(false);
  });

  it('OTRO entrenador tampoco', async () => {
    const { deps, pasos } = espia();

    const outcome = await startRevision(VERSION_ID, { ...ENTRENADOR, profileId: 'otro' }, deps);

    expect(outcome).toEqual({ kind: 'denied' });
    expect(pasos.some((p) => p.startsWith('createRevision'))).toBe(false);
  });

  it('sobre una versión que no existe, tampoco', async () => {
    const { deps, pasos } = espia({ version: null });

    expect(await startRevision(VERSION_ID, ENTRENADOR, deps)).toEqual({ kind: 'denied' });
    expect(pasos.some((p) => p.startsWith('createRevision'))).toBe(false);
  });
});
