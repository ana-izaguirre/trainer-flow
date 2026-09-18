/**
 * SPEC-011 — el cableado del webhook de Tally.
 *
 * Lo que prueba y `_core` no puede: que el cuerpo se lea SIN parsear, que la
 * cabecera de la firma sea una de las que manda Tally, y que un secreto que
 * falta reviente al arrancar y no con el primer envío real.
 */
import { assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import type { SignatureVerifier, TallyRepo } from '../_core/ports/tally-ports.ts';
import type { TelegramSender } from '../_core/ports/telegram-ports.ts';
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
    findTrainer: () => Promise.resolve({ profileId: 'perfil-1', chatId: 99 }),
    ingestAssessment: () =>
      Promise.resolve({ clientId: 'c1', planId: 'p1', versionId: 'v1' }),
  };

  const sender: TelegramSender = {
    sendMessage: () => Promise.resolve(),
    answerCallback: () => Promise.resolve(),
  };

  return { deps: { verifier, botUsername: 'mibot', repo: () => repo, sender: () => sender }, firmados, reclamados };
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
  const previos = ['TALLY_SIGNING_SECRET', 'TELEGRAM_BOT_TOKEN', 'SUPABASE_URL'].map(
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

// ─── SPEC-012 · ninguna petición se muere en silencio ───────────────────────

Deno.test('CA-4 · una excepción FUERA del dominio deja línea de error y 500', async () => {
  const { deps } = espia();
  const rotas: HandlerDeps = {
    ...deps,
    repo: () => {
      throw new Error('no hay conexión');
    },
  };

  const original = console.log;
  const lineas: string[] = [];
  console.log = (linea: string) => {
    lineas.push(linea);
  };

  let response: Response;
  try {
    response = await createHandler(rotas)(envio(CUERPO, { 'tally-signature': 'firma' }));
  } finally {
    console.log = original;
  }

  const logs = lineas.map((l) => JSON.parse(l) as Record<string, unknown>);
  const cierre = logs.find((l) => l['event'] === 'tally.excepcion');

  assertEquals(cierre?.['level'], 'error');
  assertEquals(cierre?.['message'], 'no hay conexión');
  assertEquals(typeof cierre?.['requestId'], 'string');
  assertEquals(typeof cierre?.['durationMs'], 'number');

  // El stack no, que por aquí pasan respuestas de un formulario de salud.
  assertEquals(cierre?.['stack'], undefined);

  // 500, igual que `failed`: Tally reintenta un número acotado de veces y
  // una evaluación perdida deja a un cliente sin rutina.
  assertEquals(response.status, 500);
});

Deno.test('CA-5 · falta TELEGRAM_BOT_USERNAME → lanza al arrancar', () => {
  // SPEC-014 regla 2: sin esto saldría `t.me/undefined?start=...`, un enlace
  // roto que nadie nota hasta que un cliente lo abre y no pasa nada.
  const nombres = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_USERNAME',
    'TALLY_SIGNING_SECRET',
    'SUPABASE_URL',
  ];
  const previos = nombres.map((n) => [n, Deno.env.get(n)] as const);
  for (const [n] of previos) Deno.env.delete(n);

  // Se ponen todos MENOS el que se prueba, para que el error nombre ese.
  Deno.env.set('TELEGRAM_BOT_TOKEN', 'x');
  Deno.env.set('TALLY_SIGNING_SECRET', 'x');
  Deno.env.set('SUPABASE_URL', 'https://ejemplo.test');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x');

  try {
    const error = assertThrows(() => readDeps()) as Error;
    assertStringIncludes(error.message, 'TELEGRAM_BOT_USERNAME');
  } finally {
    for (const [n, v] of previos) {
      if (v === undefined) Deno.env.delete(n);
      else Deno.env.set(n, v);
    }
  }
});
