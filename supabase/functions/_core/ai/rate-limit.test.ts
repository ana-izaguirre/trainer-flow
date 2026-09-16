/**
 * SPEC-002 regla 2 — El rate limit es una VENTANA, no un saldo.
 *
 * Un saldo hay que guardarlo, decrementarlo y reponerlo, y cualquiera de esos
 * tres pasos puede quedarse a medias. Una ventana se calcula contando filas
 * que ya existen: no hay estado que corromper.
 *
 * ADR-005: sin margen no se llama al proveedor, y el producto sigue
 * funcionando por plantilla o a mano.
 */
import { describe, expect, it } from 'vitest';
import { checkRateLimit, type RateLimitConfig } from './rate-limit.ts';

const LIMITE: RateLimitConfig = { maxCalls: 3, windowMinutes: 60 };
const AHORA = new Date('2026-09-16T12:00:00Z');

/** Una llamada hecha hace `minutos`. */
const haceMinutos = (minutos: number) => new Date(AHORA.getTime() - minutos * 60_000);

// ---------------------------------------------------------------------------

describe('por debajo del límite', () => {
  it('sin llamadas previas, hay margen', () => {
    expect(checkRateLimit([], LIMITE, AHORA)).toEqual({ allowed: true, remaining: 3 });
  });

  it('con una llamada, quedan dos', () => {
    const r = checkRateLimit([haceMinutos(10)], LIMITE, AHORA);
    expect(r).toEqual({ allowed: true, remaining: 2 });
  });
});

describe('en el límite exacto', () => {
  it('con dos llamadas queda una: el límite es el número de llamadas, no el de huecos', () => {
    const r = checkRateLimit([haceMinutos(5), haceMinutos(10)], LIMITE, AHORA);
    expect(r).toEqual({ allowed: true, remaining: 1 });
  });

  it('con exactamente `maxCalls` ya NO hay margen', () => {
    // El error clásico es dejar pasar la que hace `maxCalls + 1`.
    const r = checkRateLimit([haceMinutos(5), haceMinutos(10), haceMinutos(15)], LIMITE, AHORA);
    expect(r).toEqual({ allowed: false, remaining: 0, retryAfterMinutes: 45 });
  });
});

describe('por encima del límite', () => {
  it('con más llamadas que el límite, `remaining` no se va a negativo', () => {
    const llamadas = [1, 2, 3, 4, 5].map(haceMinutos);
    expect(checkRateLimit(llamadas, LIMITE, AHORA)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('dice cuándo volver a intentar: cuando expire la MÁS ANTIGUA', () => {
    // Es la primera que sale de la ventana, y por tanto la que libera el hueco.
    const r = checkRateLimit([haceMinutos(50), haceMinutos(20), haceMinutos(10)], LIMITE, AHORA);
    expect(r).toEqual({ allowed: false, remaining: 0, retryAfterMinutes: 10 });
  });
});

describe('la ventana expira sola', () => {
  it('una llamada fuera de la ventana no cuenta', () => {
    // Justo por fuera: 61 minutos con una ventana de 60.
    expect(checkRateLimit([haceMinutos(61)], LIMITE, AHORA)).toEqual({
      allowed: true,
      remaining: 3,
    });
  });

  it('justo en el borde de la ventana todavía cuenta', () => {
    // A los 60 minutos exactos sigue dentro: excluirla sería dejar pasar una
    // llamada de más cada hora.
    expect(checkRateLimit([haceMinutos(60)], LIMITE, AHORA)).toMatchObject({ remaining: 2 });
  });

  it('las viejas se ignoran y las nuevas cuentan', () => {
    const r = checkRateLimit([haceMinutos(120), haceMinutos(90), haceMinutos(5)], LIMITE, AHORA);
    expect(r).toEqual({ allowed: true, remaining: 2 });
  });

  it('con TODAS fuera de la ventana, el margen vuelve entero', () => {
    const viejas = [70, 80, 90, 100].map(haceMinutos);
    expect(checkRateLimit(viejas, LIMITE, AHORA)).toEqual({ allowed: true, remaining: 3 });
  });
});

describe('configuraciones raras', () => {
  it('un límite de cero no deja pasar nada', () => {
    // Es el interruptor de apagado: poner 0 desactiva la IA sin desplegar.
    const r = checkRateLimit([], { maxCalls: 0, windowMinutes: 60 }, AHORA);
    expect(r.allowed).toBe(false);
  });

  it('el orden en que llegan las llamadas no importa', () => {
    const ordenadas = [haceMinutos(5), haceMinutos(30), haceMinutos(50)];
    const revueltas = [haceMinutos(50), haceMinutos(5), haceMinutos(30)];

    expect(checkRateLimit(revueltas, LIMITE, AHORA)).toEqual(
      checkRateLimit(ordenadas, LIMITE, AHORA),
    );
  });

  it('una llamada en el futuro cuenta como reciente, no rompe el cálculo', () => {
    // Un reloj desincronizado entre la base y la función no debería abrir la
    // puerta de par en par.
    const futura = new Date(AHORA.getTime() + 60_000);
    expect(checkRateLimit([futura], LIMITE, AHORA)).toMatchObject({ remaining: 2 });
  });
});
