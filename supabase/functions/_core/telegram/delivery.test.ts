/**
 * SPEC-005 — Vincular al cliente y entregarle su rutina.
 *
 * Dos reglas mandan aquí:
 *
 *   La entrega es DIFERIDA. Si el entrenador aprueba antes de que el cliente
 *   abra el enlace, la versión se queda en APPROVED y sale sola cuando se
 *   vincula. Nadie tiene que acordarse de nada.
 *
 *   `APPROVED → SENT` solo DESPUÉS de que Telegram confirme. Al revés, un
 *   fallo de red dejaría una rutina marcada como enviada que nadie recibió.
 */
import { describe, expect, it } from 'vitest';
import type { Workout } from '../domain/workout.ts';
import type {
  ClientForLink,
  DeliveryRepo,
  VersionForDelivery,
} from '../ports/delivery-ports.ts';
import { deliverVersion, linkClient, type DeliveryDeps } from './delivery.ts';

const RUTINA: Workout = {
  summary: 'Fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press', sets: 4, reps: '8', restSeconds: 120, notes: null }],
    },
  ],
  warnings: ['Se evitó press militar por la molestia de hombro'],
};

const CLIENTE: ClientForLink = {
  clientId: 'c1',
  fullName: 'Carlos',
  linkedProfileId: null,
  linkedTelegramUserId: null,
  trainerChatId: 10,
};

/** Quien abre el enlace. En un chat privado `from.id` y `chat.id` coinciden. */
const USUARIO = { telegramUserId: 500, chatId: 500 };
const PERFIL = { profileId: 'perfil-cliente', chatId: 500 };

function version(state: VersionForDelivery['state'] = 'APPROVED'): VersionForDelivery {
  return {
    versionId: 'v1',
    state,
    content: RUTINA,
    clientName: 'Carlos',
    clientChatId: 500,
    trainerChatId: 10,
    plan: { goal: 'Fuerza', daysPerWeek: 3, sessionMinutes: 60 },
  };
}

interface Espia {
  readonly deps: DeliveryDeps;
  readonly pasos: string[];
  readonly mensajes: { chatId: number; text: string }[];
}

