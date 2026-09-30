import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../helpers/markdown.ts';

describe('tieneCaracterSinEscapar', () => {
  it('texto plano sin especiales: false', () => {
    expect(tieneCaracterSinEscapar('Hola Carlos')).toBe(false);
  });

  it('un especial escapado con \\\\: false', () => {
    expect(tieneCaracterSinEscapar('Rutina aprobada para Carlos\\.')).toBe(false);
  });

  it('un especial SIN escapar: true', () => {
    expect(tieneCaracterSinEscapar('Rutina aprobada para Carlos.')).toBe(true);
  });

  it('dentro de un bloque de código no exige escape', () => {
    expect(tieneCaracterSinEscapar('```\n/crear_rutina\nDía 1: A.\n```')).toBe(false);
  });

  it('un backtick sin cerrar: true', () => {
    expect(tieneCaracterSinEscapar('texto `sin cerrar')).toBe(true);
  });

  describe('negrita *texto*', () => {
    it('una negrita bien formada no cuenta como sin escapar', () => {
      expect(tieneCaracterSinEscapar('🏋️ *Rutina para Carlos* · v1')).toBe(false);
    });

    it('un `*` sin cerrar sigue siendo un error', () => {
      expect(tieneCaracterSinEscapar('texto *sin cerrar')).toBe(true);
    });

    it('la negrita puede contener un link adentro', () => {
      expect(
        tieneCaracterSinEscapar('*1\\. [Press banca](https://exercise-dataset.com/exercise/bench-press/)*'),
      ).toBe(false);
    });

    it('dos negritas distintas en el mismo texto', () => {
      expect(tieneCaracterSinEscapar('*Uno* y *Dos*')).toBe(false);
    });
  });

  describe('sintaxis de link [texto](url) — SPEC-019', () => {
    it('un link bien formado no cuenta como sin escapar', () => {
      expect(
        tieneCaracterSinEscapar('*1\\. [Press banca](https://exercise-dataset.com/exercise/bench-press/)*'),
      ).toBe(false);
    });

    it('la URL puede llevar los especiales de una query real, sin escape de Markdown', () => {
      const url = 'https://www.youtube.com/results?search_query=Press%20banca%20t%C3%A9cnica';
      expect(tieneCaracterSinEscapar(`[Press banca](${url})`)).toBe(false);
    });

    it('un `)` escapado DENTRO de la URL (regla de Telegram) sigue siendo válido', () => {
      expect(tieneCaracterSinEscapar('[texto](https://x.com/a\\)b)')).toBe(false);
    });

    it('varios links en el mismo texto', () => {
      expect(
        tieneCaracterSinEscapar('[Uno](https://a.com/) y también [Dos](https://b.com/)'),
      ).toBe(false);
    });

    it('un `[` suelto que NUNCA cierra con `](` sigue siendo un error', () => {
      expect(tieneCaracterSinEscapar('Rutina [sin cerrar bien')).toBe(true);
    });

    it('un `[texto]` sin `(url)` detrás sigue siendo un error', () => {
      expect(tieneCaracterSinEscapar('[texto] suelto')).toBe(true);
    });

    it('un `[texto](` sin cerrar la URL sigue siendo un error', () => {
      expect(tieneCaracterSinEscapar('[texto](https://sin-cerrar.com')).toBe(true);
    });

    it('un `(` suelto que no es parte de un link sigue siendo un error', () => {
      expect(tieneCaracterSinEscapar('nota (sin escapar)')).toBe(true);
    });
  });
});
