/**
 * Verificación de la firma del webhook de Tally.
 *
 * Vive en `_shared` porque calcular un HMAC necesita `crypto.subtle`, y el
 * ADR-001 mantiene `_core` sin APIs de plataforma. Lo que `_core` decide es
 * **cuándo** se llama a esto: antes de absolutamente todo lo demás.
 *
 * ┌─ UN DESCONOCIDO, MANEJADO ─────────────────────────────────────────────┐
 * │ No hemos podido confirmar en qué codificación manda Tally la firma:    │
 * │ hexadecimal y base64 son ambas comunes, y su documentación no era      │
 * │ alcanzable al escribir esto.                                          │
 * │                                                                        │
 * │ En vez de suponerlo, se aceptan las dos. **No debilita nada**: las dos │
 * │ son representaciones del MISMO digest, y quien no tenga la clave no    │
 * │ puede producir ninguna de ellas.                                      │
 * │                                                                        │
 * │ La primera entrega real dirá cuál es: `matches` devuelve qué           │
 * │ codificación cuadró, y el handler lo escribe en el log. Con ese dato   │
 * │ se puede estrechar a una sola.                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { constantTimeEquals } from '../../_core/security/constant-time.ts';
import type { SignatureVerifier } from '../../_core/ports/tally-ports.ts';

/** Cabeceras donde puede venir la firma, en orden de preferencia. */
export const SIGNATURE_HEADERS = ['tally-signature', 'x-tally-signature'] as const;

export type Encoding = 'hex' | 'base64';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function hmac(secret: string, body: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
}

/**
 * Calcula el digest y dice con qué codificación cuadra la firma recibida.
 *
 * `null` si no cuadra con ninguna. Se exporta aparte de `SignatureVerifier`
 * para poder loguear cuál fue, que es lo que despeja el desconocido de arriba.
 */
export async function matchingEncoding(
  secret: string,
  body: string,
  signature: string,
): Promise<Encoding | null> {
  // Un secreto vacío no puede validar nada: una configuración a medias no se
  // convierte en «todo el mundo pasa».
  if (secret.length === 0) return null;

  const digest = await hmac(secret, body);

  // Las dos comparaciones corren SIEMPRE, sin cortar en la primera: si se
  // saliera antes, el tiempo revelaría cuál de las dos acertó.
  const esHex = constantTimeEquals(signature, toHex(digest));
  const esBase64 = constantTimeEquals(signature, toBase64(digest));

  if (esHex) return 'hex';
  if (esBase64) return 'base64';
  return null;
}

export function createSignatureVerifier(secret: string): SignatureVerifier {
  return {
    matches: async (rawBody, signature) =>
      (await matchingEncoding(secret, rawBody, signature)) !== null,
  };
}

/** Lee la firma de la primera cabecera que la traiga. */
export function readSignatureHeader(headers: Headers): string | null {
  for (const nombre of SIGNATURE_HEADERS) {
    const valor = headers.get(nombre);
    if (valor !== null && valor.length > 0) return valor;
  }
  return null;
}
