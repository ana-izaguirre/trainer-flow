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
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import type { Identity } from '../domain/identity.ts';
import type { CheckinRepo } from '../ports/checkin-ports.ts';
import type { CheckinAnswers } from '../checkin/answers.ts';
import type { ChangeRequestRepo } from '../ports/change-request-ports.ts';
import type { CreationRepo } from '../ports/creation-ports.ts';
import type { IntakeRepo } from '../ports/intake-ports.ts';
import type { LinkResendRepo } from '../ports/link-ports.ts';
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
import type { AIResult } from '../ports/ai-provider.ts';
import type { EditRepo } from '../ports/edit-ports.ts';
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
  /** SPEC-030 regla 9: el texto del acuse, cuando lo lleva. */
  const answeredWithText: Array<{ id: string; text: string | undefined }> = [];
  const calls: string[] = [];

  const sender: TelegramSender = {
    sendMessage: async (chatId, text) => {
      calls.push('sendMessage');
      sent.push({ chatId, text });
    },
    answerCallback: async (id, text) => {
      calls.push('answerCallback');
      answered.push(id);
      answeredWithText.push({ id, text });
    },
  };

  return { sender, sent, answered, answeredWithText, calls };
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
    repo: {
      findVersion: () => Promise.resolve(null),
      transition: () => Promise.resolve(false),
      startEditWait: () => Promise.resolve(false),
    },
    sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
    generation: { trigger: () => Promise.resolve() },
    requestId: 'req-1',
  };
}

