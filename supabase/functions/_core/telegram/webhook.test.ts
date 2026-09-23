/**
 * SPEC-003 / SPEC-009 — el flujo del webhook.
 *
 * ┌─ LO QUE ESTE TEST PROTEGE ─────────────────────────────────────────────┐
 * │ El ORDEN de los pasos. Si alguien mueve la verificación del secreto    │
 * │ después de tocar la base de datos, el test de abajo falla — aunque el  │
 * │ 401 se siga devolviendo igual.                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import type { CheckinRepo } from '../ports/checkin-ports.ts';
import type { ChangeRequestRepo } from '../ports/change-request-ports.ts';
import type { CreationRepo } from '../ports/creation-ports.ts';
import type { IntakeRepo } from '../ports/intake-ports.ts';
import type { QueryRepo } from '../ports/query-ports.ts';
import type { DeliveryRepo } from '../ports/delivery-ports.ts';
import type { TelegramRepo, TelegramSender } from '../ports/telegram-ports.ts';
import type { ActionDeps } from './actions.ts';
import type { ReplyDeps } from '../checkin/reply.ts';
import type { CommandDeps } from '../commands/router.ts';
import type { ChangeRequestDeps } from '../change-request/flows.ts';
import type { CreationDeps } from '../creation/flows.ts';
import type { EditorDeps } from '../creation/editor-session.ts';
import type { DeliveryDeps } from './delivery.ts';
import { handleTelegramWebhook, outcomeToStatus } from './webhook.ts';

const SECRET = 'un-secreto-de-webhook-largo-y-aleatorio';

const ENTRENADOR: Identity = {
  profileId: 'p-trainer',
  role: 'trainer',
  telegramUserId: 500,
  telegramChatId: 500,
};

/** Repositorio falso que además registra qué se le pidió y en qué orden. */
function fakeRepo(overrides: Partial<TelegramRepo> = {}) {
  const calls: string[] = [];

  const repo: TelegramRepo = {
    claimEvent: async (...args) => {
      calls.push('claimEvent');
      return overrides.claimEvent ? await overrides.claimEvent(...args) : true;
    },
    markProcessed: async (...args) => {
      calls.push('markProcessed');
      if (overrides.markProcessed) await overrides.markProcessed(...args);
    },
    findIdentity: async (...args) => {
      calls.push('findIdentity');
      return overrides.findIdentity ? await overrides.findIdentity(...args) : ENTRENADOR;
    },
  };

  return { repo, calls };
}

function fakeSender() {
  const sent: Array<{ chatId: number; text: string }> = [];
  const answered: string[] = [];
  const calls: string[] = [];

  const sender: TelegramSender = {
    sendMessage: async (chatId, text) => {
      calls.push('sendMessage');
      sent.push({ chatId, text });
    },
    answerCallback: async (id) => {
      calls.push('answerCallback');
      answered.push(id);
    },
  };

  return { sender, sent, answered, calls };
}

const FROM = { id: 500, first_name: 'Ana' };

/**
 * Unas acciones que no encuentran nada, para los tests que no las miran.
 *
 * `actions` es obligatorio desde que se descubrió que el handler no lo pasaba
 * y los botones llevaban dos PRs sin funcionar sin que fallara ningún test.
 */
function vacioActions(): ActionDeps {
  return {
    repo: { findVersion: () => Promise.resolve(null), transition: () => Promise.resolve(false) },
    sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
    generation: { trigger: () => Promise.resolve() },
    requestId: 'req-1',
  };
}

/** Consultas falsas que registran qué se pidió. Por defecto, sin clientes. */
function fakeCommands(opciones: { clientes?: { clientId: string; fullName: string }[] } = {}) {
  const pasos: string[] = [];

  const repo: QueryRepo = {
    clientRoutine: () => {
      pasos.push('clientRoutine');
      return Promise.resolve(null);
    },
    clients: () => {
      pasos.push('clients');
      return Promise.resolve(
        (opciones.clientes ?? []).map((c) => ({
          ...c,
          versionState: null,
          versionNumber: null,
          linked: true,
          pendingCheckinDays: null,
        })),
      );
    },
    clientDetail: () => {
      pasos.push('clientDetail');
      return Promise.resolve(null);
    },
    pendingVersions: () => {
      pasos.push('pendingVersions');
      return Promise.resolve([]);
    },
    staleCheckins: () => {
      pasos.push('staleCheckins');
      return Promise.resolve([]);
    },
  };

  const deps: CommandDeps = {
    repo,
    sender: {
      sendMessage: (chatId) => {
        pasos.push(`sendMessage:${chatId}`);
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, pasos };
}

/**
 * Solicitudes de cambio. Por defecto la versión es del cliente `p-cliente` y
 * está en SENT, que es lo único sobre lo que se puede pedir un cambio.
 */
function fakeChanges(
  opciones: { abierta?: { hasComment: boolean; askedAt: Date } | null; version?: unknown } = {},
) {
  const pasos: string[] = [];

  const repo: ChangeRequestRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(
        opciones.version === undefined
          ? {
              versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
              state: 'SENT' as const,
              planId: 'plan-1',
              clientName: 'Carlos',
              versionNumber: 1,
              trainerChatId: 10,
              client: { clientId: 'c1', trainerId: 'p-trainer', profileId: 'p-cliente' },
            }
          : (opciones.version as null),
      );
    },
    request: () => {
      pasos.push('request');
      return Promise.resolve('req-1');
    },
    openForClient: () => {
      pasos.push('openForClient');
      return Promise.resolve(
        opciones.abierta === undefined || opciones.abierta === null
          ? null
          : { requestId: 'req-1', clientId: 'c1', ...opciones.abierta },
      );
    },
    addComment: () => {
      pasos.push('addComment');
      return Promise.resolve(true);
    },
    findRequest: () =>
      Promise.resolve({
        requestId: 'req-1',
        versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
        planId: 'plan-1',
        versionNumber: 1,
        state: 'OPEN' as const,
        reason: 'too_hard' as const,
        comment: 'me cuesta',
        clientName: 'Carlos',
        trainerId: 'p-trainer',
        sentDaysAgo: 9,
      }),
    createRevision: () => {
      pasos.push('createRevision');
      return Promise.resolve('9f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b');
    },
    recordAccepted: () => {
      pasos.push('recordAccepted');
      return Promise.resolve();
    },
  };

  const deps: ChangeRequestDeps = {
    repo,
    sender: {
      sendMessage: (chatId) => {
        pasos.push(`sendMessage:${chatId}`);
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, pasos };
}

const RUTINA_MINIMA = {
  summary: 'Fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press', sets: 4, reps: '8', restSeconds: 90, notes: null }],
    },
  ],
  warnings: [],
};

