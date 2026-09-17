/**
 * SPEC-011 — el cableado de la función de generación.
 *
 * `_core` ya prueba la orquestación. Lo que falta comprobar es lo que solo se
 * ve desde fuera: que un cuerpo sin `versionId` no llegue a la IA, que
 * `not_found` sea lo único que se trata como error del llamante, y que un
 * secreto que falta reviente al arrancar.
 */
import { assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import type { GenerateDeps } from '../_core/ai/generate-version.ts';
import type { GenerationRepo, VersionForGeneration } from '../_core/ports/generation-ports.ts';
import { createHandler, readDeps, type HandlerDeps } from './index.ts';

const VERSION: VersionForGeneration = {
  versionId: 'v1',
  state: 'NEW',
  request: {
    goal: 'Fuerza',
    level: 'intermediate',
    daysPerWeek: 1,
    sessionMinutes: 60,
    equipment: 'Barra',
    limitations: null,
    instruction: null,
  },
  constraints: { daysPerWeek: 1, hasLimitations: false },
  trainerChatId: 99,
};

const RUTINA = {
  summary: 'Fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press', sets: 4, reps: '8', restSeconds: 120, notes: null }],
    },
  ],
  warnings: [],
};

function espia(version: VersionForGeneration | null = VERSION): {
  deps: HandlerDeps;
  generaciones: number;
} {
  const contador = { generaciones: 0 };

  const repo: GenerationRepo = {
    findVersion: () => Promise.resolve(version),
    recentGenerations: () => Promise.resolve([]),
    startGeneration: () => Promise.resolve(1),
    finishGeneration: () => Promise.resolve(),
    transition: () => Promise.resolve(true),
    saveContent: () => Promise.resolve(),
  };

  const build = (): GenerateDeps => ({
    repo,
    provider: {
      name: 'falso',
      model: 'falso',
      generate: () => {
        contador.generaciones += 1;
        return Promise.resolve({
          ok: true,
          draft: { source: 'ai', raw: RUTINA },
          usage: { tokensIn: 1, tokensOut: 2 },
        });
      },
    },
    sender: { sendMessage: () => Promise.resolve(), answerCallback: () => Promise.resolve() },
    rateLimit: { maxCalls: 5, windowMinutes: 60 },
    newTimeoutSignal: () => new AbortController().signal,
    now: () => new Date(),
  });

  return {
    deps: { build },
    get generaciones() {
      return contador.generaciones;
    },
  };
}

async function pedir(deps: HandlerDeps, body: string): Promise<Response> {
  const original = console.log;
  console.log = () => {};
  try {
    return await createHandler(deps)(
      new Request('https://ejemplo.test/', { method: 'POST', body }),
    );
  } finally {
    console.log = original;
  }
}

// ---------------------------------------------------------------------------

Deno.test('una petición válida devuelve 202', async () => {
  // 202 y no 200: el resultado se ve en el estado de la versión, no aquí.
  const espiado = espia();

  const response = await pedir(espiado.deps, JSON.stringify({ versionId: 'v1' }));

  assertEquals(response.status, 202);
  assertEquals(await response.text(), 'generated');
});

Deno.test('una versión que no existe devuelve 404', async () => {
  const espiado = espia(null);

  const response = await pedir(espiado.deps, JSON.stringify({ versionId: 'v1' }));

  assertEquals(response.status, 404);
});

Deno.test('una versión fuera de NEW devuelve 202, no error', async () => {
  // CA-6: reinvocar es idempotencia, no un fallo. Devolver 4xx haría que
  // quien llama reintentara para siempre.
  const espiado = espia({ ...VERSION, state: 'DRAFT' });

  const response = await pedir(espiado.deps, JSON.stringify({ versionId: 'v1' }));

  assertEquals(response.status, 202);
  assertEquals(espiado.generaciones, 0);
});

Deno.test('sin versionId NO se llama a la IA', async () => {
  for (const cuerpo of ['{}', '{"versionId":""}', '{"versionId":123}', 'no soy json', '']) {
    const espiado = espia();

    const response = await pedir(espiado.deps, cuerpo);

    assertEquals(response.status, 400, `con ${cuerpo}`);
    assertEquals(espiado.generaciones, 0, `con ${cuerpo}`);
  }
});

Deno.test('readDeps lanza nombrando la variable que falta', () => {
  const nombres = ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'SUPABASE_URL'];
  const previos = nombres.map((n) => [n, Deno.env.get(n)] as const);
  for (const [n] of previos) Deno.env.delete(n);

  try {
    const error = assertThrows(() => readDeps()) as Error;
    assertStringIncludes(error.message, 'GEMINI_API_KEY');
  } finally {
    for (const [n, v] of previos) if (v !== undefined) Deno.env.set(n, v);
  }
});
