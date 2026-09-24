/**
 * SPEC-005 §3 — el token que viaja dentro de `/start`.
 */
import { describe, expect, it } from 'vitest';
import { buildDeepLink, parseStartToken } from './start.ts';

describe('parseStartToken', () => {
  const TOKEN = 'a'.repeat(32);

  it('saca el token de un /start con argumento', () => {
    expect(parseStartToken('start', TOKEN)).toBe(TOKEN);
  });

  it('un /start a secas no trae token', () => {
    // Abrir el bot sin enlace es legítimo: no es un canje.
    expect(parseStartToken('start', '')).toBeNull();
  });

  it.each(['clientes', 'pendientes', 'startx'])('%s no es /start', (command) => {
    expect(parseStartToken(command, TOKEN)).toBeNull();
  });

  it.each([
    ['más corto que el mínimo de la base', 'a'.repeat(15)],
    ['más largo que el límite de Telegram', 'a'.repeat(65)],
    ['con un espacio', `${'a'.repeat(20)} ${'b'.repeat(20)}`],
    ['con caracteres fuera del alfabeto', `${'a'.repeat(20)}<script>`],
    ['con un punto', `${'a'.repeat(20)}.${'b'.repeat(10)}`],
  ])('rechaza un token %s', (_nombre, args) => {
    // La forma se comprueba ANTES de consultar: un token imposible no llega
    // a tocar la base de datos.
    expect(parseStartToken('start', args)).toBeNull();
  });

  it('acepta el alfabeto que Telegram permite en un deep link', () => {
    const conGuiones = `${'a'.repeat(10)}-${'B'.repeat(10)}_${'9'.repeat(10)}`;
    expect(parseStartToken('start', conGuiones)).toBe(conGuiones);
  });
});

describe('buildDeepLink', () => {
  it('arma la URL que Telegram espera', () => {
    expect(buildDeepLink('mibot', 'abc123')).toBe('https://t.me/mibot?start=abc123');
  });

  it('es la inversa de parseStartToken: lo que arma, se vuelve a leer', () => {
    const token = 'a'.repeat(32);
    const link = buildDeepLink('mibot', token);
    const args = link.split('?start=')[1]!;

    expect(parseStartToken('start', args)).toBe(token);
  });
});
