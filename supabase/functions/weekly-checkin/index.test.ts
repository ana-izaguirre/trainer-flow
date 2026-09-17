/**
 * SPEC-006 — la Edge Function del check-in semanal.
 *
 * Lo que protege este archivo es que la función **no se pueda disparar desde
 * internet**: está expuesta, y sin el secreto cualquiera podría llenar de
 * check-ins el Telegram de todos los clientes.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import type { CheckinCandidate, CheckinRepo } from '../_core/ports/checkin-ports.ts';
import { createHandler, readDeps, type HandlerDeps } from './index.ts';

const SECRETO = 'un-secreto-de-cron-largo-y-aleatorio';
const HEADER = 'x-checkin-cron-secret';

const CANDIDATO: CheckinCandidate = {
  clientId: 'c1',
  clientName: 'Carlos',
  clientChatId: 500,
  versionId: 'v1',
  state: 'SENT',
  // Hace mucho: toca check-in seguro.
  sentAt: new Date(Date.now() - 20 * 86_400_000),
  lastWeekSent: 0,
};

function espia(opciones: { candidatos?: readonly CheckinCandidate[]; revienta?: boolean } = {}) {
  const enviados: number[] = [];

  const repo: CheckinRepo = {
    candidates: () => {
      if (opciones.revienta === true) return Promise.reject(new Error('la base no responde'));
      return Promise.resolve(opciones.candidatos ?? [CANDIDATO]);
    },
    createCheckin: () => Promise.resolve('chk-1'),
    markSent: () => Promise.resolve(),
    pendingReminders: () => Promise.resolve([]),
    markReminded: () => Promise.resolve(),
    findCheckin: () => Promise.resolve(null),
    findOpenCheckin: () => Promise.resolve(null),
    saveAnswers: () => Promise.resolve(),
  };

  const deps: HandlerDeps = {
    expectedSecret: SECRETO,
    build: () => ({
      repo,
      sender: {
        sendMessage: (chatId) => {
          enviados.push(chatId);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    }),
  };

  return { deps, enviados };
}

/** Silencia los logs: aquí se prueba la respuesta, no la salida. */
async function pedir(deps: HandlerDeps, secreto: string | null): Promise<Response> {
  const original = console.log;
  console.log = () => {};
  try {
    return await createHandler(deps)(
      new Request('https://ejemplo.test/', {
        method: 'POST',
        headers: secreto === null ? {} : { [HEADER]: secreto },
      }),
    );
  } finally {
    console.log = original;
  }
}

// ---------------------------------------------------------------------------

Deno.test('sin el secreto del cron responde 401 y NO manda nada', async () => {
  const { deps, enviados } = espia();

  assertEquals((await pedir(deps, null)).status, 401);
  assertEquals(enviados, []);
});

Deno.test('con un secreto equivocado tampoco', async () => {
  const { deps, enviados } = espia();

  assertEquals((await pedir(deps, 'otro-secreto-igual-de-largo')).status, 401);
  assertEquals(enviados, []);
});

Deno.test('con el secreto correcto, la pasada corre', async () => {
  const { deps, enviados } = espia();

  const response = await pedir(deps, SECRETO);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent: 1, reminded: 0, skipped: 0, failed: 0 });
  assertEquals(enviados, [500]);
});

Deno.test('sin candidatos responde 200 con ceros', async () => {
  const { deps } = espia({ candidatos: [] });

  const response = await pedir(deps, SECRETO);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent: 0, reminded: 0, skipped: 0, failed: 0 });
});

Deno.test('un fallo de la base devuelve 500, no 200', async () => {
  // Al revés que en los webhooks: aquí quien llama es el cron, que no
  // reintenta en bucle, así que un fallo tiene que verse.
  const { deps } = espia({ revienta: true });

  assertEquals((await pedir(deps, SECRETO)).status, 500);
});

Deno.test('readDeps lanza nombrando la variable que falta', () => {
  // Un secreto mal escrito no puede dejar desplegar la función y fallar en la
  // primera ejecución real, que sería una semana después.
  const original = Deno.env.get('CHECKIN_CRON_SECRET');
  Deno.env.delete('CHECKIN_CRON_SECRET');
  // El token del bot se lee antes: sin él, el error nombraría esa otra.
  Deno.env.set('TELEGRAM_BOT_TOKEN', 'no-importa');

  try {
    let mensaje = '';
    try {
      readDeps();
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    assertEquals(mensaje.includes('CHECKIN_CRON_SECRET'), true);
  } finally {
    Deno.env.delete('TELEGRAM_BOT_TOKEN');
    if (original !== undefined) Deno.env.set('CHECKIN_CRON_SECRET', original);
  }
});
