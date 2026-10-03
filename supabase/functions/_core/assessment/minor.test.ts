/**
 * SPEC-037 — si una evaluación es de un menor de edad.
 */
import { describe, expect, it } from 'vitest';
import { isMinorClient } from './minor.ts';

const HOY = new Date('2026-10-02T00:00:00Z');

function haceAnios(anios: number, ajusteDias = 0): string {
  const fecha = new Date(
    Date.UTC(HOY.getUTCFullYear() - anios, HOY.getUTCMonth(), HOY.getUTCDate() + ajusteDias),
  );
  return fecha.toISOString().slice(0, 10);
}

describe('isMinorClient', () => {
  it('con birthDate de un menor, es true', () => {
    expect(isMinorClient({ age: null, birthDate: haceAnios(15) }, HOY)).toBe(true);
  });

  it('con birthDate de un adulto, es false', () => {
    expect(isMinorClient({ age: null, birthDate: haceAnios(30) }, HOY)).toBe(false);
  });

  it('justo en el borde: un día antes de cumplir 18 sigue siendo menor', () => {
    expect(isMinorClient({ age: null, birthDate: haceAnios(18, 1) }, HOY)).toBe(true);
  });

  it('justo en el borde: el día exacto de cumplir 18 ya no es menor', () => {
    expect(isMinorClient({ age: null, birthDate: haceAnios(18) }, HOY)).toBe(false);
  });

  it('sin birthDate, cae a age declarada', () => {
    expect(isMinorClient({ age: 16, birthDate: null }, HOY)).toBe(true);
    expect(isMinorClient({ age: 25, birthDate: null }, HOY)).toBe(false);
  });

  it('con age exactamente 18, ya no es menor', () => {
    expect(isMinorClient({ age: 18, birthDate: null }, HOY)).toBe(false);
  });

  it('con birthDate Y age, birthDate gana', () => {
    // Declaró 25 en el formulario (dedazo o dato viejo), pero su fecha de
    // nacimiento real lo hace menor — gana el dato más preciso (D2).
    expect(isMinorClient({ age: 25, birthDate: haceAnios(16) }, HOY)).toBe(true);
  });

  it('sin ningún dato de edad, no se afirma nada (regla 2)', () => {
    expect(isMinorClient({ age: null, birthDate: null }, HOY)).toBe(false);
  });
});
