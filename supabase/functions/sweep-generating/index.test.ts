/**
 * SPEC-002 §11 — la Edge Function del barrido de GENERATING atascadas.
 *
 * Lo que protege este archivo es que la función **no se pueda disparar desde
 * internet**: está expuesta, y sin el secreto cualquiera podría forzar de
 * vuelta a NEW una generación que sí sigue trabajando.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import type { StaleGeneration, SweepRepo } from '../_core/ports/sweep-ports.ts';
import { createHandler, readDeps, type HandlerDeps } from './index.ts';

const SECRETO = 'un-secreto-de-cron-largo-y-aleatorio';
const HEADER = 'x-sweep-cron-secret';

const CANDIDATA: StaleGeneration = {
  versionId: 'v1',
  trainerChatId: 900,
  clientName: 'Carlos',
  minutesStuck: 12,
};

function espia(
  opciones: { candidatas?: readonly StaleGeneration[]; revienta?: boolean } = {},
) {
  const enviados: number[] = [];

  const repo: SweepRepo = {
    staleGenerations: () => {
      if (opciones.revienta === true) return Promise.reject(new Error('la base no responde'));
      return Promise.resolve(opciones.candidatas ?? [CANDIDATA]);
    },
    transition: () => Promise.resolve(true),
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
      minMinutes: 5,
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
  assertEquals(await response.json(), { checked: 1, recovered: 1 });
  assertEquals(enviados, [900]);
});

Deno.test('sin candidatas responde 200 con ceros', async () => {
  const { deps } = espia({ candidatas: [] });

  const response = await pedir(deps, SECRETO);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { checked: 0, recovered: 0 });
});

Deno.test('un fallo de la base devuelve 500, no 200', async () => {
  // Al revés que en los webhooks: aquí quien llama es el cron, que no
  // reintenta en bucle, así que un fallo tiene que verse.
  const { deps } = espia({ revienta: true });

  assertEquals((await pedir(deps, SECRETO)).status, 500);
});

Deno.test('readDeps lanza nombrando la variable que falta', () => {
  const original = Deno.env.get('SWEEP_CRON_SECRET');
  Deno.env.delete('SWEEP_CRON_SECRET');
  // El token del bot se lee antes: sin él, el error nombraría esa otra.
  Deno.env.set('TELEGRAM_BOT_TOKEN', 'no-importa');

  try {
    let mensaje = '';
    try {
      readDeps();
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    assertEquals(mensaje.includes('SWEEP_CRON_SECRET'), true);
  } finally {
    Deno.env.delete('TELEGRAM_BOT_TOKEN');
    if (original !== undefined) Deno.env.set('SWEEP_CRON_SECRET', original);
  }
});