/** Plantillas, manual y editor. Por defecto hay un borrador abierto. */
function fakeCreation(opciones: { borrador?: boolean; version?: unknown } = {}) {
  const pasos: string[] = [];

  const repo: CreationRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(
        opciones.version === undefined
          ? {
              versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
              state: 'NEW' as const,
              client: { clientId: 'c1', trainerId: 'p-trainer', profileId: 'p-cliente' },
              clientName: 'Carlos',
              versionNumber: 1,
              daysPerWeek: 3,
              level: 'beginner' as const,
              equipment: 'Gimnasio',
              hasLimitations: false,
            }
          : (opciones.version as null),
      );
    },
    fillVersion: (_v, _e, source) => {
      pasos.push(`fillVersion:${source}`);
      return Promise.resolve(true);
    },
    currentDraft: () => {
      pasos.push('currentDraft');
      return Promise.resolve(
        opciones.borrador === false
          ? null
          : {
              versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
              versionNumber: 1,
              clientName: 'Carlos',
              content: RUTINA_MINIMA,
            },
      );
    },
    saveDraft: () => {
      pasos.push('saveDraft');
      return Promise.resolve(true);
    },
  };

  const deps: CreationDeps & EditorDeps = {
    repo,
    sender: {
      sendMessage: (chatId) => {
        pasos.push(`sendMessage:${chatId}`);
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, pasos };
}

const CHECKIN_ID = '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/**
 * Un check-in falso. Por defecto es de OTRO cliente: así, si el enrutado
 * dejara de comprobar la pertenencia, los tests lo notarían.
 */
function fakeCheckins(opciones: { dueño?: string | null; abierto?: boolean } = {}) {
  const pasos: string[] = [];

  const registro = {
    checkinId: CHECKIN_ID,
    clientProfileId: opciones.dueño === undefined ? 'otro-perfil' : opciones.dueño,
    clientName: 'Carlos',
    weekNumber: 2,
    state: 'PENDING' as const,
    answers: { sessions: null, feeling: null, discomfort: null },
    sentAt: new Date('2026-03-16T09:00:00Z'),
    trainerChatId: 10,
    daysPerWeek: 4,
  };

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
      return Promise.resolve(opciones.abierto === true ? registro : null);
    },
    saveAnswers: (_id, _answers, completed) => {
      pasos.push(`saveAnswers:${completed}`);
      return Promise.resolve();
    },
  };

  const deps: ReplyDeps = {
    repo,
    sender: {
      sendMessage: (chatId) => {
        pasos.push(`sendMessage:${chatId}`);
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, pasos };
}

/** Un token con la forma que `parseStartToken` acepta. */
const TOKEN = 'k'.repeat(32);

/**
 * Una entrega falsa que registra qué se le pidió.
 *
 * `cliente: null` significa token desconocido; por defecto el token vale y el
 * cliente aún no tiene perfil, que es el caso que importa.
 */
function fakeDelivery(opciones: { cliente?: unknown; entregable?: boolean } = {}) {
  const pasos: string[] = [];

  const repo: DeliveryRepo = {
    findClientByToken: () => {
      pasos.push('findClientByToken');
      return Promise.resolve(
        opciones.cliente === undefined
          ? {
              clientId: 'c1',
              fullName: 'Carlos',
              linkedProfileId: null,
              linkedTelegramUserId: null,
              trainerChatId: 10,
            }
          : (opciones.cliente as null),
      );
    },
    ensureClientProfile: () => {
      pasos.push('ensureClientProfile');
      return Promise.resolve({ profileId: 'perfil-nuevo', chatId: 500 });
    },
    linkClient: () => {
      pasos.push('linkClient');
      return Promise.resolve(true);
    },
    findApprovedVersion: () => Promise.resolve(null),
    findVersion: () => {
      pasos.push('findVersion');
      if (opciones.entregable !== true) return Promise.resolve(null);

      return Promise.resolve({
        versionId: 'v1',
        state: 'APPROVED' as const,
        content: { summary: 'Fuerza', days: [], warnings: [] },
        clientName: 'Carlos',
        clientChatId: 500,
        trainerChatId: 10,
        plan: null,
      });
    },
    transition: (_v, from, to) => {
      pasos.push(`transition:${from}->${to}`);
      return Promise.resolve(true);
    },
    resolveRequests: () => Promise.resolve(0),
  };

  const deps: DeliveryDeps = {
    repo,
    sender: {
      sendMessage: (chatId) => {
        pasos.push(`sendMessage:${chatId}`);
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, pasos };
}

function comando(text: string, updateId = 1) {
  return {
    update_id: updateId,
    message: { message_id: 9, from: FROM, chat: { id: 500 }, text },
  };
}

/** SPEC-015: una ficha que no encuentra nada, para los tests que no la miran. */
function fakeIntake(intake: unknown = undefined) {
  const pasos: string[] = [];
  return {
    pasos,
    deps: {
      repo: {
        findIntake: () => {
          pasos.push('findIntake');
          return Promise.resolve(
            intake === undefined
              ? null
              : (intake as Awaited<ReturnType<IntakeRepo['findIntake']>>),
          );
        },
      },
      sender: {
        sendMessage: (_c: number, text: string) => {
          pasos.push(`sendMessage:${text.slice(0, 20)}`);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    },
  };
}

function ejecutar(
  body: unknown,
  opts: {
    secretHeader?: string | null;
    repo?: ReturnType<typeof fakeRepo>;
    sender?: ReturnType<typeof fakeSender>;
    actions?: ActionDeps;
    delivery?: DeliveryDeps;
    checkins?: ReturnType<typeof fakeCheckins>;
    commands?: ReturnType<typeof fakeCommands>;
    creation?: ReturnType<typeof fakeCreation>;
    changes?: ReturnType<typeof fakeChanges>;
  } = {},
) {
  const repo = opts.repo ?? fakeRepo();
  const sender = opts.sender ?? fakeSender();

  return {
    repo,
    sender,
    result: handleTelegramWebhook(
      { secretHeader: opts.secretHeader === undefined ? SECRET : opts.secretHeader, body },
      {
        repo: repo.repo,
        sender: sender.sender,
        expectedSecret: SECRET,
        requestId: 'req-1',
        delivery: opts.delivery ?? fakeDelivery().deps,
        checkins: (opts.checkins ?? fakeCheckins()).deps,
        commands: (opts.commands ?? fakeCommands()).deps,
        creation: (opts.creation ?? fakeCreation()).deps,
        changes: (opts.changes ?? fakeChanges()).deps,
        actions: opts.actions ?? vacioActions(),
        intake: fakeIntake().deps,
      },
    ),
  };
}

// ---------------------------------------------------------------------------

describe('🔴 el secreto se verifica ANTES que nada', () => {
  it.each([
    ['un secreto equivocado', 'otro-secreto-cualquiera-bastante-largo'],
    ['la cabecera ausente', null],
    ['una cabecera vacía', ''],
  ])('rechaza %s', async (_nombre, secretHeader) => {
    const { repo, sender, result } = ejecutar(comando('/clientes'), { secretHeader });

    expect((await result).kind).toBe('unauthorized');
    // Lo que de verdad importa: NADA se tocó.
    expect(repo.calls, 'un secreto inválido no puede tocar la base de datos').toEqual([]);
    expect(sender.calls, 'ni responder nada').toEqual([]);
  });

  it('un secreto inválido devuelve 401; todo lo demás, 200', async () => {
    expect(outcomeToStatus({ kind: 'unauthorized' })).toBe(401);

    for (const outcome of [
      { kind: 'malformed' },
      { kind: 'ignored', reason: 'x' },
      { kind: 'duplicate', updateId: 1 },
      { kind: 'unknown_user', telegramUserId: 1 },
      { kind: 'linked', updateId: 1, outcome: { kind: 'invalid_token' } },
      { kind: 'handled', updateId: 1, profileId: 'p', role: 'trainer', updateKind: 'command' },
    ] as const) {
      // 200 a propósito: un 500 haría que Telegram reintentara en bucle.
      expect(outcomeToStatus(outcome), outcome.kind).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------

describe('cuerpo inválido', () => {
  it('un cuerpo que no se pudo parsear se descarta sin tocar nada', async () => {
    const { repo, result } = ejecutar(null);

    expect((await result).kind).toBe('malformed');
    expect(repo.calls).toEqual([]);
  });
});

describe('updates no accionables', () => {
  it('se ignoran sin escribir', async () => {
    const { repo, result } = ejecutar({ update_id: 1, poll: { id: 'p' } });
    const outcome = await result;

    expect(outcome.kind).toBe('ignored');
    expect(repo.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('idempotencia', () => {
  it('un evento ya procesado no llega a resolver identidad', async () => {
    const repo = fakeRepo({ claimEvent: async () => false });
    const { result } = ejecutar(comando('/clientes'), { repo });

    expect((await result).kind).toBe('duplicate');
    expect(repo.calls).toEqual(['claimEvent']);
  });

  it('el orden es: reclamar, después identificar, después marcar', async () => {
    const { repo, result } = ejecutar(comando('/clientes'));

    expect((await result).kind).toBe('handled');
    expect(repo.calls).toEqual(['claimEvent', 'findIdentity', 'markProcessed']);
  });
});

// ---------------------------------------------------------------------------

describe('identidad', () => {
  it('un desconocido recibe un mensaje neutro y queda registrado', async () => {
    const repo = fakeRepo({ findIdentity: async () => null });
    const { sender, result } = ejecutar(comando('/clientes'), { repo });
    const outcome = await result;

    expect(outcome.kind).toBe('unknown_user');
    expect(sender.sent).toHaveLength(1);
    // El mensaje no revela si el usuario existe ni por qué se rechazó.
    expect(sender.sent[0]?.text).not.toMatch(/perfil|base de datos|registrad[oa] en/i);
    // El evento se marca procesado igual: no se reintenta en bucle.
    expect(repo.calls).toContain('markProcessed');
  });

  it('un usuario conocido se atiende', async () => {
    const { result } = ejecutar(comando('/clientes'));
    const outcome = await result;

    expect(outcome).toMatchObject({
      kind: 'handled',
      profileId: ENTRENADOR.profileId,
      role: 'trainer',
      updateKind: 'command',
    });
  });
});

// ---------------------------------------------------------------------------

describe('🔴 el deep link: /start <token>', () => {
  it('un cliente SIN PERFIL con token válido se vincula', async () => {
    // ESTE es el bug que cerró SPEC-005. Antes, el canje caía en la
    // resolución de identidad, no encontraba perfil, y el cliente recibía
    // «no te tengo registrado». El deep link no funcionaba nunca.
    const repo = fakeRepo({ findIdentity: async () => null });
    const delivery = fakeDelivery();
    const { sender, result } = ejecutar(comando(`/start ${TOKEN}`), { repo, delivery: delivery.deps });

    const outcome = await result;

    expect(outcome.kind).toBe('linked');
    expect(delivery.pasos).toContain('ensureClientProfile');
    expect(delivery.pasos).toContain('linkClient');
    expect(sender.sent, 'no puede recibir el mensaje de desconocido').toEqual([]);
  });

  it('el canje ocurre ANTES de resolver identidad', async () => {
    // Es el orden lo que arregla el bug: pedir identidad primero volvería a
    // rechazar a todo cliente nuevo.
    const repo = fakeRepo();
    const { result } = ejecutar(comando(`/start ${TOKEN}`), { repo });

    await result;
    expect(repo.calls).toEqual(['claimEvent', 'markProcessed']);
    expect(repo.calls).not.toContain('findIdentity');
  });

  it('un token que no existe da respuesta neutra, no un perfil', async () => {
    // CA-5. Y sobre todo: `ensureClientProfile` no se llega a llamar.
    const delivery = fakeDelivery({ cliente: null });
    const { result } = ejecutar(comando(`/start ${TOKEN}`), { delivery: delivery.deps });

    const outcome = await result;

    expect(outcome).toMatchObject({ kind: 'linked', outcome: { kind: 'invalid_token' } });
    expect(delivery.pasos).not.toContain('ensureClientProfile');
  });

  it('el resultado NO lleva el token: se loguea entero', async () => {
    // `link_token` es una credencial (SPEC-005 §7). El handler loguea el
    // outcome completo, así que el token no puede viajar dentro.
    const { result } = ejecutar(comando(`/start ${TOKEN}`));

    expect(JSON.stringify(await result)).not.toContain(TOKEN);
  });

  it('un /start a secas sigue el camino normal', async () => {
    // Abrir el bot sin enlace es legítimo, y no es un canje: sin perfil,
    // respuesta neutra.
    const repo = fakeRepo({ findIdentity: async () => null });
    const delivery = fakeDelivery();
    const { result } = ejecutar(comando('/start'), { repo, delivery: delivery.deps });

    expect((await result).kind).toBe('unknown_user');
    expect(delivery.pasos).toEqual([]);
  });

  it('un token con forma imposible no llega a consultar la base', async () => {
    const delivery = fakeDelivery();
    const { result } = ejecutar(comando('/start corto'), { delivery: delivery.deps });

    await result;
    expect(delivery.pasos).toEqual([]);
  });

  it('el mismo /start dos veces vincula UNA sola vez', async () => {
    // La idempotencia es la misma que para todo lo demás: el `claimEvent` va
    // antes del canje.
    const repo = fakeRepo({ claimEvent: async () => false });
    const delivery = fakeDelivery();
    const { result } = ejecutar(comando(`/start ${TOKEN}`), { repo, delivery: delivery.deps });

    expect((await result).kind).toBe('duplicate');
    expect(delivery.pasos).toEqual([]);
  });

  it('sin el secreto correcto no se canjea nada', async () => {
    const delivery = fakeDelivery();
    const { result } = ejecutar(comando(`/start ${TOKEN}`), {
      secretHeader: 'otro-secreto-cualquiera-largo',
      delivery: delivery.deps,
    });

    expect((await result).kind).toBe('unauthorized');
    expect(delivery.pasos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('callback_query', () => {
  const callback = {
    update_id: 7,
    callback_query: {
      id: 'cbq-1',
      from: FROM,
      data: 'act:approve:4c9a1f2e-8b3d-4e5f-9a7c-1d2e3f4a5b6c',
      message: { message_id: 42, chat: { id: 500 } },
    },
  };

  it('responde al botón ANTES de trabajar', async () => {
    // Si se hace al revés, Telegram deja el botón girando varios segundos.
    const sender = fakeSender();
    const repo = fakeRepo();
    const { result } = ejecutar(callback, { repo, sender });

    await result;
    expect(sender.answered).toEqual(['cbq-1']);
    expect(sender.calls[0]).toBe('answerCallback');
  });

  it('no responde al botón si el secreto era inválido', async () => {
    const sender = fakeSender();
    const { result } = ejecutar(callback, { secretHeader: 'malo-pero-largo-igual', sender });

    expect((await result).kind).toBe('unauthorized');
    expect(sender.answered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('resiliencia', () => {
  it('un fallo del repositorio no revienta el webhook', async () => {
    const repo = fakeRepo({
      claimEvent: async () => {
        throw new Error('la base no responde');
      },
    });

    const { result } = ejecutar(comando('/clientes'), { repo });
    const outcome = await result;

    // Se informa del error, pero el estado devuelto sigue siendo 200: un 500
    // haría que Telegram reintentara el mismo update sin parar.
    expect(outcome.kind).toBe('failed');
    expect(outcomeToStatus(outcome)).toBe(200);
  });

  it('sobrevive a que se lance algo que no es un Error', async () => {
    // Una librería puede lanzar un string o un objeto suelto.
    const repo = fakeRepo({
      claimEvent: async () => {
        throw 'la base dijo que no';
      },
    });

    const { result } = ejecutar(comando('/clientes'), { repo });
    const outcome = await result;

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.message.length).toBeGreaterThan(0);
  });

  it('un fallo al enviar el mensaje neutro tampoco lo revienta', async () => {
    const repo = fakeRepo({ findIdentity: async () => null });
    const sender = fakeSender();
    sender.sender.sendMessage = async () => {
      throw new Error('Telegram caído');
    };

    const { result } = ejecutar(comando('/clientes'), { repo, sender });
    expect((await result).kind).toBe('failed');
  });
});

// ---------------------------------------------------------------------------

describe('los botones se enrutan', () => {
  const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

  /** Un update de botón, con el `callback_data` que se le indique. */
  const conBoton = (data: string) => ({
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: FROM,
      message: { message_id: 9, chat: { id: 500 } },
      data,
    },
  });

  function enrutador() {
    const pasos: string[] = [];

    const actions: ActionDeps = {
      repo: {
        findVersion: () => {
          pasos.push('findVersion');
          return Promise.resolve({
            versionId: VERSION,
            state: 'DRAFT' as const,
            client: { clientId: 'c1', trainerId: ENTRENADOR.profileId, profileId: null },
            clientName: 'Carlos',
            versionNumber: 1,
            // Una rutina que SÍ se puede aprobar: estos tests miden el
            // enrutado, no la validación.
            content: {
              summary: 'Fuerza',
              days: [
                {
                  dayNumber: 1,
                  focus: 'Empuje',
                  exercises: [
                    { name: 'Press', sets: 4, reps: '8', restSeconds: 90, notes: null },
                  ],
                },
              ],
              warnings: [],
            },
            constraints: { daysPerWeek: 1, hasLimitations: false },
          });
        },
        transition: (_v, from, to) => {
          pasos.push(`transition:${from}->${to}`);
          return Promise.resolve(true);
        },
      },
      sender: {
        sendMessage: () => Promise.resolve(),
        answerCallback: (id) => {
          pasos.push(`answerCallback:${id}`);
          return Promise.resolve();
        },
      },
      generation: {
        trigger: (versionId) => {
          pasos.push(`trigger:${versionId}`);
          return Promise.resolve();
        },
      },
      requestId: 'req-1',
    };

    return { pasos, actions };
  }

  it('aprobar ENTREGA la rutina en el momento', async () => {
    // CA-14, regla 14. `handleAction` solo deja la versión en APPROVED; sin
    // este enlace el entrenador pulsa Aprobar y al cliente no le llega nada.
    const { actions } = enrutador();
    const delivery = fakeDelivery({ entregable: true });

    const { result } = ejecutar(conBoton(`act:approve:${VERSION}`), {
      actions,
      delivery: delivery.deps,
    });

    const outcome = await result;

    expect(outcome).toMatchObject({ delivery: { kind: 'delivered', versionId: 'v1' } });
    expect(delivery.pasos).toContain('sendMessage:500');
    expect(delivery.pasos).toContain('transition:APPROVED->SENT');
  });

  it('rechazar no entrega nada', async () => {
    const { actions } = enrutador();
    const delivery = fakeDelivery({ entregable: true });

    const { result } = ejecutar(conBoton(`act:reject:${VERSION}`), {
      actions,
      delivery: delivery.deps,
    });

    await result;
    expect(delivery.pasos).toEqual([]);
  });

  it('un botón válido llega a su acción', async () => {
    const { pasos, actions } = enrutador();

    const { result } = ejecutar(conBoton(`act:approve:${VERSION}`), { actions });

    expect((await result).kind).toBe('handled');
    expect(pasos).toContain('transition:DRAFT->APPROVED');
  });

  it('un `callback_data` ilegible se responde y se ignora', async () => {
    // No vino de un botón nuestro. Responderlo evita que quede girando; no
    // enrutarlo evita darle sentido a algo fabricado.
    const { pasos, actions } = enrutador();

    const { result } = ejecutar(conBoton('basura'), { actions });

    expect((await result).kind).toBe('handled');
    expect(pasos).toEqual([]);
  });

});

// ---------------------------------------------------------------------------

describe('el check-in se enruta', () => {
  const CLIENTE: Identity = {
    profileId: 'p-cliente',
    role: 'client',
    telegramUserId: 500,
    telegramChatId: 500,
  };

  const conBotonChk = (data: string) => ({
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: FROM,
      message: { message_id: 9, chat: { id: 500 } },
      data,
    },
  });

  it('una respuesta del cliente llega a su check-in', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente' });

    const { result } = ejecutar(conBotonChk(`chk:feeling:good:${CHECKIN_ID}`), { repo, checkins });

    expect((await result).kind).toBe('handled');
    expect(checkins.pasos).toContain('findCheckin');
    expect(checkins.pasos).toContain('saveAnswers:false');
  });

  it('CA-7 · el check-in de OTRO se rechaza', async () => {
    // El `checkinId` viaja en el `callback_data`: cualquiera puede fabricarlo.
    // Lo que lo detiene es la pertenencia, no el parseo.
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'otro-perfil' });

    const { result } = ejecutar(conBotonChk(`chk:feeling:good:${CHECKIN_ID}`), { repo, checkins });

    expect(await result).toMatchObject({ checkin: { kind: 'rejected' } });
    expect(checkins.pasos).not.toContain('saveAnswers:false');
  });

  it('un `chk:` NO se confunde con un `act:`', async () => {
    // Los dos prefijos viajan por el mismo canal, y un check-in que acabara
    // en `handleAction` buscaría una versión con el id de un check-in.
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente' });
    const tocadas: string[] = [];

    const actions: ActionDeps = {
      repo: {
        findVersion: () => {
          tocadas.push('findVersion');
          return Promise.resolve(null);
        },
        transition: () => Promise.resolve(false),
      },
      sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
      generation: { trigger: () => Promise.resolve() },
      requestId: 'req-1',
    };

    const { result } = ejecutar(conBotonChk(`chk:sessions:3:${CHECKIN_ID}`), {
      repo,
      checkins,
      actions,
    });

    await result;
    expect(checkins.pasos).toContain('findCheckin');
    expect(tocadas, 'no puede pasar por las acciones del entrenador').toEqual([]);
  });

  it('un texto suelto del cliente puede ser la molestia', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: true });

    const { result } = ejecutar(comando('me molesta el hombro'), { repo, checkins });

    expect((await result).kind).toBe('handled');
    expect(checkins.pasos).toContain('findOpenCheckin');
    expect(checkins.pasos).toContain('saveAnswers:false');
  });

  it('...pero solo si hay uno esperándola', async () => {
    // Sin check-in abierto, un mensaje es un mensaje. No se reinterpreta.
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: false });

    const { result } = ejecutar(comando('hola'), { repo, checkins });

    expect(await result).toMatchObject({ checkin: { kind: 'no_open_checkin' } });
    expect(checkins.pasos).not.toContain('saveAnswers:false');
  });

  it('un texto del ENTRENADOR no se lee como check-in', async () => {
    // El entrenador no tiene check-ins: su texto es otra cosa.
    const checkins = fakeCheckins({ abierto: true });

    const { result } = ejecutar(comando('una nota cualquiera'), { checkins });

    await result;
    expect(checkins.pasos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('el camino sin IA se enruta', () => {
  const VERSION_TPL = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

  const boton = (data: string) => ({
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: FROM,
      message: { message_id: 9, chat: { id: 500 } },
      data,
    },
  });

  it('📋 lista plantillas, y NO carga ninguna', async () => {
    const creation = fakeCreation();

    const { result } = ejecutar(boton(`act:template:${VERSION_TPL}`), { creation });

    expect(await result).toMatchObject({ creation: { kind: 'listed' } });
    expect(creation.pasos.some((p) => p.startsWith('fillVersion'))).toBe(false);
  });

  it('la segunda pulsación SÍ carga', async () => {
    const creation = fakeCreation();

    const { result } = ejecutar(boton(`tpl:full-body-3d:${VERSION_TPL}`), { creation });

    expect((await result).kind).toBe('handled');
    expect(creation.pasos).toContain('fillVersion:template');
  });

  it('✍️ deja un borrador vacío', async () => {
    const creation = fakeCreation();

    const { result } = ejecutar(boton(`act:manual:${VERSION_TPL}`), { creation });

    expect(await result).toMatchObject({ creation: { kind: 'filled' } });
    expect(creation.pasos).toContain('fillVersion:manual');
  });

  it('un `tpl:` NO se confunde con un `act:`', async () => {
    // Los tres prefijos viajan por el mismo canal.
    const creation = fakeCreation();
    const tocadas: string[] = [];

    const actions: ActionDeps = {
      repo: {
        findVersion: () => {
          tocadas.push('findVersion');
          return Promise.resolve(null);
        },
        transition: () => Promise.resolve(false),
      },
      sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
      generation: { trigger: () => Promise.resolve() },
      requestId: 'req-1',
    };

    const { result } = ejecutar(boton(`tpl:full-body-3d:${VERSION_TPL}`), { creation, actions });

    await result;
    expect(tocadas, 'no puede pasar por las acciones del entrenador').toEqual([]);
  });

  it('un comando del editor llega al borrador en curso', async () => {
    const creation = fakeCreation();

    const { result } = ejecutar(comando('/add 1 Remo 3x10'), { creation });

    expect(await result).toMatchObject({ editor: { kind: 'edited' } });
    expect(creation.pasos).toContain('currentDraft');
  });

  it('`/ver` sin borrador abierto lo dice', async () => {
    const creation = fakeCreation({ borrador: false });

    const { result } = ejecutar(comando('/ver'), { creation });

    expect(await result).toMatchObject({ editor: { kind: 'no_draft' } });
  });

  it('un CLIENTE que escribe /add no toca ningún borrador', async () => {
    // El editor es del entrenador. Su comando sigue camino y acaba en la
    // respuesta genérica de SPEC-007, no en un silencio.
    const repo = fakeRepo({
      findIdentity: async () => ({
        profileId: 'p-cliente',
        role: 'client' as const,
        telegramUserId: 500,
        telegramChatId: 500,
      }),
    });
    const creation = fakeCreation();

    const { result } = ejecutar(comando('/add 1 Remo 3x10'), { repo, creation });

    const outcome = await result;
    expect(creation.pasos).not.toContain('currentDraft');
    expect(outcome).toMatchObject({ command: { kind: 'forbidden' } });
  });

  it('un comando que NO es del editor sigue a los comandos normales', async () => {
    const creation = fakeCreation();
    const commands = fakeCommands();

    const { result } = ejecutar(comando('/clientes'), { creation, commands });

    await result;
    expect(creation.pasos).toEqual([]);
    expect(commands.pasos).toContain('clients');
  });
});

// ---------------------------------------------------------------------------

describe('las solicitudes de cambio se enrutan', () => {
  const VERSION_SENT = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

  const CLIENTE: Identity = {
    profileId: 'p-cliente',
    role: 'client',
    telegramUserId: 500,
    telegramChatId: 500,
  };

  const boton = (data: string) => ({
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: FROM,
      message: { message_id: 9, chat: { id: 500 } },
      data,
    },
  });

  it('👍 me sirve llega a su flujo', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const changes = fakeChanges();

    const { result } = ejecutar(boton(`act:accept:${VERSION_SENT}`), { repo, changes });

    expect(await result).toMatchObject({ change: { kind: 'accepted' } });
    expect(changes.pasos).toContain('recordAccepted');
  });

  it('✏️ pedir un cambio pregunta los motivos, sin guardar', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const changes = fakeChanges();

    const { result } = ejecutar(boton(`act:change:${VERSION_SENT}`), { repo, changes });

    expect(await result).toMatchObject({ change: { kind: 'asked_reason' } });
    expect(changes.pasos).not.toContain('request');
  });

  it('el motivo elegido SÍ se guarda', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const changes = fakeChanges();

    const { result } = ejecutar(boton(`chg:too_hard:${VERSION_SENT}`), { repo, changes });

    expect(await result).toMatchObject({ change: { kind: 'requested' } });
    expect(changes.pasos).toContain('request');
  });

  it('✏️ crear v2 es del ENTRENADOR', async () => {
    const changes = fakeChanges();

    const { result } = ejecutar(boton(`act:revise:${VERSION_SENT}`), { changes });

    expect(await result).toMatchObject({ change: { kind: 'revision_started' } });
    expect(changes.pasos).toContain('createRevision');
  });

  it('un `chg:` NO se confunde con los otros prefijos', async () => {
    // Cuatro prefijos por el mismo canal: act, chk, tpl y chg.
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const changes = fakeChanges();
    const creation = fakeCreation();
    const checkins = fakeCheckins({ dueño: 'p-cliente' });

    const { result } = ejecutar(boton(`chg:want_variety:${VERSION_SENT}`), {
      repo,
      changes,
      creation,
      checkins,
    });

    await result;
    expect(changes.pasos).toContain('request');
    expect(creation.pasos).toEqual([]);
    expect(checkins.pasos).toEqual([]);
  });
});

describe('CA-11 · el texto libre va a la última pregunta', () => {
  const CLIENTE: Identity = {
    profileId: 'p-cliente',
    role: 'client',
    telegramUserId: 500,
    telegramChatId: 500,
  };

  it('con una solicitud MÁS RECIENTE, el texto es su comentario', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: true });
    const changes = fakeChanges({
      abierta: { hasComment: false, askedAt: new Date('2026-03-20T09:00:00Z') },
    });

    const { result } = ejecutar(comando('no termino la semana'), { repo, checkins, changes });

    expect(await result).toMatchObject({ change: { kind: 'commented' } });
    expect(changes.pasos).toContain('addComment');
    expect(checkins.pasos).not.toContain('saveAnswers:false');
  });

  it('con el check-in más reciente, el texto es la molestia', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: true });
    const changes = fakeChanges({
      abierta: { hasComment: false, askedAt: new Date('2026-03-01T09:00:00Z') },
    });

    const { result } = ejecutar(comando('me duele el hombro'), { repo, checkins, changes });

    await result;
    expect(checkins.pasos).toContain('saveAnswers:false');
    expect(changes.pasos).not.toContain('addComment');
  });

  it('una solicitud que YA tiene comentario no se lo come', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: true });
    const changes = fakeChanges({
      abierta: { hasComment: true, askedAt: new Date('2026-03-20T09:00:00Z') },
    });

    const { result } = ejecutar(comando('otra cosa'), { repo, checkins, changes });

    await result;
    expect(checkins.pasos).toContain('saveAnswers:false');
    expect(changes.pasos).not.toContain('addComment');
  });

  it('sin nada abierto, un mensaje es solo un mensaje', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: false });
    const changes = fakeChanges({ abierta: null });

    const { result } = ejecutar(comando('hola'), { repo, checkins, changes });

    expect(await result).toMatchObject({ checkin: { kind: 'no_open_checkin' } });
    expect(changes.pasos).not.toContain('addComment');
  });
});


// ─── SPEC-013 · el enrutado pasa la identidad, no solo el chat ──────────────

describe('un callback fabricado no da acceso ajeno', () => {
  /**
   * Un cliente vinculado que manda un `callback_data` que nunca recibió.
   *
   * No hace falta nada sofisticado: `callback_data` viaja DESDE el cliente,
   * y la API de bots no es la app oficial.
   */
  const ATACANTE: Identity = {
    profileId: 'p-cliente-cualquiera',
    role: 'client',
    telegramUserId: 777,
    telegramChatId: 777,
  };

  const AJENA = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

  const botonDe = (data: string) => ({
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: { id: ATACANTE.telegramUserId },
      message: { message_id: 9, chat: { id: ATACANTE.telegramChatId } },
      data,
    },
  });

  function correr(data: string) {
    const creation = fakeCreation();
    const repo = fakeRepo({ findIdentity: () => Promise.resolve(ATACANTE) });

    return {
      creation,
      result: handleTelegramWebhook(
        { secretHeader: SECRET, body: botonDe(data) },
        {
          repo: repo.repo,
          sender: fakeSender().sender,
          expectedSecret: SECRET,
          requestId: 'req-1',
          delivery: fakeDelivery().deps,
          checkins: fakeCheckins().deps,
          commands: fakeCommands().deps,
          creation: creation.deps,
          changes: fakeChanges().deps,
          actions: vacioActions(),
          intake: fakeIntake().deps,
        },
      ),
    };
  }

  it.each([
    ['✍️ manual', `act:manual:${AJENA}`],
    ['📋 plantillas', `act:template:${AJENA}`],
    ['cargar una plantilla', `tpl:full-body-3d:${AJENA}`],
  ])('%s sobre una versión ajena no escribe nada', async (_nombre, data) => {
    const { creation, result } = correr(data);
    await result;

    expect(creation.pasos.some((p) => p.startsWith('fillVersion'))).toBe(false);
  });

  it('el update se atiende igual: no se cae ni delata', async () => {
    const { result } = correr(`act:manual:${AJENA}`);

    expect((await result).kind).toBe('handled');
  });
});

// ─── SPEC-015 · el botón 📄 llega al flujo ──────────────────────────────────

describe('la ficha de admisión', () => {
  const FICHA_ID = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

  const botonFicha = (data: string) => ({
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: FROM,
      message: { message_id: 9, chat: { id: 500 } },
      data,
    },
  });

  it('CA-6 · `act:intake:` consulta la evaluación', async () => {
    // El cableado, no el dominio. Seis veces ya un flujo quedó construido y
    // sin enchufar: esto comprueba que el botón llega a algún sitio.
    const intake = fakeIntake();

    await handleTelegramWebhook(
      { secretHeader: SECRET, body: botonFicha(`act:intake:${FICHA_ID}`) },
      {
        repo: fakeRepo().repo,
        sender: fakeSender().sender,
        expectedSecret: SECRET,
        requestId: 'req-1',
        delivery: fakeDelivery().deps,
        checkins: fakeCheckins().deps,
        commands: fakeCommands().deps,
        creation: fakeCreation().deps,
        changes: fakeChanges().deps,
        actions: vacioActions(),
        intake: intake.deps,
      },
    );

    expect(intake.pasos).toContain('findIntake');
  });

  it('CA-2 · leer NO transiciona: no toca las acciones', async () => {
    const acciones: string[] = [];
    const intake = fakeIntake();

    await handleTelegramWebhook(
      { secretHeader: SECRET, body: botonFicha(`act:intake:${FICHA_ID}`) },
      {
        repo: fakeRepo().repo,
        sender: fakeSender().sender,
        expectedSecret: SECRET,
        requestId: 'req-1',
        delivery: fakeDelivery().deps,
        checkins: fakeCheckins().deps,
        commands: fakeCommands().deps,
        creation: fakeCreation().deps,
        changes: fakeChanges().deps,
        actions: {
          repo: {
            findVersion: () => {
              acciones.push('findVersion');
              return Promise.resolve(null);
            },
            transition: () => {
              acciones.push('transition');
              return Promise.resolve(false);
            },
          },
          sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
          generation: { trigger: () => Promise.resolve() },
          requestId: 'req-1',
        },
        intake: intake.deps,
      },
    );

    expect(acciones).toEqual([]);
  });
});
