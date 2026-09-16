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

  return {
    deps: { expectedSecret: SECRETO, repo: () => repo, sender: () => sender },
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
