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
import type { TelegramRepo, TelegramSender } from '../ports/telegram-ports.ts';
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

function comando(text: string, updateId = 1) {
  return {
    update_id: updateId,
    message: { message_id: 9, from: FROM, chat: { id: 500 }, text },
  };
}

function ejecutar(
  body: unknown,
  opts: {
    secretHeader?: string | null;
    repo?: ReturnType<typeof fakeRepo>;
    sender?: ReturnType<typeof fakeSender>;
  } = {},
) {
  const repo = opts.repo ?? fakeRepo();
  const sender = opts.sender ?? fakeSender();

  return {
    repo,
    sender,
    result: handleTelegramWebhook(
      { secretHeader: opts.secretHeader === undefined ? SECRET : opts.secretHeader, body },
      { repo: repo.repo, sender: sender.sender, expectedSecret: SECRET, requestId: 'req-1' },
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