function espia(
  opciones: {
    cliente?: ClientForLink | null;
    aprobada?: VersionForDelivery | null;
    version?: VersionForDelivery | null;
    vincularFalla?: boolean;
    transicionFalla?: boolean;
    envioFalla?: boolean;
    perfil?: { profileId: string; chatId: number } | null;
    nombreDelPerfil?: string[];
  } = {},
): Espia {
  const pasos: string[] = [];
  const mensajes: { chatId: number; text: string }[] = [];

  const repo: DeliveryRepo = {
    findClientByToken: () => {
      pasos.push('findClientByToken');
      return Promise.resolve(opciones.cliente === undefined ? CLIENTE : opciones.cliente);
    },
    ensureClientProfile: (_id, _chat, fullName) => {
      pasos.push('ensureClientProfile');
      opciones.nombreDelPerfil?.push(fullName);
      return Promise.resolve(opciones.perfil === undefined ? PERFIL : opciones.perfil);
    },
    linkClient: () => {
      pasos.push('linkClient');
      return Promise.resolve(!(opciones.vincularFalla ?? false));
    },
    findApprovedVersion: () => {
      pasos.push('findApprovedVersion');
      return Promise.resolve(opciones.aprobada ?? null);
    },
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(opciones.version === undefined ? version() : opciones.version);
    },
    transition: (_v, from, to) => {
      pasos.push(`transition:${from}->${to}`);
      return Promise.resolve(!(opciones.transicionFalla ?? false));
    },
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (chatId, text) => {
          pasos.push(`sendMessage:${chatId}`);
          if (opciones.envioFalla === true && chatId === 500) {
            return Promise.reject(new Error('el cliente bloqueó el bot'));
          }
          mensajes.push({ chatId, text });
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

describe('vincular', () => {
  it('guarda el perfil y da la bienvenida', async () => {
    // CA-1.
    const { deps, pasos, mensajes } = espia();

    const outcome = await linkClient('un-token', USUARIO, deps);

    expect(outcome).toEqual({ kind: 'linked', clientId: 'c1', delivered: false });
    expect(pasos).toContain('linkClient');
    expect(mensajes.some((m) => m.chatId === 500)).toBe(true);
  });

  it('sin rutina aprobada, solo saluda', async () => {
    const { deps, pasos } = espia({ aprobada: null });

    await linkClient('un-token', USUARIO, deps);

    expect(pasos.some((p) => p.startsWith('transition'))).toBe(false);
  });

  it('si lo que espera NO está aprobado, no se entrega', async () => {
    // `findApprovedVersion` es del repo: un bug ahí no puede acabar mandándole
    // un borrador sin revisar al cliente. La guarda vuelve a preguntar.
    const { deps, pasos } = espia({ aprobada: version('DRAFT') });

    const outcome = await linkClient('un-token', USUARIO, deps);

    expect(outcome).toEqual({ kind: 'linked', clientId: 'c1', delivered: false });
    expect(pasos.some((p) => p.includes('->SENT'))).toBe(false);
  });

  it('CON rutina aprobada esperando, se la entrega ahí mismo', async () => {
    // CA-4: la entrega diferida. Nadie tiene que acordarse de nada.
    const { deps, pasos } = espia({ aprobada: version() });

    const outcome = await linkClient('un-token', USUARIO, deps);

    expect(outcome).toEqual({ kind: 'linked', clientId: 'c1', delivered: true });
    expect(pasos).toContain('transition:APPROVED->SENT');
  });
});

describe('un token que no sirve', () => {
  it('uno inexistente da respuesta neutra', async () => {
    // CA-5. No se puede enumerar clientes probando tokens.
    const { deps, mensajes } = espia({ cliente: null });

    const outcome = await linkClient('inventado', USUARIO, deps);

    expect(outcome).toEqual({ kind: 'invalid_token' });
    expect(mensajes).toHaveLength(1);
  });

  it('uno ya usado por OTRO da la MISMA respuesta al que lo intenta', async () => {
    // CA-6. Si se distinguieran, un token filtrado diría si es válido.
    const { deps, mensajes } = espia({
      cliente: { ...CLIENTE, linkedProfileId: 'otro-perfil', linkedTelegramUserId: 999 },
    });

    const outcome = await linkClient('un-token', USUARIO, deps);

    expect(outcome.kind).toBe('already_linked_elsewhere');
    expect(mensajes.some((m) => m.chatId === 500)).toBe(true);
  });

  it('...pero el entrenador SÍ se entera de ese caso', async () => {
    // Al cliente se le responde neutro; al entrenador se le cuenta, porque
    // puede ser un enlace reenviado por error o algo peor.
    const { deps, mensajes } = espia({
      cliente: { ...CLIENTE, linkedProfileId: 'otro-perfil', linkedTelegramUserId: 999 },
    });

    await linkClient('un-token', USUARIO, deps);

    expect(mensajes.some((m) => m.chatId === 10)).toBe(true);
  });

  it('volver a abrir el enlace propio no rompe nada', async () => {
    const { deps } = espia({
      cliente: { ...CLIENTE, linkedProfileId: 'perfil-cliente', linkedTelegramUserId: 500 },
    });

    const outcome = await linkClient('un-token', USUARIO, deps);

    expect(outcome.kind).not.toBe('already_linked_elsewhere');
  });
});

describe('solo en privado', () => {
  it('un /start en un GRUPO no vincula nada', async () => {
    // CA-12, regla 12. En privado `chat.id` y `from.id` coinciden; en un
    // grupo no. Sin esta guarda la rutina se publicaría ahí.
    const { deps, pasos } = espia();

    const outcome = await linkClient('un-token', { telegramUserId: 500, chatId: -100 }, deps);

    expect(outcome).toEqual({ kind: 'not_private' });
    expect(pasos, 'ni siquiera se consulta el token').toEqual([]);
  });

  it('y no se responde en el grupo', async () => {
    // Responder ahí confirmaría que el token existe.
    const { deps, mensajes } = espia();

    await linkClient('un-token', { telegramUserId: 500, chatId: -100 }, deps);

    expect(mensajes).toEqual([]);
  });
});

describe('el perfil nace aquí', () => {
  it('el nombre sale de la FICHA, no del Telegram de quien escribe', async () => {
    // SPEC-009 regla 1b. El `first_name` lo elige quien escribe: con él, un
    // cliente podría aparecer ante el entrenador con el nombre de otro.
    const nombreDelPerfil: string[] = [];
    const { deps } = espia({ nombreDelPerfil });

    await linkClient('un-token', USUARIO, deps);

    expect(nombreDelPerfil).toEqual(['Carlos']);
  });

  it('un token ajeno NO llega a crear perfil', async () => {
    // Por eso la comprobación de «ya vinculado» va antes de resolver el
    // perfil: un intento fallido no puede dejar rastro en `profiles`.
    const { deps, pasos } = espia({
      cliente: { ...CLIENTE, linkedProfileId: 'otro-perfil', linkedTelegramUserId: 999 },
    });

    await linkClient('un-token', USUARIO, deps);

    expect(pasos).not.toContain('ensureClientProfile');
    expect(pasos).not.toContain('linkClient');
  });

  it('un token inexistente tampoco', async () => {
    const { deps, pasos } = espia({ cliente: null });

    await linkClient('inventado', USUARIO, deps);

    expect(pasos).toEqual(['findClientByToken', 'sendMessage:500']);
  });

  it('un ENTRENADOR no se convierte en cliente por pulsar un enlace', async () => {
    // CA-10. Un `telegram_user_id` tiene un perfil y un rol; el enlace no lo
    // cambia. Y la respuesta es la misma neutra: no se confirma nada.
    const { deps, pasos, mensajes } = espia({ perfil: null });

    const outcome = await linkClient('un-token', USUARIO, deps);

    expect(outcome).toEqual({ kind: 'not_a_client' });
    expect(pasos).not.toContain('linkClient');
    expect(mensajes[0]?.text).toContain('no sirve');
  });
});

describe('si el enlace no se guarda', () => {
  it('NO se da la bienvenida', async () => {
    // CA-11, regla 11. El `UNIQUE` de `clients.profile_id` rechaza a quien ya
    // está vinculado a otra ficha. Decirle «ya estás conectado» lo dejaría
    // esperando una rutina que no va a llegar.
    const { deps, mensajes } = espia({ vincularFalla: true });

    const outcome = await linkClient('un-token', USUARIO, deps);

    expect(outcome).toEqual({ kind: 'link_failed' });
    expect(mensajes.some((m) => m.text.includes('ya estás conectado'))).toBe(false);
  });

  it('y no se entrega ninguna rutina', async () => {
    const { deps, pasos } = espia({ vincularFalla: true, aprobada: version() });

    await linkClient('un-token', USUARIO, deps);

    expect(pasos).not.toContain('findApprovedVersion');
    expect(pasos.some((p) => p.includes('->SENT'))).toBe(false);
  });
});

describe('entregar', () => {
  it('manda la rutina y pasa a SENT', async () => {
    // CA-2.
    const { deps, pasos } = espia();

    const outcome = await deliverVersion('v1', deps);

    expect(outcome).toEqual({ kind: 'delivered', versionId: 'v1' });
    expect(pasos).toContain('transition:APPROVED->SENT');
  });

  it('SENT se aplica DESPUÉS de mandar, no antes', async () => {
    // Regla 4. Al revés, un fallo de red dejaría una rutina marcada como
    // enviada que nadie recibió.
    const { deps, pasos } = espia();

    await deliverVersion('v1', deps);

    expect(pasos.indexOf('sendMessage:500')).toBeLessThan(
      pasos.indexOf('transition:APPROVED->SENT'),
    );
  });

  it('si el envío falla, la versión SIGUE en APPROVED', async () => {
    // El cliente bloqueó el bot, por ejemplo. La rutina no se pierde: sigue
    // esperando y el entrenador se entera.
    const { deps, pasos, mensajes } = espia({ envioFalla: true });

    const outcome = await deliverVersion('v1', deps);

    expect(outcome.kind).toBe('undelivered');
    expect(pasos.some((p) => p.includes('->SENT'))).toBe(false);
    expect(mensajes.some((m) => m.chatId === 10)).toBe(true);
  });

  it('el entrenador se entera de que llegó', async () => {
    // Regla 6.
    const { deps, mensajes } = espia();

    await deliverVersion('v1', deps);

    expect(mensajes.some((m) => m.chatId === 10 && m.text.includes('Carlos'))).toBe(true);
  });

  it('el mensaje al cliente NO lleva sus limitaciones', async () => {
    // CA-7, de extremo a extremo.
    const { deps, mensajes } = espia();

    await deliverVersion('v1', deps);

    const alCliente = mensajes.find((m) => m.chatId === 500)!;
    expect(alCliente.text).not.toContain('hombro');
  });

  it.each(['NEW', 'GENERATING', 'DRAFT', 'SENT', 'REJECTED'] as const)(
    'desde %s no se entrega',
    async (state) => {
      // CA-8. `SENT → SENT` no existe: no se duplica una entrega.
      const { deps, pasos } = espia({ version: version(state) });

      const outcome = await deliverVersion('v1', deps);

      expect(outcome).toEqual({ kind: 'not_deliverable', state });
      expect(pasos.some((p) => p.startsWith('sendMessage'))).toBe(false);
    },
  );

  it('si el cliente NO abrió su enlace, la rutina espera', async () => {
    // CA-3. No hay dónde escribirle: la versión sigue en APPROVED y el
    // entrenador se entera de por qué.
    const { deps, pasos, mensajes } = espia({ version: { ...version(), clientChatId: null } });

    const outcome = await deliverVersion('v1', deps);

    expect(outcome).toEqual({ kind: 'undelivered' });
    expect(pasos.some((p) => p.includes('->SENT'))).toBe(false);
    expect(mensajes.some((m) => m.chatId === 10 && m.text.includes('enlace'))).toBe(true);
  });

  it('una rutina sin evaluación se entrega igual, sin la línea de objetivo', async () => {
    // CA-13, regla 13. Una manual o de plantilla no tiene formulario detrás.
    const { deps, mensajes } = espia({ version: { ...version(), plan: null } });

    const outcome = await deliverVersion('v1', deps);

    expect(outcome.kind).toBe('delivered');
    const alCliente = mensajes.find((m) => m.chatId === 500)!;
    expect(alCliente.text).toContain('tu rutina está lista');
    expect(alCliente.text).not.toContain('🎯');
  });

  it('una versión que no existe no revienta', async () => {
    const { deps } = espia({ version: null });
    expect((await deliverVersion('v1', deps)).kind).toBe('not_found');
  });

  it('si otro se adelantó a marcarla SENT, no se manda dos veces', async () => {
    const { deps } = espia({ transicionFalla: true });

    const outcome = await deliverVersion('v1', deps);

    expect(outcome.kind).toBe('already_sent');
  });
});