/** Consultas falsas que registran qué se pidió. Por defecto, sin clientes. */
function fakeCommands(
  opciones: {
    clientes?: { clientId: string; fullName: string }[];
    detalle?: unknown;
    clientRoutine?: QueryRepo['clientRoutine'];
  } = {},
) {
  const pasos: string[] = [];
  /** El `callback_data` de cada botón que se mandó. */
  const botones: string[] = [];

  const repo: QueryRepo = {
    clientRoutine: (profileId) => {
      pasos.push('clientRoutine');
      return opciones.clientRoutine !== undefined
        ? opciones.clientRoutine(profileId)
        : Promise.resolve(null);
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
      return Promise.resolve(
        (opciones.detalle ?? null) as Awaited<ReturnType<QueryRepo['clientDetail']>>,
      );
    },
    pendingVersions: () => {
      pasos.push('pendingVersions');
      return Promise.resolve([]);
    },
    awaitingLink: () => {
      pasos.push('awaitingLink');
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
      sendMessage: (chatId, _text, keyboard) => {
        pasos.push(`sendMessage:${chatId}`);
        botones.push(...(keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? []));
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, pasos, botones };
}

/**
 * Solicitudes de cambio. Por defecto la versión es del cliente `p-cliente` y
 * está en SENT, que es lo único sobre lo que se puede pedir un cambio.
 */
function fakeChanges(
  opciones: {
    abierta?: { hasComment: boolean; askedAt: Date } | null;
    version?: unknown;
    created?: boolean;
  } = {},
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
      return Promise.resolve({ id: 'req-1', created: opciones.created ?? true });
    },
    openForClient: () => {
      pasos.push('openForClient');
      return Promise.resolve(
        opciones.abierta === undefined || opciones.abierta === null
          ? null
          : {
              requestId: 'req-1',
              clientId: 'c1',
              versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
              reason: 'too_hard' as const,
              createdAt: opciones.abierta.askedAt,
              ...opciones.abierta,
            },
      );
    },
    touchAsk: () => {
      pasos.push('touchAsk');
      return Promise.resolve(true);
    },
    addComment: () => {
      pasos.push('addComment');
      return Promise.resolve({ saved: true, truncated: false });
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
    now: () => new Date('2026-03-22T09:00:00Z'),
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
function fakeCheckins(
  opciones: {
    dueño?: string | null;
    abierto?: boolean;
    /** SPEC-030 regla 9: para probar el acuse con distintas respuestas ya guardadas. */
    answers?: CheckinAnswers;
  } = {},
) {
  const pasos: string[] = [];

  const registro = {
    checkinId: CHECKIN_ID,
    clientProfileId: opciones.dueño === undefined ? 'otro-perfil' : opciones.dueño,
    clientName: 'Carlos',
    weekNumber: 2,
    state: 'PENDING' as const,
    answers: opciones.answers ?? { sessions: null, feeling: null, discomfort: null },
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
        versionNumber: 1,
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

/** SPEC-014 §3: un reenvío que no encuentra nada, para los tests que no lo miran. */
function fakeLink(cliente: unknown = undefined) {
  const pasos: string[] = [];
  return {
    pasos,
    deps: {
      repo: {
        findClientForVersion: () => {
          pasos.push('findClientForVersion');
          return Promise.resolve(
            cliente === undefined
              ? null
              : (cliente as Awaited<ReturnType<LinkResendRepo['findClientForVersion']>>),
          );
        },
      },
      botUsername: 'mibot',
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

/** SPEC-027: pedir la actualización de datos. Por defecto, todo sale bien. */
function fakeUpdates() {
  const pasos: string[] = [];
  return {
    pasos,
    deps: {
      repo: {
        issueForProfile: (profileId: string) => {
          pasos.push(`issueForProfile:${profileId}`);
          return Promise.resolve('c1');
        },
        issueForClient: (clientId: string) => {
          pasos.push(`issueForClient:${clientId}`);
          return Promise.resolve(700);
        },
      },
      clients: {
        findClientForVersion: () => {
          pasos.push('findClientForVersion');
          return Promise.resolve({
            client: { clientId: 'c1', trainerId: 'p-trainer', profileId: 'p-cliente' },
            fullName: 'Carlos',
            linked: true,
            linkToken: 'no-se-usa-aqui-000000000',
          });
        },
      },
      sender: {
        sendMessage: (chatId: number) => {
          pasos.push(`sendMessage:${chatId}`);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
      newToken: () => 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde',
      formUrl: 'https://tally.so/r/abc123',
    },
  };
}

/** SPEC-004: la edición conversacional. Por defecto, nada esperando. */
function fakeEdit(opciones: { pendiente?: unknown; outcome?: { kind: string } } = {}) {
  const pasos: string[] = [];
  return {
    pasos,
    deps: {
      repo: {
        findAwaitingEdit: () => {
          pasos.push('findAwaitingEdit');
          return Promise.resolve((opciones.pendiente ?? null) as never);
        },
        cancelEditWait: () => {
          pasos.push('cancelEditWait');
          return Promise.resolve();
        },
        cancelAnyEditWait: (trainerId: string) => {
          pasos.push(`cancelAnyEditWait:${trainerId}`);
          return Promise.resolve();
        },
        recentGenerations: () => {
          pasos.push('recentGenerations');
          return Promise.resolve([]);
        },
        startGeneration: () => {
          pasos.push('startGeneration');
          return Promise.resolve(1);
        },
        finishGeneration: () => {
          pasos.push('finishGeneration');
          return Promise.resolve();
        },
        saveEditedContent: () => {
          pasos.push('saveEditedContent');
          return Promise.resolve(true);
        },
      } as EditRepo,
      provider: {
        name: 'x',
        model: 'x',
        generate: (): Promise<AIResult> => {
          pasos.push('generate');
          return Promise.resolve({
            ok: true,
            draft: {
              source: 'ai',
              raw: {
                summary: 'Rutina de fuerza',
                days: [
                  {
                    dayNumber: 1,
                    focus: 'Empuje',
                    exercises: [
                      { name: 'Press banca', sets: 4, reps: '8', restSeconds: 120, notes: null },
                    ],
                  },
                ],
                warnings: [],
              },
            },
            usage: { tokensIn: 1, tokensOut: 1 },
          });
        },
      },
      sender: {
        sendMessage: (_c: number, text: string) => {
          pasos.push(`sendMessage:${text.slice(0, 30)}`);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
      rateLimit: { maxCalls: 5, windowMinutes: 60 },
      newTimeoutSignal: () => new AbortController().signal,
      now: () => new Date('2026-09-30T12:00:00Z'),
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
    updates?: ReturnType<typeof fakeUpdates>;
    edit?: ReturnType<typeof fakeEdit>;
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
        link: fakeLink().deps,
        updates: (opts.updates ?? fakeUpdates()).deps,
        edit: (opts.edit ?? fakeEdit()).deps,
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
    // NEUTRAL_REPLY llevaba dos puntos sueltos: MarkdownV2 rechazaba el
    // mensaje entero y este desconocido no recibía ni el aviso neutro.
    expect(tieneCaracterSinEscapar(sender.sent[0]!.text)).toBe(false);
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
    /** El `callback_data` de cada botón que se mandó. */
    const botones: string[] = [];

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
            plan: { goal: 'Fuerza', daysPerWeek: 1, sessionMinutes: 60 },
            editCount: 0,
          });
        },
        transition: (_v, from, to) => {
          pasos.push(`transition:${from}->${to}`);
          return Promise.resolve(true);
        },
        startEditWait: () => {
          pasos.push('startEditWait');
          return Promise.resolve(true);
        },
      },
      sender: {
        sendMessage: (_chatId, _text, keyboard) => {
          botones.push(...(keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? []));
          return Promise.resolve();
        },
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

    return { pasos, actions, botones };
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

  // SPEC-022 M3, de punta a punta: el botón que trae el rechazo, pulsado,
  // crea la v2. Antes el mensaje decía «Puedes empezar otra» y nada más.
  it('CA-M3 · rechazar trae ✏️ Crear v2, y pulsarlo crea la versión nueva', async () => {
    const { actions, botones } = enrutador();

    await ejecutar(conBoton(`act:reject:${VERSION}`), { actions }).result;
    expect(botones).toEqual([`act:revise:${VERSION}`]);

    const changes = fakeChanges({
      version: {
        versionId: VERSION,
        state: 'REJECTED' as const,
        planId: 'plan-1',
        clientName: 'Carlos',
        versionNumber: 1,
        trainerChatId: 10,
        client: { clientId: 'c1', trainerId: ENTRENADOR.profileId, profileId: null },
      },
    });
    const { result } = ejecutar({ ...conBoton(botones[0]!), update_id: 2 }, { changes });

    expect(await result).toMatchObject({ change: { kind: 'revision_started' } });
    expect(changes.pasos).toContain('createRevision');
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

  // SPEC-031, de punta a punta: el prefijo `nav:` llega a `handleNavigation`
  // y NUNCA transiciona la versión — es el mismo cuidado que exige
  // docs/STATE-MACHINE.md para cualquier código que toque `workout_versions`.
  it('un botón de navegación (`nav:idx:`) llega a `handleNavigation`, sin transicionar nada', async () => {
    const { pasos, actions } = enrutador();

    const { result } = ejecutar(conBoton(`nav:idx:${VERSION}`), { actions });
    const outcome = await result;

    expect(outcome).toMatchObject({ navigation: { kind: 'shown', view: { kind: 'index' } } });
    expect(pasos).toContain(`answerCallback:cb-1`);
    expect(pasos.some((p) => p.startsWith('transition'))).toBe(false);
  });

  it('`nav:d1:` manda solo ese día (el único que trae el fixture)', async () => {
    const { actions, botones } = enrutador();

    const { result } = ejecutar(conBoton(`nav:d1:${VERSION}`), { actions });

    expect(await result).toMatchObject({
      navigation: { kind: 'shown', view: { kind: 'day', dayNumber: 1 } },
    });
    // Un solo día: la navegación solo trae «Índice» (ni anterior ni
    // siguiente); DRAFT es el estado del fixture, así que abajo van sus tres
    // acciones — la fila de decisión también va en la vista de un día.
    expect(botones).toEqual([
      `nav:idx:${VERSION}`,
      `act:approve:${VERSION}`,
      `act:reject:${VERSION}`,
      `act:intake:${VERSION}`,
    ]);
  });

  it('un día que no existe cae al índice, sin error', async () => {
    const { actions } = enrutador();

    const { result } = ejecutar(conBoton(`nav:d9:${VERSION}`), { actions });

    expect(await result).toMatchObject({ navigation: { kind: 'shown', view: { kind: 'index' } } });
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

  describe('SPEC-030 regla 9 · el acuse lleva el texto de lo que se guardó', () => {
    it('el botón se responde UNA vez, con el acuse — no en blanco al llegar', async () => {
      const repo = fakeRepo({ findIdentity: async () => CLIENTE });
      const checkins = fakeCheckins({ dueño: 'p-cliente' });
      const sender = fakeSender();

      const { result } = ejecutar(conBotonChk(`chk:feeling:good:${CHECKIN_ID}`), {
        repo,
        checkins,
        sender,
      });

      await result;
      // Exactamente una vez: nada respondió en blanco antes de saber qué decir.
      expect(sender.calls.filter((c) => c === 'answerCallback')).toHaveLength(1);
      const [acuse] = sender.answeredWithText;
      expect(acuse?.id).toBe('cb-1');
      expect(acuse?.text).toContain('Anotado: 💪 Bien');
      // Solo contestó feeling: sessions y discomfort siguen sin responder.
      expect(acuse?.text).toContain('Falta: ¿cuántas sesiones?');
    });

    it('completar las tres no lleva «Falta»', async () => {
      const repo = fakeRepo({ findIdentity: async () => CLIENTE });
      // Solo falta `discomfort`, que es justo lo que este botón contesta.
      const checkins = fakeCheckins({
        dueño: 'p-cliente',
        answers: { sessions: 3, feeling: 'good', discomfort: null },
      });
      const sender = fakeSender();

      const { result } = ejecutar(conBotonChk(`chk:discomfort:none:${CHECKIN_ID}`), {
        repo,
        checkins,
        sender,
      });

      await result;
      const [acuse] = sender.answeredWithText;
      expect(acuse?.text).toContain('Anotado: sin molestias');
      expect(acuse?.text).not.toContain('Falta');
    });

    it('un check-in ajeno se responde en blanco, no con un acuse', async () => {
      const repo = fakeRepo({ findIdentity: async () => CLIENTE });
      const checkins = fakeCheckins({ dueño: 'otro-perfil' });
      const sender = fakeSender();

      const { result } = ejecutar(conBotonChk(`chk:feeling:good:${CHECKIN_ID}`), {
        repo,
        checkins,
        sender,
      });

      await result;
      expect(sender.calls.filter((c) => c === 'answerCallback')).toHaveLength(1);
      expect(sender.answeredWithText[0]?.text).toBeUndefined();
    });

    it('identidad desconocida: igual se responde el botón, para no dejarlo girando', async () => {
      const repo = fakeRepo({ findIdentity: async () => null });
      const sender = fakeSender();

      const { result } = ejecutar(conBotonChk(`chk:feeling:good:${CHECKIN_ID}`), {
        repo,
        sender,
      });

      await result;
      expect(sender.calls.filter((c) => c === 'answerCallback')).toHaveLength(1);
      expect(sender.answeredWithText[0]?.text).toBeUndefined();
    });

    it('un botón que NO es de check-in sigue respondiéndose de inmediato, en blanco', async () => {
      const creation = fakeCreation();
      const sender = fakeSender();
      const otroBoton = {
        update_id: 1,
        callback_query: {
          id: 'cb-1',
          from: FROM,
          message: { message_id: 9, chat: { id: 500 } },
          data: `act:template:3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b`,
        },
      };

      const { result } = ejecutar(otroBoton, { creation, sender });

      await result;
      expect(sender.calls.filter((c) => c === 'answerCallback')).toHaveLength(1);
      expect(sender.answeredWithText[0]?.text).toBeUndefined();
    });
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
        startEditWait: () => Promise.resolve(false),
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

describe('SPEC-004 — la instrucción de edición, cuando el entrenador escribe suelto', () => {
  const CLIENTE: Identity = {
    profileId: 'p-cliente',
    role: 'client',
    telegramUserId: 500,
    telegramChatId: 500,
  };

  const PENDIENTE = {
    versionId: 'v1',
    editCount: 1,
    clientName: 'Carlos',
    versionNumber: 1,
    request: {
      goal: 'Fuerza',
      level: 'intermediate',
      gender: null,
      age: null,
      weightKg: null,
      heightCm: null,
      quitReasons: null,
      menopauseStage: null,
      lastWeighed: null,
      chronicConditions: null,
      medications: null,
      equipmentDetail: null,
      lifestyle: null,
      notes: null,
      daysPerWeek: 1,
      sessionMinutes: 60,
      equipment: 'Barra',
      limitations: null,
      instruction: null,
    },
    constraints: { daysPerWeek: 1, hasLimitations: false },
    trainerChatId: 500,
  };

  it('sin nada esperando, se mira pero no se dispara nada más', async () => {
    const edit = fakeEdit();

    const { result } = ejecutar(comando('una nota cualquiera'), { edit });

    expect(await result).toMatchObject({ editInstruction: { kind: 'nothing_pending' } });
    expect(edit.pasos).toEqual(['findAwaitingEdit']);
  });

  it('con algo esperando, el texto se interpreta como la instrucción', async () => {
    const edit = fakeEdit({ pendiente: PENDIENTE });

    const { result } = ejecutar(comando('Quita sentadilla'), { edit });

    expect(await result).toMatchObject({ editInstruction: { kind: 'edited', versionId: 'v1' } });
    expect(edit.pasos).toContain('generate');
    expect(edit.pasos).toContain('saveEditedContent');
  });

  it('un COMANDO del entrenador cancela cualquier espera pendiente, antes de procesar el comando', async () => {
    const edit = fakeEdit();

    const { result } = ejecutar(comando('/clientes'), { edit });

    await result;
    expect(edit.pasos[0]).toBe('cancelAnyEditWait:p-trainer');
  });

  it('un comando o texto del CLIENTE nunca toca la espera de edición del entrenador', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: false });
    const edit = fakeEdit();

    const { result } = ejecutar(comando('hola'), { repo, checkins, edit });

    await result;
    expect(edit.pasos).toEqual([]);
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
        startEditWait: () => Promise.resolve(false),
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

describe('SPEC-031 · /crear_rutina <cliente>, de un mensaje', () => {
  /** Coincide con el `versionId` que `fakeCreation().findVersion()` da por defecto. */
  const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

  function detalleNew() {
    return {
      clientId: 'c1',
      fullName: 'Carlos',
      versionState: 'NEW' as const,
      versionNumber: 1,
      linked: true,
      pendingCheckinDays: null,
      versionId: VERSION,
      goal: null,
      level: null,
      daysPerWeek: null,
      sessionMinutes: null,
      equipment: null,
      hasLimitations: false,
      sentDaysAgo: null,
      lastCheckin: null,
      openChangeRequest: null,
    };
  }

  it('un nombre que matchea llena la versión SIN pasar por el editor', async () => {
    const commands = fakeCommands({
      clientes: [{ clientId: 'c1', fullName: 'Carlos' }],
      detalle: detalleNew(),
    });
    const creation = fakeCreation();

    const { result } = ejecutar(comando('/crear_rutina Carlos\nDía 1: Empuje\nPress banca 4x8 90'), {
      commands,
      creation,
    });

    expect(await result).toMatchObject({ quickCreate: { kind: 'filled', versionId: VERSION } });
    expect(creation.pasos).toContain('fillVersion:manual');
    // No pasó por `currentDraft`: el editor de siempre nunca se llamó.
    expect(creation.pasos).not.toContain('currentDraft');
  });

  it('sin nombre que matchee, cae exactamente al editor de siempre', async () => {
    const commands = fakeCommands(); // sin clientes: ningún nombre puede matchear
    const creation = fakeCreation();

    const { result } = ejecutar(comando('/crear_rutina\nDía 1: Empuje\nPress banca 4x8 90'), {
      commands,
      creation,
    });

    const outcome = await result;
    expect(outcome).not.toHaveProperty('quickCreate');
    expect(outcome).toMatchObject({ editor: { kind: 'edited' } });
    expect(creation.pasos).toContain('currentDraft');
  });

  it('un CLIENTE que escribe /crear_rutina no dispara el atajo', async () => {
    const repo = fakeRepo({
      findIdentity: async () => ({
        profileId: 'p-cliente',
        role: 'client' as const,
        telegramUserId: 500,
        telegramChatId: 500,
      }),
    });
    const commands = fakeCommands({
      clientes: [{ clientId: 'c1', fullName: 'Carlos' }],
      detalle: detalleNew(),
    });

    const { result } = ejecutar(comando('/crear_rutina Carlos\nDía 1: Empuje\nPress banca 4x8 90'), {
      repo,
      commands,
    });

    const outcome = await result;
    expect(outcome).not.toHaveProperty('quickCreate');
    expect(commands.pasos).not.toContain('clients');
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

  // SPEC-030 regla 4: una solicitud que YA tiene comentario sigue aceptando
  // texto —se AÑADE, no se pierde—. Antes se ignoraba, y era justo el hueco
  // que hacía que un segundo mensaje del cliente cayera en el vacío.
  it('SPEC-030 · una solicitud que YA tiene comentario también se lo queda', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: true });
    const changes = fakeChanges({
      abierta: { hasComment: true, askedAt: new Date('2026-03-20T09:00:00Z') },
    });

    const { result } = ejecutar(comando('otra cosa'), { repo, checkins, changes });

    expect(await result).toMatchObject({ change: { kind: 'commented' } });
    expect(checkins.pasos).not.toContain('saveAnswers:false');
    expect(changes.pasos).toContain('addComment');
  });

  it('sin nada abierto, un mensaje es solo un mensaje', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: false });
    const changes = fakeChanges({ abierta: null });

    const { result } = ejecutar(comando('hola'), { repo, checkins, changes });

    expect(await result).toMatchObject({ checkin: { kind: 'no_open_checkin' } });
    expect(changes.pasos).not.toContain('addComment');
  });

  // SPEC-030 regla 8 — ningún mensaje suelto del cliente se queda callado.
  it('SPEC-030 · sin nada abierto, el cliente recibe la ayuda corta', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const checkins = fakeCheckins({ dueño: 'p-cliente', abierto: false });
    const changes = fakeChanges({ abierta: null });
    const sender = fakeSender();

    const { result } = ejecutar(comando('hola'), { repo, checkins, changes, sender });

    await result;
    const respuesta = sender.sent.find((m) => m.chatId === CLIENTE.telegramChatId);
    expect(respuesta?.text).toContain('pregunta pendiente');
  });
});

describe('SPEC-030 · /cambio_rutina, escrito en vez de pulsado', () => {
  const CLIENTE: Identity = {
    profileId: 'p-cliente',
    role: 'client',
    telegramUserId: 500,
    telegramChatId: 500,
  };

  it('sin rutina enviada, el mismo mensaje que /rutina', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const commands = fakeCommands({ clientRoutine: () => Promise.resolve(null) });
    const sender = fakeSender();

    const { result } = ejecutar(comando('/cambio_rutina'), { repo, commands, sender });

    await result;
    const respuesta = sender.sent.find((m) => m.chatId === CLIENTE.telegramChatId);
    expect(respuesta?.text).toContain('Todavía no tienes una rutina');
  });

  it('con rutina enviada, pregunta los motivos igual que el botón', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const commands = fakeCommands({
      clientRoutine: () =>
        Promise.resolve({
          versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
          state: 'SENT' as const,
          content: { summary: 's', days: [], warnings: [] },
          clientName: 'Carlos',
          clientChatId: 500,
          trainerChatId: 10,
          plan: null,
          versionNumber: 1,
        }),
    });
    const changes = fakeChanges();

    const { result } = ejecutar(comando('/cambio_rutina'), { repo, commands, changes });

    expect(await result).toMatchObject({ change: { kind: 'asked_reason' } });
    expect(changes.pasos).toContain('findVersion');
  });

  it('un entrenador no dispara el camino del cliente', async () => {
    const repo = fakeRepo({ findIdentity: async () => ENTRENADOR });
    const commands = fakeCommands();

    const { result } = ejecutar(comando('/cambio_rutina'), { repo, commands });

    expect(await result).toMatchObject({ command: { kind: 'unknown', command: 'cambio_rutina' } });
  });
});

describe('SPEC-030 regla 7 · /rutina avisa de un cambio pendiente', () => {
  const CLIENTE: Identity = {
    profileId: 'p-cliente',
    role: 'client',
    telegramUserId: 500,
    telegramChatId: 500,
  };

  it('con una solicitud abierta, el aviso sale ANTES de la rutina', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const commands = fakeCommands();
    const changes = fakeChanges({
      abierta: { hasComment: false, askedAt: new Date('2026-03-20T09:00:00Z') },
    });
    const sender = fakeSender();

    const { result } = ejecutar(comando('/rutina'), { repo, commands, changes, sender });

    await result;
    const mios = sender.sent.filter((m) => m.chatId === CLIENTE.telegramChatId);
    expect(mios[0]?.text).toContain('Pediste un cambio');
    expect(mios[0]?.text).toContain('Muy difícil');
  });

  it('pedida hace exactamente 1 día, dice «hace 1 día» en singular', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const commands = fakeCommands();
    const changes = fakeChanges({
      abierta: { hasComment: false, askedAt: new Date('2026-03-21T09:00:00Z') },
    });
    const sender = fakeSender();

    const { result } = ejecutar(comando('/rutina'), { repo, commands, changes, sender });

    await result;
    const mios = sender.sent.filter((m) => m.chatId === CLIENTE.telegramChatId);
    expect(mios[0]?.text).toContain('hace 1 día');
  });

  it('pedida hoy mismo, dice «hoy»', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const commands = fakeCommands();
    const changes = fakeChanges({
      abierta: { hasComment: false, askedAt: new Date('2026-03-22T09:00:00Z') },
    });
    const sender = fakeSender();

    const { result } = ejecutar(comando('/rutina'), { repo, commands, changes, sender });

    await result;
    const mios = sender.sent.filter((m) => m.chatId === CLIENTE.telegramChatId);
    expect(mios[0]?.text).toContain('hoy');
  });

  it('sin nada abierto, no manda ningún aviso extra', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const commands = fakeCommands();
    const changes = fakeChanges({ abierta: null });
    const sender = fakeSender();

    const { result } = ejecutar(comando('/rutina'), { repo, commands, changes, sender });

    await result;
    const mios = sender.sent.filter((m) => m.chatId === CLIENTE.telegramChatId);
    expect(mios.some((m) => m.text.includes('Pediste un cambio'))).toBe(false);
  });

  it('un entrenador no dispara el aviso', async () => {
    const repo = fakeRepo({ findIdentity: async () => ENTRENADOR });
    const changes = fakeChanges({
      abierta: { hasComment: false, askedAt: new Date('2026-03-20T09:00:00Z') },
    });

    const { result } = ejecutar(comando('/rutina'), { repo, changes });

    await result;
    // `/rutina` no es un comando del entrenador: ni siquiera llega a mirar
    // si hay una solicitud abierta.
    expect(changes.pasos).not.toContain('openForClient');
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
        link: fakeLink().deps,
        updates: fakeUpdates().deps,
        edit: fakeEdit().deps,
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
        link: fakeLink().deps,
        updates: fakeUpdates().deps,
        edit: fakeEdit().deps,
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
            startEditWait: () => {
              acciones.push('startEditWait');
              return Promise.resolve(false);
            },
          },
          sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
          generation: { trigger: () => Promise.resolve() },
          requestId: 'req-1',
        },
        intake: intake.deps,
        link: fakeLink().deps,
        updates: fakeUpdates().deps,
        edit: fakeEdit().deps,
      },
    );

    expect(acciones).toEqual([]);
  });
});

// ─── SPEC-014 §3 · el botón 🔗 llega al flujo ───────────────────────────────

describe('reenviar el enlace de vinculación', () => {
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

  it('`act:link:` consulta al cliente dueño de la versión', async () => {
    // El cableado, no el dominio: mismo motivo que el test de 'intake'.
    const link = fakeLink();

    await handleTelegramWebhook(
      { secretHeader: SECRET, body: botonFicha(`act:link:${FICHA_ID}`) },
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
        intake: fakeIntake().deps,
        link: link.deps,
        updates: fakeUpdates().deps,
        edit: fakeEdit().deps,
      },
    );

    expect(link.pasos).toContain('findClientForVersion');
  });

  it('leer NO transiciona: no toca las acciones', async () => {
    const acciones: string[] = [];
    const link = fakeLink();

    await handleTelegramWebhook(
      { secretHeader: SECRET, body: botonFicha(`act:link:${FICHA_ID}`) },
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
            startEditWait: () => {
              acciones.push('startEditWait');
              return Promise.resolve(false);
            },
          },
          sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
          generation: { trigger: () => Promise.resolve() },
          requestId: 'req-1',
        },
        intake: fakeIntake().deps,
        link: link.deps,
        updates: fakeUpdates().deps,
        edit: fakeEdit().deps,
      },
    );

    expect(acciones).toEqual([]);
  });

  it('el resultado viaja en el outcome, bajo `link`', async () => {
    const link = fakeLink({
      client: { clientId: 'c1', trainerId: 'p-trainer', profileId: null },
      fullName: 'Ana',
      linked: false,
      linkToken: 'un-token-de-prueba',
    });

    const outcome = await handleTelegramWebhook(
      { secretHeader: SECRET, body: botonFicha(`act:link:${FICHA_ID}`) },
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
        intake: fakeIntake().deps,
        link: link.deps,
        updates: fakeUpdates().deps,
        edit: fakeEdit().deps,
      },
    );

    expect(outcome).toMatchObject({ kind: 'handled', link: { kind: 'sent', clientId: 'c1' } });
  });
});

