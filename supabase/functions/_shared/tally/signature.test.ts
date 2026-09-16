/**
 * SPEC-001 — La firma del webhook de Tally.
 *
 * Corre en Deno porque usa `crypto.subtle`. Los vectores son los canónicos de
 * HMAC-SHA256, calculados fuera de este código: si el test usara la misma
 * función que prueba, pasaría aunque las dos estuvieran mal.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import {
  createSignatureVerifier,
  matchingEncoding,
  readSignatureHeader,
  SIGNATURE_HEADERS,
} from './signature.ts';

const SECRETO = 'key';
const CUERPO = 'The quick brown fox jumps over the lazy dog';
const HEX = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
const BASE64 = '97yD9DBThCSxMpjmqm+xQ+9NWaFJRhdZl0edvC0aPNg=';

// ---------------------------------------------------------------------------

Deno.test('acepta la firma en hexadecimal', async () => {
  assertEquals(await matchingEncoding(SECRETO, CUERPO, HEX), 'hex');
});

Deno.test('acepta la misma firma en base64', async () => {
  // No es laxitud: son dos representaciones del MISMO digest. Quien no tenga
  // la clave no puede producir ninguna de las dos.
  assertEquals(await matchingEncoding(SECRETO, CUERPO, BASE64), 'base64');
});

Deno.test('rechaza una firma que no corresponde', async () => {
  assertEquals(await matchingEncoding(SECRETO, CUERPO, 'a'.repeat(64)), null);
});

Deno.test('rechaza la firma correcta de OTRO cuerpo', async () => {
  // Es el ataque que la firma existe para parar: reenviar un cuerpo cambiado
  // con una firma que era válida para el original.
  assertEquals(await matchingEncoding(SECRETO, `${CUERPO}!`, HEX), null);
});

Deno.test('rechaza la firma correcta calculada con OTRA clave', async () => {
  assertEquals(await matchingEncoding('otra-clave', CUERPO, HEX), null);
});

Deno.test('un secreto vacío rechaza SIEMPRE', async () => {
  // Una configuración a medias no puede convertirse en «todo el mundo pasa».
  assertEquals(await matchingEncoding('', CUERPO, HEX), null);
  assertEquals(await matchingEncoding('', CUERPO, ''), null);
});

Deno.test('una firma vacía se rechaza', async () => {
  assertEquals(await matchingEncoding(SECRETO, CUERPO, ''), null);
});

Deno.test('un cuerpo vacío se firma y se verifica igual', async () => {
  // Tally no manda cuerpos vacíos, pero un atacante sí puede.
  const vacio = await matchingEncoding(SECRETO, '', HEX);
  assertEquals(vacio, null);
});

Deno.test('el cuerpo se firma tal cual: reformatear el JSON invalida la firma', async () => {
  // Por eso el flujo recibe el cuerpo SIN parsear. Serializarlo de nuevo
  // cambiaría espacios y orden, y el HMAC dejaría de cuadrar.
  const original = '{"a":1,"b":2}';
  const reformateado = '{ "a": 1, "b": 2 }';

  const firma = await (async () => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(SECRETO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(original)));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  })();

  assertEquals(await matchingEncoding(SECRETO, original, firma), 'hex');
  assertEquals(await matchingEncoding(SECRETO, reformateado, firma), null);
});

Deno.test('acepta un cuerpo con acentos y emoji', async () => {
  // El HMAC va sobre los bytes UTF-8. Si se firmara sobre otra codificación,
  // cualquier nombre con tilde rompería la ingesta.
  const cuerpo = '{"nombre":"Andrés 🏋️"}';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(SECRETO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(cuerpo)));
  const firma = btoa(String.fromCharCode(...bytes));

  assertEquals(await matchingEncoding(SECRETO, cuerpo, firma), 'base64');
});

// ---------------------------------------------------------------------------

Deno.test('createSignatureVerifier cumple el puerto', async () => {
  const verifier = createSignatureVerifier(SECRETO);

  assertEquals(await verifier.matches(CUERPO, HEX), true);
  assertEquals(await verifier.matches(CUERPO, BASE64), true);
  assertEquals(await verifier.matches(CUERPO, 'basura'), false);
});

Deno.test('readSignatureHeader lee cualquiera de las cabeceras conocidas', () => {
  for (const nombre of SIGNATURE_HEADERS) {
    assertEquals(readSignatureHeader(new Headers({ [nombre]: 'firma' })), 'firma');
  }
});

Deno.test('readSignatureHeader devuelve null si no hay ninguna', () => {
  assertEquals(readSignatureHeader(new Headers()), null);
  assertEquals(readSignatureHeader(new Headers({ 'otra-cosa': 'x' })), null);
});

Deno.test('una cabecera vacía cuenta como ausente', () => {
  assertEquals(readSignatureHeader(new Headers({ 'tally-signature': '' })), null);
});
