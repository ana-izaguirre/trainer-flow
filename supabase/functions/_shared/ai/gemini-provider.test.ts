/**
 * SPEC-002 — El proveedor de IA, sin tocar la red.
 *
 * Lo que más importa aquí no es que funcione el camino feliz, sino que cada
 * forma de fallar se traduzca al motivo correcto: de eso depende si el
 * sistema reintenta, degrada o avisa.
 */
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { createLogger } from '../logger.ts';
import { createProvider } from './gemini-provider.ts';

const API_KEY = 'clave-de-prueba-nunca-real';

const PETICION = {
  goal: 'Fuerza',
  level: 'intermediate',
  daysPerWeek: 3,
  sessionMinutes: 45,
  equipment: 'Barra',
  limitations: 'Molestia en el hombro derecho',
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
  familyConditions: null,
  equipmentDetail: null,
  lifestyle: null,
  notes: null,
} as const;

interface Llamada {
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

/** Sustituye `fetch` y captura lo que se le pidió. Siempre lo restaura. */
async function conFetch(
  responder: () => Response | never,
  accion: (
    provider: ReturnType<typeof createProvider>,
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
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ''),
    });
    return Promise.resolve(responder());
  }) as typeof fetch;
  console.log = (linea: string) => void logs.push(linea);

  try {
    const provider = createProvider({
      apiKey: API_KEY,
      model: 'un-modelo',
      log: createLogger('req-1'),
    });
    await accion(provider, llamadas, logs);
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
  }
}

const respuestaCon = (texto: string, usage?: Record<string, number>) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: texto }] } }],
      ...(usage ? { usageMetadata: usage } : {}),
    }),
    { status: 200 },
  );

const RUTINA = JSON.stringify({ summary: 'x', days: [], warnings: [] });

// ---------------------------------------------------------------------------

Deno.test('devuelve el draft con `raw` sin interpretar', async () => {
  await conFetch(
    () => respuestaCon(RUTINA),
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);

      assertEquals(r.ok, true);
      if (!r.ok) return;
      assertEquals(r.draft.source, 'ai');
      // `raw` es unknown a propósito: que el JSON parseara no dice nada de su
      // contenido. Quien lo aprueba es `validateDraft`.
      assertEquals(r.draft.raw, { summary: 'x', days: [], warnings: [] });
    },
  );
});

Deno.test('LA CLAVE VA EN CABECERA, NUNCA EN LA URL', async () => {
  // Una URL acaba en logs de error, trazas y mensajes de excepción.
  await conFetch(
    () => respuestaCon(RUTINA),
    async (provider, llamadas) => {
      await provider.generate(PETICION, new AbortController().signal);

      assertEquals(llamadas[0]!.url.includes(API_KEY), false);
      assertEquals(llamadas[0]!.url.includes('key='), false);
      assertEquals(llamadas[0]!.headers.get('x-goog-api-key'), API_KEY);
    },
  );
});

Deno.test('EL PROMPT NO SALE EN NINGÚN LOG', async () => {
  // Lleva las limitaciones del cliente, que son datos de salud.
  await conFetch(
    () => respuestaCon(RUTINA, { promptTokenCount: 10, candidatesTokenCount: 20 }),
    async (provider, llamadas, logs) => {
      await provider.generate(PETICION, new AbortController().signal);

      // Está en la petición…
      assertStringIncludes(llamadas[0]!.body, 'hombro derecho');
      // …y en ninguna línea de log.
      for (const linea of logs) assertEquals(linea.includes('hombro'), false);
      for (const linea of logs) assertEquals(linea.includes(API_KEY), false);
    },
  );
});

Deno.test('los tokens se reportan cuando vienen', async () => {
  await conFetch(
    () => respuestaCon(RUTINA, { promptTokenCount: 120, candidatesTokenCount: 340 }),
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);
      if (!r.ok) throw new Error('debería haber salido bien');
      assertEquals(r.usage, { tokensIn: 120, tokensOut: 340 });
    },
  );
});

Deno.test('sin contadores de tokens no se rompe: son telemetría', async () => {
  await conFetch(
    () => respuestaCon(RUTINA),
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);
      if (!r.ok) throw new Error('debería haber salido bien');
      assertEquals(r.usage, { tokensIn: 0, tokensOut: 0 });
    },
  );
});

// ── Cada fallo a su motivo ────────────────────────────────────────────────

Deno.test('429 → RATE_LIMITED, que es el único que NO se reintenta', async () => {
  await conFetch(
    () => new Response('{}', { status: 429 }),
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);
      assertEquals(r.ok, false);
      if (r.ok) return;
      assertEquals(r.reason, 'RATE_LIMITED');
    },
  );
});

Deno.test('500 → API_ERROR', async () => {
  await conFetch(
    () => new Response('{}', { status: 500 }),
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);
      if (r.ok) throw new Error('debería haber fallado');
      assertEquals(r.reason, 'API_ERROR');
    },
  );
});

Deno.test('un abort → TIMEOUT, no API_ERROR', async () => {
  // Distinguirlos importa: un timeout se reintenta una vez, un error de la
  // API no necesariamente.
  const controller = new AbortController();
  controller.abort();

  await conFetch(
    () => {
      throw new DOMException('aborted', 'AbortError');
    },
    async (provider) => {
      const r = await provider.generate(PETICION, controller.signal);
      if (r.ok) throw new Error('debería haber fallado');
      assertEquals(r.reason, 'TIMEOUT');
    },
  );
});

Deno.test('un fallo de red sin abort → API_ERROR', async () => {
  await conFetch(
    () => {
      throw new TypeError('network error');
    },
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);
      if (r.ok) throw new Error('debería haber fallado');
      assertEquals(r.reason, 'API_ERROR');
    },
  );
});

Deno.test('el modelo devuelve algo que no es JSON → INVALID_OUTPUT', async () => {
  await conFetch(
    () => respuestaCon('Aquí tienes tu rutina: haz sentadillas'),
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);
      if (r.ok) throw new Error('debería haber fallado');
      assertEquals(r.reason, 'INVALID_OUTPUT');
    },
  );
});

Deno.test('una respuesta con forma inesperada → INVALID_OUTPUT', async () => {
  for (const cuerpo of ['{}', '{"candidates":[]}', '{"candidates":[{}]}', '[]', 'null']) {
    await conFetch(
      () => new Response(cuerpo, { status: 200 }),
      async (provider) => {
        const r = await provider.generate(PETICION, new AbortController().signal);
        if (r.ok) throw new Error(`debería haber fallado con ${cuerpo}`);
        assertEquals(r.reason, 'INVALID_OUTPUT');
      },
    );
  }
});

Deno.test('un cuerpo que no es JSON → INVALID_OUTPUT', async () => {
  await conFetch(
    () => new Response('<html>502</html>', { status: 200 }),
    async (provider) => {
      const r = await provider.generate(PETICION, new AbortController().signal);
      if (r.ok) throw new Error('debería haber fallado');
      assertEquals(r.reason, 'INVALID_OUTPUT');
    },
  );
});

Deno.test('el proveedor se identifica para ai_generations', async () => {
  await conFetch(
    () => respuestaCon(RUTINA),
    (provider) => {
      assertEquals(provider.name, 'google');
      assertEquals(provider.model, 'un-modelo');
      return Promise.resolve();
    },
  );
});
