/**
 * SPEC-010, SPEC-030 — El cliente pide un cambio.
 *
 * ┌─ LO QUE MÁS IMPORTA AQUÍ ──────────────────────────────────────────────┐
 * │ Que pedir un cambio no toque la rutina enviada. Ni su contenido, ni su │
 * │ estado, ni su fecha: el cliente conserva en su chat exactamente lo que │
 * │ recibió (regla 4).                                                     │
 * │                                                                        │
 * │ Y que pulsar dos veces, o escribir dos mensajes, no lo deje en         │
 * │ silencio ni avise al entrenador de más (SPEC-030).                     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import { CHANGE_REASONS } from '../domain/change-request.ts';
import type {
  ChangeRequestRepo,
  OpenRequest,
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
const AHORA = new Date('2026-09-26T12:00:00Z');

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
    // Por defecto, nadie empezó una revisión todavía: la vigente es esta
    // misma v1, en SENT. Los tests que simulan una v2 ya en marcha pisan
    // estos tres campos.
    currentVersionId: VERSION_ID,
    currentVersionState: 'SENT',
    currentVersionNumber: 1,
    ...extra,
  };
}

function abierta(extra: Partial<OpenRequest> = {}): OpenRequest {
  return {
    requestId: 'req-1',
    clientId: 'c1',
    versionId: VERSION_ID,
    reason: 'too_hard',
    hasComment: false,
    askedAt: new Date('2026-09-24T12:00:00Z'),
    createdAt: new Date('2026-09-24T12:00:00Z'),
    ...extra,
  };
}

interface Espia {
  readonly deps: ChangeRequestDeps;
  readonly pasos: string[];
  readonly mensajes: {
    chatId: number;
    text: string;
    keyboard?: unknown;
    forceReply?: boolean;
  }[];
}

function espia(
  opciones: {
    version?: VersionForRequest | null;
    comentarioFalla?: boolean;
    abierta?: OpenRequest | null;
    created?: boolean;
    perdioCarrera?: boolean;
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
      return Promise.resolve({ id: 'req-1', created: opciones.created ?? true });
    },
    openForClient: () => {
      pasos.push('openForClient');
      return Promise.resolve(opciones.abierta ?? null);
    },
    touchAsk: () => {
      pasos.push('touchAsk');
      return Promise.resolve(true);
    },
    addComment: () => {
      pasos.push('addComment');
      return Promise.resolve(
        opciones.comentarioFalla ?? false
          ? { saved: false, truncated: false }
          : { saved: true, truncated: false },
      );
    },
    findRequest: () =>
      Promise.resolve({
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
    createRevisionIfCurrent: (planId, _trainerId, expected) => {
      pasos.push(`createRevisionIfCurrent:${planId}:${expected}`);
      return Promise.resolve(
        opciones.perdioCarrera ?? false ? null : '9f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
      );
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
        sendMessage: (chatId, text, keyboard, forceReply) => {
          pasos.push(`sendMessage:${chatId}`);
          mensajes.push({
            chatId,
            text,
            ...(keyboard === undefined ? {} : { keyboard }),
            ...(forceReply === undefined ? {} : { forceReply }),
          });
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
      now: () => AHORA,
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
    // Es un aviso, no una pregunta: no lleva `force_reply`.
    expect(alEntrenador?.forceReply).toBeUndefined();
  });

  it('al cliente se le invita a escribir el detalle', async () => {
    const { deps, mensajes } = espia();

    await requestChange('other', VERSION_ID, CLIENTE, deps);

    const alCliente = mensajes.find((m) => m.chatId === 500);
    expect(alCliente?.text).toContain('detalle');
    // SPEC-030 regla 3: Telegram enlaza el teclado a la respuesta.
    expect(alCliente?.forceReply).toBe(true);
  });

  // -------------------------------------------------------------------------
  // SPEC-030 regla 1 y 2 — una abierta no se pisa, y no se avisa dos veces.

  describe('SPEC-030 · ya hay una solicitud abierta', () => {
    it('CA-1 · askReason enseña el estado, no el menú de motivos', async () => {
      const { deps, mensajes, pasos } = espia({ abierta: abierta() });

      const outcome = await askReason(VERSION_ID, CLIENTE, deps);

      expect(outcome).toEqual({ kind: 'already_requested', requestId: 'req-1' });
      expect(mensajes[0]?.keyboard).toBeFalsy();
      expect(mensajes[0]?.text).toContain('Ya le pediste un cambio');
      expect(mensajes[0]?.text).toContain('Muy difícil');
      // SPEC-030 regla 3: también invita a escribir, así que también enlaza.
      expect(mensajes[0]?.forceReply).toBe(true);
      expect(pasos).toContain('touchAsk');
    });

    it('CA-1, CA-2 · elegir un motivo NO crea otra fila ni avisa dos veces', async () => {
      const { deps, mensajes, pasos } = espia({ created: false, abierta: abierta() });

      const outcome = await requestChange('too_easy', VERSION_ID, CLIENTE, deps);

      expect(outcome).toEqual({ kind: 'already_requested', requestId: 'req-1' });
      // Un único mensaje: el estado. Nada al entrenador.
      expect(mensajes).toHaveLength(1);
      expect(mensajes[0]?.chatId).toBe(500);
      expect(mensajes.some((m) => m.chatId === 10)).toBe(false);
      expect(pasos).toContain('touchAsk');
    });

    it('caso defensivo: created=false pero openForClient ya no la encuentra', async () => {
      // No debería pasar en la práctica —`created=false` implica que la
      // base ya tenía una fila abierta—, pero el cliente nunca se queda
      // sin respuesta (regla 8) aunque la carrera diera este resultado raro.
      const { deps } = espia({ created: false, abierta: null });

      const outcome = await requestChange('too_hard', VERSION_ID, CLIENTE, deps);

      expect(outcome).toEqual({ kind: 'already_requested', requestId: 'req-1' });
    });

    it('el estado dice hace cuántos días se pidió', async () => {
      const { deps, mensajes } = espia({
        abierta: abierta({ createdAt: new Date('2026-09-23T12:00:00Z') }),
      });

      await askReason(VERSION_ID, CLIENTE, deps);

      expect(mensajes[0]?.text).toContain('hace 3 días');
    });

    it('pedida ayer, dice «hace 1 día» en singular', async () => {
      const { deps, mensajes } = espia({
        abierta: abierta({ createdAt: new Date('2026-09-25T12:00:00Z') }),
      });

      await askReason(VERSION_ID, CLIENTE, deps);

      expect(mensajes[0]?.text).toContain('hace 1 día:');
    });

    it('pedida hoy mismo, dice «hoy»', async () => {
      const { deps, mensajes } = espia({ abierta: abierta({ createdAt: AHORA }) });

      await askReason(VERSION_ID, CLIENTE, deps);

      expect(mensajes[0]?.text).toContain('hoy');
    });
  });
});

describe('el comentario', () => {
  it('se guarda, SIN reenviar nada al entrenador', async () => {
    // El aviso original ya tiene el botón para empezar la v2: repetirlo por
    // cada mensaje del cliente era una notificación sin límite sobre el
    // mismo botón. Al cliente se le confirma que quedó guardado, no que se
    // "envió" — ya no hay un reenvío en tiempo real que prometer.
    const { deps, pasos, mensajes } = espia();

    const outcome = await addComment('req-1', 'c1', 'No termino la semana 1', CLIENTE, deps);

    expect(outcome).toMatchObject({ kind: 'commented', truncated: false });
    expect(pasos).toContain('addComment');
    expect(mensajes.some((m) => m.chatId === 10)).toBe(false);
    expect(mensajes.find((m) => m.chatId === 500)?.text).toContain('Guardado');
  });

  it('SPEC-030 · si se pasó de 500 caracteres, el acuse lo dice', async () => {
    const repoTruncado: ChangeRequestRepo = {
      findVersion: () => Promise.resolve(version()),
      request: () => Promise.resolve({ id: 'req-1', created: true }),
      openForClient: () => Promise.resolve(null),
      touchAsk: () => Promise.resolve(true),
      addComment: () => Promise.resolve({ saved: true, truncated: true }),
      findRequest: () =>
        Promise.resolve({
          requestId: 'req-1',
          versionId: VERSION_ID,
          planId: 'plan-1',
          versionNumber: 1,
          state: 'OPEN',
          reason: 'other',
          comment: 'x'.repeat(500),
          clientName: 'Carlos Pérez',
          trainerId: 'p-trainer',
          sentDaysAgo: 1,
        }),
      createRevision: () => Promise.resolve('v2'),
      createRevisionIfCurrent: () => Promise.resolve('v2'),
      recordAccepted: () => Promise.resolve(),
    };
    const mensajes: { chatId: number; text: string }[] = [];
    const deps: ChangeRequestDeps = {
      repo: repoTruncado,
      sender: {
        sendMessage: (chatId, text) => {
          mensajes.push({ chatId, text });
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
      now: () => AHORA,
    };

    const outcome = await addComment('req-1', 'c1', 'x'.repeat(50), CLIENTE, deps);

    expect(outcome).toMatchObject({ kind: 'commented', truncated: true });
    expect(mensajes.find((m) => m.chatId === 500)?.text).toContain('límite');
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
    // El plan y el id esperado (la propia v1: nadie creó nada todavía) van
    // bajo el mismo lock que calcula el número de versión.
    expect(pasos).toContain(`createRevisionIfCurrent:plan-1:${VERSION_ID}`);
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

  // -------------------------------------------------------------------------
  // Bug real de testing: cada comentario del cliente reenvía un aviso con su
  // propio botón «Crear otra versión», los tres apuntando a la misma v1.
  // Tocar más de uno no debe crear una v3 por encima de la v2 ya en marcha.

  describe('ya hay una revisión en marcha', () => {
    const V2_ID = '9f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

    it.each(['NEW', 'GENERATING', 'DRAFT', 'APPROVED'] as const)(
      'no crea otra si la vigente está en %s',
      async (estado) => {
        const { deps, pasos, mensajes } = espia({
          version: version({ currentVersionId: V2_ID, currentVersionState: estado, currentVersionNumber: 2 }),
        });

        const outcome = await startRevision(VERSION_ID, ENTRENADOR, deps);

        // El id que vuelve es el de la v2 EN MARCHA, no el de la v1 original
        // sobre la que se tocó el botón viejo — si no, nada apuntaría a cuál
        // es la que de verdad hay que revisar.
        expect(outcome).toEqual({ kind: 'revision_in_progress', versionId: V2_ID });
        expect(pasos.some((p) => p.startsWith('createRevision'))).toBe(false);
        expect(mensajes[0]?.text).toContain('v2');
      },
    );

    it.each(['SENT', 'REJECTED'] as const)(
      'SÍ crea la siguiente si la vigente ya está resuelta (%s)',
      async (estado) => {
        const { deps, pasos } = espia({
          version: version({ currentVersionState: estado, currentVersionNumber: 1 }),
        });

        const outcome = await startRevision(VERSION_ID, ENTRENADOR, deps);

        expect(outcome).toMatchObject({ kind: 'revision_started' });
        expect(pasos).toContain(`createRevisionIfCurrent:plan-1:${VERSION_ID}`);
      },
    );
  });

  // -------------------------------------------------------------------------
  // La comprobación de arriba y el INSERT son dos pasos separados: esto
  // prueba el caso en que otro callback, casi al mismo instante, ya creó su
  // revisión bajo el mismo lock — la ventana que `isTerminal` solo no cierra.

  describe('la carrera: dos callbacks casi simultáneos', () => {
    it('si el INSERT pierde la carrera, no ofrece los tres caminos de nuevo', async () => {
      const { deps, pasos, mensajes } = espia({ perdioCarrera: true });

      const outcome = await startRevision(VERSION_ID, ENTRENADOR, deps);

      // `revision_in_progress`, no `revision_started`: no hay una versión
      // nueva que preparar, la ganó el otro callback.
      expect(outcome).toEqual({ kind: 'revision_in_progress', versionId: VERSION_ID });
      expect(pasos).toContain(`createRevisionIfCurrent:plan-1:${VERSION_ID}`);
      expect(mensajes.at(-1)?.keyboard).toBeUndefined();
      expect(mensajes.at(-1)?.text).toContain('Carlos');
    });
  });
});
