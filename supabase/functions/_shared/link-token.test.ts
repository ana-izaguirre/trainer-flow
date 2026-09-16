/**
 * SPEC-011 — el `link_token` es una credencial, así que su generación importa.
 */
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { LINK_TOKEN_BYTES, newLinkToken } from './link-token.ts';

Deno.test('cabe en el /start de Telegram', () => {
  // El límite es 64 caracteres. 32 bytes en base64url son 43.
  const token = newLinkToken();
  assertEquals(token.length <= 64, true);
  assertEquals(token.length >= 16, true, 'el CHECK de la tabla exige 16 mínimo');
});

Deno.test('solo lleva caracteres seguros en una URL', () => {
  // El token viaja en `t.me/bot?start=...`: `+`, `/` y `=` no sobreviven ahí.
  for (let i = 0; i < 200; i += 1) {
    assertEquals(/^[A-Za-z0-9_-]+$/.test(newLinkToken()), true);
  }
});

Deno.test('no se repite', () => {
  // Con 32 bytes una colisión es imposible en la práctica. Este test atrapa
  // el error de verdad: que alguien lo cambie por algo predecible.
  const vistos = new Set<string>();
  for (let i = 0; i < 1_000; i += 1) vistos.add(newLinkToken());
  assertEquals(vistos.size, 1_000);
});

Deno.test('dos tokens seguidos no se parecen', () => {
  assertNotEquals(newLinkToken().slice(0, 12), newLinkToken().slice(0, 12));
});

Deno.test('usa los 32 bytes declarados', () => {
  assertEquals(LINK_TOKEN_BYTES, 32);
  // 32 bytes → ceil(32/3)*4 = 44, menos el `=` de relleno = 43.
  assertEquals(newLinkToken().length, 43);
});
