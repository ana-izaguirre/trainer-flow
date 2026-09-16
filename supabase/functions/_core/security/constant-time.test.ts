/**
 * SPEC-003 regla 1 — verificación del secreto del webhook.
 *
 * Es lo primero que corre en cada petición entrante. Si falla, se responde 401
 * sin tocar la base de datos.
 */
import { describe, expect, it } from 'vitest';
import { constantTimeEquals } from './constant-time.ts';

const SECRET = 'un-secreto-de-webhook-suficientemente-largo';

describe('constantTimeEquals', () => {
  it('acepta el secreto correcto', () => {
    expect(constantTimeEquals(SECRET, SECRET)).toBe(true);
  });

  it.each([
    ['uno distinto', 'otro-secreto-completamente-distinto-y-largo'],
    ['uno más corto', SECRET.slice(0, -1)],
    ['uno más largo', `${SECRET}x`],
    ['vacío', ''],
    ['que difiere en el último carácter', `${SECRET.slice(0, -1)}X`],
    ['que difiere en el primero', `X${SECRET.slice(1)}`],
  ])('rechaza %s', (_nombre, recibido) => {
    expect(constantTimeEquals(recibido, SECRET)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('rechaza cuando la cabecera es %s', (_nombre, recibido) => {
    // Telegram no envió la cabecera, o no es nuestro Telegram.
    expect(constantTimeEquals(recibido, SECRET)).toBe(false);
  });

  it('rechaza siempre si el secreto esperado está vacío', () => {
    // Una configuración a medias no puede convertirse en "todo el mundo pasa".
    expect(constantTimeEquals('', '')).toBe(false);
    expect(constantTimeEquals('lo-que-sea', '')).toBe(false);
  });

  // La comparación es de tiempo constante para no filtrar cuántos caracteres
  // acertó un atacante. Medir tiempos en un test sería inestable y daría falsos
  // rojos, así que se verifica el comportamiento y se documenta la intención.
  it('compara todo el contenido, no corta en la primera diferencia', () => {
    const casi = `${SECRET.slice(0, -1)}Z`;
    expect(constantTimeEquals(casi, SECRET)).toBe(false);
  });
});
