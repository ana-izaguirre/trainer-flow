/**
 * SPEC-011 — el cableado.
 *
 * Los 504 tests de `_core` prueban la lógica. Ninguno prueba que esté BIEN
 * ENCHUFADA: que el nombre de la variable de entorno sea el correcto, que el
 * header sea el correcto, que un secreto que falta se note al arrancar.
 *
 * Un `TELEGRAM_BOT_TOKEN` mal escrito compila, pasa los 504, y revienta con el
 * primer mensaje real. Esto es lo que atrapa eso.
 *
 * Sin Docker, sin red, sin Supabase.
 */
import { assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import type { Identity } from '../_core/domain/identity.ts';
import type { TelegramRepo, TelegramSender } from '../_core/ports/telegram-ports.ts';
import type { ActionRepo } from '../_core/ports/action-ports.ts';
import type { AIProvider } from '../_core/ports/ai-provider.ts';
import type { CheckinRepo } from '../_core/ports/checkin-ports.ts';
import type { DeliveryRepo } from '../_core/ports/delivery-ports.ts';
import type { EditRepo } from '../_core/ports/edit-ports.ts';
import type { ChangeRequestRepo } from '../_core/ports/change-request-ports.ts';
import type { CreationRepo } from '../_core/ports/creation-ports.ts';
import type { QueryRepo } from '../_core/ports/query-ports.ts';
import { createHandler, readDeps, type HandlerDeps } from './index.ts';

const SECRETO = 'secreto-de-prueba';
const HEADER = 'x-telegram-bot-api-secret-token';

interface Espia {
  readonly deps: HandlerDeps;
  readonly usosDelRepo: string[];
  readonly enviados: string[];
}

function espia(identity: Identity | null = null): Espia {
  const usosDelRepo: string[] = [];
  const enviados: string[] = [];

  const repo: TelegramRepo = {
    claimEvent: (externalId) => {
      usosDelRepo.push(`claimEvent:${externalId}`);
      return Promise.resolve(true);
    },
    markProcessed: (externalId) => {
      usosDelRepo.push(`markProcessed:${externalId}`);
      return Promise.resolve();
    },
    findIdentity: (telegramUserId) => {
      usosDelRepo.push(`findIdentity:${telegramUserId}`);
      return Promise.resolve(identity);
    },
  };

  const sender: TelegramSender = {
    sendMessage: (chatId, text) => {
      enviados.push(`${chatId}:${text}`);
      return Promise.resolve();
    },
    answerCallback: () => Promise.resolve(),
  };

  // Los dos repos que el flujo necesita para botones y canje. Aquí se prueba
  // el pegamento HTTP, así que ninguno encuentra nada: basta con que estén.
  const actionRepo: ActionRepo = {
    findVersion: () => Promise.resolve(null),
    transition: () => Promise.resolve(false),
    startEditWait: () => Promise.resolve(false),
  };

  const editRepo: EditRepo = {
    findAwaitingEdit: () => Promise.resolve(null),
    cancelEditWait: () => Promise.resolve(),
    cancelAnyEditWait: () => Promise.resolve(),
    recentGenerations: () => Promise.resolve([]),
    startGeneration: () => Promise.resolve(1),
    finishGeneration: () => Promise.resolve(),
    saveEditedContent: () => Promise.resolve(false),
  };

  const deliveryRepo: DeliveryRepo = {
    findClientByToken: (token) => {
      usosDelRepo.push(`findClientByToken:${token.length}`);
      return Promise.resolve(null);
    },
    ensureClientProfile: () => Promise.resolve(null),
    linkClient: () => Promise.resolve(false),
    findApprovedVersion: () => Promise.resolve(null),
    findVersion: () => Promise.resolve(null),
    transition: () => Promise.resolve(false),
    resolveRequests: () => Promise.resolve(0),
  };

  const checkinRepo: CheckinRepo = {
    candidates: () => Promise.resolve([]),
    createCheckin: () => Promise.resolve('chk-1'),
    markSent: () => Promise.resolve(),
    pendingReminders: () => Promise.resolve([]),
    markReminded: () => Promise.resolve(),
    findCheckin: () => Promise.resolve(null),
    findOpenCheckin: () => Promise.resolve(null),
    saveAnswers: () => Promise.resolve(),
  };

  const queryRepo: QueryRepo = {
    clients: () => {
      usosDelRepo.push('clients');
      return Promise.resolve([]);
    },
    clientDetail: () => Promise.resolve(null),
    pendingVersions: () => Promise.resolve([]),
    awaitingLink: () => Promise.resolve([]),
    clientRoutine: () => Promise.resolve(null),
    staleCheckins: () => Promise.resolve([]),
  };

  const creationRepo: CreationRepo = {
    findVersion: () => Promise.resolve(null),
    fillVersion: () => Promise.resolve(false),
    currentDraft: () => {
      usosDelRepo.push('currentDraft');
      return Promise.resolve(null);
    },
    saveDraft: () => Promise.resolve(false),
  };

  const changeRepo: ChangeRequestRepo = {
    findVersion: () => Promise.resolve(null),
    request: () => Promise.resolve({ id: 'req-1', created: true }),
    openForClient: () => {
      usosDelRepo.push('openForClient');
      return Promise.resolve(null);
    },
    touchAsk: () => Promise.resolve(true),
    addComment: () => Promise.resolve({ saved: false, truncated: false }),
    findRequest: () => Promise.resolve(null),
    createRevision: () => Promise.resolve('v-2'),
    createRevisionIfCurrent: () => Promise.resolve('v-2'),
    recordAccepted: () => Promise.resolve(),
  };

  return {
    deps: {
      expectedSecret: SECRETO,
      repo: () => repo,
      sender: () => sender,
      actionRepo: () => actionRepo,
      deliveryRepo: () => deliveryRepo,
      checkinRepo: () => checkinRepo,
      queryRepo: () => queryRepo,
      creationRepo: () => creationRepo,
      changeRepo: () => changeRepo,
      intakeRepo: () => ({ findIntake: () => Promise.resolve(null) }),
      linkRepo: () => ({ findClientForVersion: () => Promise.resolve(null) }),
      botUsername: 'mibot',
      updateTokenRepo: () => ({
        issueForProfile: () => Promise.resolve(null),
        issueForClient: () => Promise.resolve(null),
      }),
      newToken: () => 'token-de-prueba-000000000000',
      tallyFormUrl: null,
      generation: () => ({
        trigger: (versionId) => {
          usosDelRepo.push(`trigger:${versionId}`);
          return Promise.resolve();
        },
      }),
      editRepo: () => editRepo,
      aiProvider: (): AIProvider => ({
        name: 'x',
        model: 'x',
        generate: () => Promise.reject(new Error('no debería llamarse en este test')),
      }),
      aiRateLimit: { maxCalls: 20, windowMinutes: 60 },
    },
    usosDelRepo,
    enviados,
  };
}

/** Silencia los logs del handler: aquí se prueba la respuesta, no la salida. */
async function pedir(deps: HandlerDeps, request: Request): Promise<Response> {
  const original = console.log;
  console.log = () => {};
  try {
    return await createHandler(deps)(request);
  } finally {
    console.log = original;
  }
}

function update(body: unknown, secreto: string | null = SECRETO): Request {
  return new Request('https://ejemplo.test/', {
    method: 'POST',
    headers: secreto === null ? {} : { [HEADER]: secreto },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------

Deno.test('CA-2 · un secreto incorrecto responde 401 y NO toca el repo', async () => {
  const { deps, usosDelRepo } = espia();

  const response = await pedir(deps, update({ update_id: 1 }, 'secreto-equivocado'));

  assertEquals(response.status, 401);
  assertEquals(usosDelRepo, []);
});

Deno.test('CA-2 · sin el header tampoco pasa', async () => {
  const { deps, usosDelRepo } = espia();

  assertEquals((await pedir(deps, update({ update_id: 1 }, null))).status, 401);
  assertEquals(usosDelRepo, []);
});

Deno.test('el nombre del header es exactamente el que manda Telegram', async () => {
  // Telegram manda `x-telegram-bot-api-secret-token`. Si alguien lo cambia por
  // una variante parecida, el bot deja de funcionar sin que falle nada más.
  const { deps } = espia();

  const conHeaderMalEscrito = new Request('https://ejemplo.test/', {
    method: 'POST',
    headers: { 'x-telegram-secret-token': SECRETO },
    body: '{}',
  });

  assertEquals((await pedir(deps, conHeaderMalEscrito)).status, 401);
});

Deno.test('CA-3 · un cuerpo que no es JSON no lanza', async () => {
  const { deps } = espia();

  const roto = new Request('https://ejemplo.test/', {
    method: 'POST',
    headers: { [HEADER]: SECRETO },
    body: 'esto no es json {{{',
  });

  const response = await pedir(deps, roto);
  assertEquals(response.status < 500, true);
});

Deno.test('un update de alguien desconocido no revienta y no envía nada', async () => {
  // SPEC-009: nadie se auto-registra. La respuesta es neutra.
  const { deps, enviados } = espia(null);

  const response = await pedir(
    deps,
    update({ update_id: 1, message: { chat: { id: 5 }, from: { id: 5 }, text: '/start' } }),
  );

  assertEquals(response.status, 200);
  assertEquals(enviados, []);
});

Deno.test('CA-1 · readDeps lanza nombrando la variable que falta', () => {
  // Es el fallo que motivó la spec: antes esto se leía DENTRO de la petición,
  // así que un secreto mal escrito dejaba desplegar y fallaba con el primer
  // mensaje real.
  const previos = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'SUPABASE_URL'].map(
    (nombre) => [nombre, Deno.env.get(nombre)] as const,
  );
  for (const [nombre] of previos) Deno.env.delete(nombre);

  try {
    const error = assertThrows(() => readDeps()) as Error;
    assertStringIncludes(error.message, 'TELEGRAM_BOT_TOKEN');
  } finally {
    for (const [nombre, valor] of previos) {
      if (valor !== undefined) Deno.env.set(nombre, valor);
    }
  }
});

Deno.test('sin TELEGRAM_BOT_USERNAME, revienta nombrándolo', () => {
  // Ya era obligatoria para tally-webhook (SPEC-014); reenviar el enlace
  // (SPEC-014 §3) desde aquí necesita la misma variable.
  const necesarias = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'].map(
    (nombre) => [nombre, Deno.env.get(nombre)] as const,
  );
  for (const [nombre] of necesarias) Deno.env.set(nombre, 'lo-que-sea');

  const original = Deno.env.get('TELEGRAM_BOT_USERNAME');
  Deno.env.delete('TELEGRAM_BOT_USERNAME');

  try {
    const error = assertThrows(() => readDeps()) as Error;
    assertStringIncludes(error.message, 'TELEGRAM_BOT_USERNAME');
  } finally {
    for (const [nombre, valor] of necesarias) {
      if (valor === undefined) Deno.env.delete(nombre);
      else Deno.env.set(nombre, valor);
    }
    if (original !== undefined) Deno.env.set('TELEGRAM_BOT_USERNAME', original);
  }
});

// ---------------------------------------------------------------------------

Deno.test('el deep link llega hasta la base: /start <token> consulta el enlace', async () => {
  // La prueba del CABLEADO, no del dominio. Sin ella, `_core` podía estar
  // perfecto y el bot seguir sin vincular a nadie: era exactamente el bug.
  const { deps, usosDelRepo } = espia();

  const response = await pedir(
    deps,
    update({
      update_id: 1,
      message: {
        message_id: 9,
        from: { id: 500 },
        chat: { id: 500 },
        text: `/start ${'t'.repeat(32)}`,
      },
    }),
  );

  assertEquals(response.status, 200);
  // Se consultó el token, y NO se pidió identidad: el canje va antes.
  assertEquals(usosDelRepo.includes('findClientByToken:32'), true);
  assertEquals(
    usosDelRepo.some((uso) => uso.startsWith('findIdentity')),
    false,
  );
});

Deno.test('un mensaje normal sigue resolviendo identidad', async () => {
  const { deps, usosDelRepo } = espia();

  await pedir(
    deps,
    update({
      update_id: 2,
      message: { message_id: 9, from: { id: 500 }, chat: { id: 500 }, text: '/clientes' },
    }),
  );

  assertEquals(usosDelRepo.includes('findIdentity:500'), true);
});

// ─── SPEC-012 · ninguna petición se muere en silencio ───────────────────────

/** Como `pedir`, pero devolviendo las líneas del log ya parseadas. */
async function pedirCapturando(
  deps: HandlerDeps,
  request: Request,
): Promise<{ response: Response; logs: Record<string, unknown>[] }> {
  const original = console.log;
  const lineas: string[] = [];
  console.log = (linea: string) => {
    lineas.push(linea);
  };

  try {
    const response = await createHandler(deps)(request);
    return { response, logs: lineas.map((l) => JSON.parse(l) as Record<string, unknown>) };
  } finally {
    console.log = original;
  }
}

Deno.test('CA-4 · una excepción FUERA del dominio deja línea de error', async () => {
  // El dominio captura lo suyo y devuelve `failed`. Esto es lo de fuera:
  // construir un repo, construir el sender. Antes salía por arriba sin una
  // sola línea, y quien depuraba no tenía ni el requestId.
  const { deps } = espia();
  const rotas: HandlerDeps = {
    ...deps,
    sender: () => {
      throw new Error('el bot no arrancó');
    },
  };

  const { response, logs } = await pedirCapturando(
    rotas,
    update({ update_id: 1, message: { chat: { id: 5 }, from: { id: 5 }, text: 'hola' } }),
  );

  const cierre = logs.find((l) => l['event'] === 'telegram.excepcion');
  assertEquals(cierre?.['level'], 'error');
  assertEquals(cierre?.['message'], 'el bot no arrancó');
  assertEquals(typeof cierre?.['requestId'], 'string');
  assertEquals(typeof cierre?.['durationMs'], 'number');

  // 200 a propósito: un 500 haría que Telegram reintentara en bucle un
  // update que va a volver a romperse igual.
  assertEquals(response.status, 200);
});

Deno.test('la línea de la excepción no lleva el stack', async () => {
  const { deps } = espia();
  const rotas: HandlerDeps = {
    ...deps,
    sender: () => {
      throw new Error('reventó');
    },
  };

  const { logs } = await pedirCapturando(
    rotas,
    update({ update_id: 2, message: { chat: { id: 5 }, from: { id: 5 }, text: 'hola' } }),
  );

  const cierre = logs.find((l) => l['event'] === 'telegram.excepcion');
  assertEquals(cierre?.['stack'], undefined);
  assertEquals(JSON.stringify(cierre).includes('index.test.ts'), false);
});
