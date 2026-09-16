/**
 * SPEC-011 — el cableado del webhook de Tally.
 *
 * Lo que prueba y `_core` no puede: que el cuerpo se lea SIN parsear, que la
 * cabecera de la firma sea una de las que manda Tally, y que un secreto que
 * falta reviente al arrancar y no con el primer envío real.
 */
import { assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import type { SignatureVerifier, TallyRepo } from '../_core/ports/tally-ports.ts';
import { createHandler, readDeps, type HandlerDeps } from './index.ts';

const CUERPO = JSON.stringify({
  eventId: 'evt-1',
  eventType: 'FORM_RESPONSE',
  data: { responseId: 'r1', formId: 'f1', fields: [] },
});

interface Espia {
  readonly deps: HandlerDeps;
  readonly firmados: string[];
  readonly reclamados: string[];
}

function espia(firmaValida = true): Espia {
  const firmados: string[] = [];
  const reclamados: string[] = [];

  const verifier: SignatureVerifier = {
    matches: (rawBody) => {
      firmados.push(rawBody);
      return Promise.resolve(firmaValida);
    },
  };

  const repo: TallyRepo = {
    claimEvent: (externalId) => {
      reclamados.push(externalId);
      return Promise.resolve(true);
    },
    markProcessed: () => Promise.resolve(),
  };

  return { deps: { verifier, repo: () => repo }, firmados, reclamados };
}

async function pedir(deps: HandlerDeps, request: Request): Promise<Response> {
  const original = console.log;
  console.log = () => {};
  try {
    return await createHandler(deps)(request);
  } finally {
    console.log = original;
  }
}

const envio = (body: string, headers: Record<string, string>) =>
  new Request('https://ejemplo.test/', { method: 'POST', headers, body });

// ---------------------------------------------------------------------------

Deno.test('un envío firmado se reclama', async () => {
  const { deps, reclamados } = espia();

  const response = await pedir(deps, envio(CUERPO, { 'tally-signature': 'firma' }));

  assertEquals(response.status, 200);
  assertEquals(reclamados, ['evt-1']);
});

Deno.test('la firma se calcula sobre el cuerpo SIN parsear', async () => {
  // Si el handler parseara y volviera a serializar, el HMAC no cuadraría.
  // Este test fija que lo que se firma son los bytes que llegaron.
  const conEspacios = '{ "eventId": "evt-1", "eventType": "FORM_RESPONSE", "data": {} }';
  const { deps, firmados } = espia(false);

  await pedir(deps, envio(conEspacios, { 'tally-signature': 'firma' }));

  assertEquals(firmados, [conEspacios]);
});

Deno.test('sin cabecera de firma responde 401 y no toca la base', async () => {
  const { deps, reclamados, firmados } = espia();

  const response = await pedir(deps, envio(CUERPO, {}));

  assertEquals(response.status, 401);
  assertEquals(reclamados, []);
  assertEquals(firmados, []);
});

Deno.test('acepta la cabecera con prefijo x-', async () => {
  const { deps, reclamados } = espia();

  const response = await pedir(deps, envio(CUERPO, { 'x-tally-signature': 'firma' }));

  assertEquals(response.status, 200);
  assertEquals(reclamados, ['evt-1']);
});

Deno.test('una firma inválida responde 401 sin tocar la base', async () => {
  const { deps, reclamados } = espia(false);

  const response = await pedir(deps, envio(CUERPO, { 'tally-signature': 'mala' }));

  assertEquals(response.status, 401);
  assertEquals(reclamados, []);
});

Deno.test('un cuerpo que no es JSON, ya firmado, responde 400', async () => {
  const { deps, reclamados } = espia();

  const response = await pedir(deps, envio('no soy json', { 'tally-signature': 'firma' }));

  assertEquals(response.status, 400);
  assertEquals(reclamados, []);
});

Deno.test('un cuerpo vacío no lanza', async () => {
  const { deps } = espia();
  const response = await pedir(deps, envio('', { 'tally-signature': 'firma' }));
  assertEquals(response.status, 400);
});

Deno.test('readDeps lanza nombrando la variable que falta', () => {
  const previos = ['TALLY_SIGNING_SECRET', 'SUPABASE_URL'].map(
    (nombre) => [nombre, Deno.env.get(nombre)] as const,
  );
  for (const [nombre] of previos) Deno.env.delete(nombre);

  try {
    const error = assertThrows(() => readDeps()) as Error;
    assertStringIncludes(error.message, 'TALLY_SIGNING_SECRET');
  } finally {
    for (const [nombre, valor] of previos) {
      if (valor !== undefined) Deno.env.set(nombre, valor);
    }
  }
});
