/**
 * SPEC-002 — El disparo de `generate-version`.
 *
 * ┌─ LO QUE PROTEGE ESTE ARCHIVO ──────────────────────────────────────────┐
 * │ Que `trigger` resuelva SIN esperar a la generación. Si esperara,       │
 * │ Telegram reintentaría el update y saldrían dos generaciones por cada   │
 * │ pulsación del botón.                                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { assertEquals } from 'jsr:@std/assert@1';
import { createGenerationTrigger } from './generation-trigger.ts';
import type { Logger } from './logger.ts';

const BASE = 'https://proyecto.supabase.co';
const CLAVE = 'la-clave-de-servicio';

function entorno(): void {
  Deno.env.set('SUPABASE_URL', BASE);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', CLAVE);
}

interface Registro {
  readonly event: string;
  readonly fields: Record<string, unknown>;
}

function fakeLog(registros: Registro[]): Logger {
  const anotar = (event: string, fields: Record<string, unknown> = {}) =>
    registros.push({ event, fields });

  return {
    requestId: 'req-1',
    debug: anotar,
    info: anotar,
    warn: anotar,
    error: anotar,
  };
}

/** Sustituye `fetch` y devuelve lo que se le pidió. */
function interceptarFetch(respuesta: () => Promise<Response>) {
  const original = globalThis.fetch;
  const llamadas: { url: string; init: RequestInit }[] = [];

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta();
  }) as typeof fetch;

  return { llamadas, restaurar: () => { globalThis.fetch = original; } };
}

// ---------------------------------------------------------------------------

Deno.test('llama a generate-version con el versionId y el requestId', async () => {
  entorno();
  const fake = interceptarFetch(() => Promise.resolve(new Response('ok', { status: 200 })));

  try {
    await createGenerationTrigger(fakeLog([])).trigger('v-1', 'req-9');
    // Un tick para que la promesa de `fetch` se haya encolado.
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(fake.llamadas.length, 1);
    assertEquals(fake.llamadas[0]!.url, `${BASE}/functions/v1/generate-version`);
    assertEquals(fake.llamadas[0]!.init.method, 'POST');
    assertEquals(
      JSON.parse(String(fake.llamadas[0]!.init.body)),
      { versionId: 'v-1', requestId: 'req-9' },
    );
  } finally {
    fake.restaurar();
  }
});

Deno.test('la clave de servicio va en la cabecera, NUNCA en la URL', async () => {
  // Las URLs acaban en los logs de acceso; esta es una credencial.
  entorno();
  const fake = interceptarFetch(() => Promise.resolve(new Response('ok')));

  try {
    await createGenerationTrigger(fakeLog([])).trigger('v-1', 'req-1');
    await new Promise((r) => setTimeout(r, 0));

    const { url, init } = fake.llamadas[0]!;
    assertEquals(url.includes(CLAVE), false);
    assertEquals((init.headers as Record<string, string>)['Authorization'], `Bearer ${CLAVE}`);
  } finally {
    fake.restaurar();
  }
});

Deno.test('🔴 resuelve SIN esperar a que termine la generación', async () => {
  // Si esperara, Telegram reintentaría el update y saldrían dos generaciones.
  entorno();
  // Un `fetch` que nunca termina: así se ve si `trigger` lo esperaba.
  const pendiente = Promise.withResolvers<Response>();
  const colgada = pendiente.promise;
  const fake = interceptarFetch(() => colgada);

  try {
    let resuelto = false;
    await createGenerationTrigger(fakeLog([])).trigger('v-1', 'req-1').then(() => {
      resuelto = true;
    });

    // El `fetch` sigue colgado y `trigger` ya volvió.
    assertEquals(resuelto, true);
    assertEquals(fake.llamadas.length, 1);
  } finally {
    pendiente.resolve(new Response('ok'));
    fake.restaurar();
  }
});

Deno.test('un fallo de red NO revienta: se registra y se sigue', async () => {
  // La versión se queda en NEW y el entrenador puede reintentar.
  entorno();
  const registros: Registro[] = [];
  const fake = interceptarFetch(() => Promise.reject(new Error('sin red')));

  try {
    await createGenerationTrigger(fakeLog(registros)).trigger('v-1', 'req-1');
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(registros.length, 1);
    assertEquals(registros[0]!.event, 'generation.trigger_failed');
  } finally {
    fake.restaurar();
  }
});

Deno.test('una respuesta 500 también se registra', async () => {
  entorno();
  const registros: Registro[] = [];
  const fake = interceptarFetch(() => Promise.resolve(new Response('no', { status: 500 })));

  try {
    await createGenerationTrigger(fakeLog(registros)).trigger('v-1', 'req-1');
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(registros[0]!.event, 'generation.trigger_rejected');
    assertEquals(registros[0]!.fields['status'], 500);
  } finally {
    fake.restaurar();
  }
});

Deno.test('sin SUPABASE_URL revienta al construir, no al primer botón', () => {
  // Un secreto mal escrito no puede dejar desplegar la función y fallar
  // cuando el entrenador pulse.
  const original = Deno.env.get('SUPABASE_URL');
  Deno.env.delete('SUPABASE_URL');

  try {
    let mensaje = '';
    try {
      createGenerationTrigger(fakeLog([]));
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    assertEquals(mensaje.includes('SUPABASE_URL'), true);
  } finally {
    if (original !== undefined) Deno.env.set('SUPABASE_URL', original);
  }
});
