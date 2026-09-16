/**
 * Genera el `link_token` del deep link.
 *
 * Vive en `_shared` porque `crypto.getRandomValues` es una API de plataforma
 * y el ADR-001 mantiene `_core` sin ellas. `_core` decide **cuándo** se
 * genera uno; esto decide **cómo**.
 *
 * SPEC-001 regla 6: 32 bytes de CSPRNG en base64url. Son 43 caracteres, bien
 * por debajo del límite de 64 del `/start` de Telegram.
 *
 * base64url y no base64 a secas: el token viaja dentro de una URL
 * (`t.me/bot?start=...`), y `+` y `/` no sobreviven ahí.
 *
 * **Es una credencial.** Quien la tenga se vincula como ese cliente. Nunca en
 * logs ni en mensajes de error.
 */
export const LINK_TOKEN_BYTES = 32;

export function newLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LINK_TOKEN_BYTES));

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
