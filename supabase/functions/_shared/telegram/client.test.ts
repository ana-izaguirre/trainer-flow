/**
 * SPEC-011 — el adaptador de Telegram: aquí viven el token y el `fetch`.
 *
 * Ningún test toca la red. Un test que llama a `api.telegram.org` es un test
 * que falla los lunes.
 */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { createLogger } from '../logger.ts';
import {
  asSender,
  createTelegramClient,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from './client.ts';

const TOKEN = 'token-de-prueba-nunca-real';

interface Llamada {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/** Sustituye `fetch` y captura lo que se le pidió. Siempre lo restaura. */
async function conFetch(
  responder: () => Response | Promise<Response> | never,
  accion: (
    cliente: ReturnType<typeof createTelegramClient>,
    llamadas: Llamada[],
    logs: string[],
  ) => Promise<void>,
): Promise<void> {
  const llamadas: Llamada[] = [];
  const logs: string[] = [];

  const fetchOriginal = globalThis.fetch;
  const logOriginal = console.log;

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return Promise.resolve(responder());
  }) as typeof fetch;
  console.log = (linea: string) => void logs.push(linea);

  try {
    await accion(createTelegramClient(TOKEN, createLogger('req-1')), llamadas, logs);
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
  }
}

const ok = (result: unknown) =>
  new Response(JSON.stringify({ ok: true, result }), { status: 200 });

Deno.test('sendMessage llama al método correcto y devuelve el message_id', async () => {
  await conFetch(
    () => ok({ message_id: 42 }),
    async (cliente, llamadas) => {
      assertEquals(await cliente.sendMessage(7, 'hola'), 42);
      assertEquals(llamadas.length, 1);
      assertStringIncludes(llamadas[0]!.url, '/sendMessage');
      assertEquals(llamadas[0]!.body['chat_id'], 7);
      assertEquals(llamadas[0]!.body['text'], 'hola');
    },
  );
});

Deno.test('trunca el texto al límite de Telegram', async () => {
  await conFetch(
    () => ok({ message_id: 1 }),
    async (cliente, llamadas) => {
      await cliente.sendMessage(7, 'x'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 500));
      assertEquals(String(llamadas[0]!.body['text']).length, TELEGRAM_MAX_MESSAGE_LENGTH);
    },
  );
});

Deno.test('un error de Telegram devuelve null, y EL TOKEN NO SALE EN EL LOG', async () => {
  // Es la razón principal de este archivo. Que el token no se loguee lo
  // garantizaba un comentario; ahora lo garantiza un test.
  await conFetch(
    () => new Response('{"ok":false}', { status: 500 }),
    async (cliente, _llamadas, logs) => {
      assertEquals(await cliente.sendMessage(7, 'hola'), null);
      assertEquals(logs.length > 0, true);
      assertEquals(
        logs.some((linea) => linea.includes(TOKEN)),
        false,
      );
    },
  );
});

Deno.test('un fallo de red devuelve null en vez de propagar la excepción', async () => {
  // Si esto lanzara, una caída de Telegram tumbaría el webhook entero y el
  // update se perdería.
  await conFetch(
    () => {
      throw new TypeError('network error');
    },
    async (cliente, _llamadas, logs) => {
      assertEquals(await cliente.sendMessage(7, 'hola'), null);
      assertEquals(
        logs.some((linea) => linea.includes(TOKEN)),
        false,
      );
    },
  );
});

Deno.test('una respuesta sin message_id usable devuelve null', async () => {
  for (const result of [undefined, null, 'texto', { message_id: 'no-es-numero' }]) {
    await conFetch(
      () => ok(result),
      async (cliente) => assertEquals(await cliente.sendMessage(7, 'hola'), null),
    );
  }
});

Deno.test('answerCallbackQuery manda el texto solo si lo hay', async () => {
  await conFetch(
    () => ok(true),
    async (cliente, llamadas) => {
      await cliente.answerCallbackQuery('cb-1');
      assertEquals('text' in llamadas[0]!.body, false);

      await cliente.answerCallbackQuery('cb-2', 'Listo');
      assertEquals(llamadas[1]!.body['text'], 'Listo');
    },
  );
});

Deno.test('asSender cumple el puerto sin exponer el message_id', async () => {
  await conFetch(
    () => ok({ message_id: 9 }),
    async (cliente, llamadas) => {
      const sender = asSender(cliente);
      assertEquals(await sender.sendMessage(7, 'hola'), undefined);
      await sender.answerCallback('cb-1');
      assertEquals(llamadas.length, 2);
    },
  );
});