// ---------------------------------------------------------------------------

describe('SPEC-022 M4 · el botón cli: se enruta', () => {
  const ANA_1 = '11111111-1111-4111-8111-111111111111';
  const ANA_2 = '22222222-2222-4222-8222-222222222222';
  const DOS_ANAS = [
    { clientId: ANA_1, fullName: 'Ana Izaguirre Matamoros' },
    { clientId: ANA_2, fullName: 'Ana María López' },
  ];

  const boton = (data: string, updateId = 2) => ({
    update_id: updateId,
    callback_query: {
      id: 'cb-1',
      from: FROM,
      message: { message_id: 9, chat: { id: 500 } },
      data,
    },
  });

  const fichaDe = (clientId: string) => ({
    clientId,
    fullName: 'Ana Izaguirre Matamoros',
    versionState: 'REJECTED',
    versionNumber: 1,
    linked: true,
    pendingCheckinDays: null,
    versionId: '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b',
    goal: null,
    level: null,
    daysPerWeek: null,
    sessionMinutes: null,
    equipment: null,
    hasLimitations: false,
    sentDaysAgo: null,
    lastCheckin: null,
    openChangeRequest: null,
  });

  it('CA-M4 · /cliente Ana con dos Anas → botones, y pulsar uno abre SU ficha', async () => {
    const commands = fakeCommands({ clientes: DOS_ANAS, detalle: fichaDe(ANA_1) });

    await ejecutar(comando('/cliente Ana', 1), { commands }).result;
    expect(commands.botones).toEqual([`cli:${ANA_1}`, `cli:${ANA_2}`]);
    expect(commands.pasos).not.toContain('clientDetail');

    const { result } = ejecutar(boton(commands.botones[0]!), { commands });

    expect(await result).toMatchObject({
      updateKind: 'callback',
      command: { kind: 'answered', command: 'cliente' },
    });
    expect(commands.pasos).toContain('clientDetail');
    // La ficha trae los botones de su estado: REJECTED → «Crear v2».
    expect(commands.botones).toContain('act:revise:3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b');
  });

  it('🔴 CA-M5 · un cli: fabricado con un id que no es suyo no abre nada', async () => {
    const commands = fakeCommands({ clientes: DOS_ANAS, detalle: fichaDe(ANA_1) });

    const { result } = ejecutar(boton('cli:99999999-9999-4999-8999-999999999999'), { commands });

    expect(await result).toMatchObject({ command: { kind: 'forbidden' } });
    expect(commands.pasos).not.toContain('clientDetail');
  });

  it('un `cli:` NO se confunde con los otros prefijos', async () => {
    const commands = fakeCommands({ clientes: DOS_ANAS, detalle: fichaDe(ANA_1) });
    const creation = fakeCreation();
    const changes = fakeChanges();
    const checkins = fakeCheckins();

    await ejecutar(boton(`cli:${ANA_1}`), { commands, creation, changes, checkins }).result;

    expect(creation.pasos).toEqual([]);
    expect(changes.pasos).toEqual([]);
    expect(checkins.pasos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('SPEC-027 · pedir la actualización de datos se enruta', () => {
  const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';
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

  it('/actualizar_datos de un CLIENTE emite SU enlace', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const updates = fakeUpdates();
    const commands = fakeCommands();

    const { result } = ejecutar(comando('/actualizar_datos'), { repo, updates, commands });

    expect(await result).toMatchObject({ update: { kind: 'sent', clientId: 'c1' } });
    expect(updates.pasos).toContain('issueForProfile:p-cliente');
    // No cae además en la ayuda del cliente.
    expect(commands.pasos).toEqual([]);
  });

  it('/actualizar_datos del ENTRENADOR no emite nada: es un comando del cliente', async () => {
    const updates = fakeUpdates();

    const { result } = ejecutar(comando('/actualizar_datos'), { updates });

    expect(await result).toMatchObject({ command: { kind: 'unknown' } });
    expect(updates.pasos).toEqual([]);
  });

  it('📝 del entrenador emite el del cliente y se lo manda a él', async () => {
    const updates = fakeUpdates();

    const { result } = ejecutar(boton(`act:reassess:${VERSION}`), { updates });

    expect(await result).toMatchObject({ update: { kind: 'sent', clientId: 'c1' } });
    expect(updates.pasos).toContain('issueForClient:c1');
    expect(updates.pasos).toContain('sendMessage:700');
  });

  it('🔴 un 📝 fabricado por un cliente no emite nada', async () => {
    const repo = fakeRepo({ findIdentity: async () => CLIENTE });
    const updates = fakeUpdates();

    const { result } = ejecutar(boton(`act:reassess:${VERSION}`), { repo, updates });

    expect(await result).toMatchObject({ update: { kind: 'rejected' } });
    expect(updates.pasos.some((p) => p.startsWith('issue'))).toBe(false);
  });
});
