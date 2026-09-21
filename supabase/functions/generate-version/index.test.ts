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
  clientName: 'Carlos',
  versionNumber: 1,
  request: {
    goal: 'Fuerza',
    level: 'intermediate',
    daysPerWeek: 1,
    sessionMinutes: 60,
    equipment: 'Barra',
    limitations: null,
    instruction: null,
    gender: null,
    age: null,
    weightKg: null,
    heightCm: null,
    quitReasons: null,
    menopauseStage: null,
    lastWeighed: null,
    chronicConditions: null,
    medications: null,
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

function espia(
  version: VersionForGeneration | null = VERSION,
  alGenerar: (() => never) | null = null,
): {
  deps: HandlerDeps;
  generaciones: number;
  /** El que llega al repo, y por tanto a `ai_generations` y `plan_events`. */
  requestIdDelRepo: string | null;
} {
  const contador = { generaciones: 0, requestId: null as string | null };

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
        if (alGenerar !== null) alGenerar();
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
    deps: {
      build: (requestId) => {
        contador.requestId = requestId;
        return build();
      },
    },
    get generaciones() {
      return contador.generaciones;
    },
    get requestIdDelRepo() {
      return contador.requestId;
    },
  };
}

interface Capturado {
  readonly response: Response;
  /** Cada línea del log ya parseada: es JSON de una línea por contrato. */
  readonly logs: readonly Record<string, unknown>[];
}

async function pedirCapturando(deps: HandlerDeps, body: string): Promise<Capturado> {
  const original = console.log;
  const lineas: string[] = [];
  console.log = (linea: string) => {
    lineas.push(linea);
  };

  try {
    const response = await createHandler(deps)(
      new Request('https://ejemplo.test/', { method: 'POST', body }),
    );

    return { response, logs: lineas.map((l) => JSON.parse(l) as Record<string, unknown>) };
  } finally {
    console.log = original;
  }
}

async function pedir(deps: HandlerDeps, body: string): Promise<Response> {
  return (await pedirCapturando(deps, body)).response;
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

// ─── SPEC-012 · la traza de extremo a extremo ───────────────────────────────

const REQ_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

Deno.test('CA-1 · el requestId que llega es el que se usa, no uno nuevo', async () => {
  // ESTE es el test que faltaba. `telegram-webhook` ya mandaba su requestId
  // en el cuerpo; esta función lo tiraba y se inventaba otro, así que buscar
  // en los logs el id del botón no encontraba la generación que provocó.
  const espiado = espia();

  const { response, logs } = await pedirCapturando(
    espiado.deps,
    JSON.stringify({ versionId: 'v1', requestId: REQ_A }),
  );

  assertEquals(response.status, 202);

  // Todas las líneas, no solo la última.
  assertEquals(logs.length > 0, true);
  for (const linea of logs) assertEquals(linea['requestId'], REQ_A);

  // Y el que llega al repo, que es el que acaba en las tablas.
  assertEquals(espiado.requestIdDelRepo, REQ_A);
});

Deno.test('CA-2 · sin requestId se genera uno y todo sigue igual', async () => {
  const espiado = espia();

  const { response, logs } = await pedirCapturando(
    espiado.deps,
    JSON.stringify({ versionId: 'v1' }),
  );

  assertEquals(response.status, 202);
  assertEquals(typeof espiado.requestIdDelRepo, 'string');
  assertEquals(logs.every((l) => l['requestId'] === espiado.requestIdDelRepo), true);

  // Y no se avisa de nada: no traer uno es normal.
  assertEquals(logs.some((l) => l['event'] === 'generate.request_id_invalido'), false);
});

Deno.test('CA-3 · un requestId que no es UUID se descarta y se avisa', async () => {
  // Se descarta por la forma, no por desconfianza: acabaría en una columna
  // `uuid` y reventaría la escritura. Perder la traza es mejor que perder
  // la fila.
  for (const malo of ['req-42', '', 12345, { a: 1 }, `${REQ_A} or 1=1`]) {
    const espiado = espia();

    const { response, logs } = await pedirCapturando(
      espiado.deps,
      JSON.stringify({ versionId: 'v1', requestId: malo }),
    );

    const etiqueta = JSON.stringify(malo);
    assertEquals(response.status, 202, `con ${etiqueta}`);
    assertEquals(espiado.requestIdDelRepo !== malo, true, `con ${etiqueta}`);
    assertEquals(
      logs.some((l) => l['event'] === 'generate.request_id_invalido'),
      true,
      `con ${etiqueta}`,
    );
  }
});

Deno.test('CA-4 · una excepción deja línea de cierre con requestId y durationMs', async () => {
  // `_core/ai/generate-version.ts` no tiene un solo `catch`. Antes de esto,
  // un fallo de red o de la base salía por arriba sin una sola línea: la
  // función con más superficie de fallo era la que menos contaba.
  const espiado = espia(VERSION, () => {
    throw new Error('la base dijo que no');
  });

  const { response, logs } = await pedirCapturando(
    espiado.deps,
    JSON.stringify({ versionId: 'v1', requestId: REQ_A }),
  );

  assertEquals(response.status, 500);

  const cierre = logs.find((l) => l['event'] === 'generate.excepcion');
  assertEquals(cierre !== undefined, true);
  assertEquals(cierre?.['level'], 'error');
  assertEquals(cierre?.['requestId'], REQ_A);
  assertEquals(cierre?.['message'], 'la base dijo que no');
  assertEquals(typeof cierre?.['durationMs'], 'number');
});

Deno.test('CA-5 · la línea del error NO lleva el stack', async () => {
  // Un stack arrastra rutas y, según dónde reviente, valores de variables.
  const espiado = espia(VERSION, () => {
    throw new Error('reventó');
  });

  const { logs } = await pedirCapturando(
    espiado.deps,
    JSON.stringify({ versionId: 'v1', requestId: REQ_A }),
  );

  const cierre = logs.find((l) => l['event'] === 'generate.excepcion');
  assertEquals(cierre?.['stack'], undefined);
  assertEquals(JSON.stringify(cierre).includes('index.test.ts'), false);
});

Deno.test('lo que se lanza y no es un Error tampoco rompe el log', async () => {
  const espiado = espia(VERSION, () => {
    throw 'una cadena pelada';
  });

  const { response, logs } = await pedirCapturando(
    espiado.deps,
    JSON.stringify({ versionId: 'v1' }),
  );

  assertEquals(response.status, 500);
  assertEquals(
    logs.find((l) => l['event'] === 'generate.excepcion')?.['message'],
    'Error desconocido.',
  );
});
