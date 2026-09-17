/**
 * SPEC-003 — El teclado que acompaña a cada aviso.
 *
 * Un botón de Telegram lleva un `callback_data` de 64 bytes como máximo. Pasarse
 * no da error al construirlo: Telegram rechaza el mensaje entero al enviarlo, y
 * el entrenador se queda sin aviso sin que nadie sepa por qué.
 */
import { describe, expect, it } from 'vitest';
import { buildKeyboard, DRAFT_ACTIONS, FALLBACK_ACTIONS } from './keyboard.ts';
import { parseCallbackData } from './callback-data.ts';

const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

// ---------------------------------------------------------------------------

describe('el teclado de un borrador', () => {
  it('trae editar, aprobar y rechazar', () => {
    const teclado = buildKeyboard(DRAFT_ACTIONS, VERSION)!;
    const acciones = teclado.inline_keyboard.flat().map((b) => parseCallbackData(b.callback_data));

    expect(acciones.map((a) => a?.action)).toEqual(['edit', 'approve', 'reject']);
  });

  it('cada botón apunta a ESTA versión', () => {
    const teclado = buildKeyboard(DRAFT_ACTIONS, VERSION)!;

    for (const boton of teclado.inline_keyboard.flat()) {
      expect(parseCallbackData(boton.callback_data)?.versionId).toBe(VERSION);
    }
  });

  it('los textos son legibles, no códigos', () => {
    const teclado = buildKeyboard(DRAFT_ACTIONS, VERSION)!;
    for (const boton of teclado.inline_keyboard.flat()) {
      expect(boton.text.length).toBeGreaterThan(1);
      expect(boton.text).not.toContain(VERSION);
    }
  });
});

describe('el teclado de cuando la IA falla', () => {
  it('ofrece plantilla y manual: las dos salidas que quedan', () => {
    // Decir «la IA falló» sin ofrecer por dónde seguir deja al entrenador
    // mirando un mensaje.
    const teclado = buildKeyboard(FALLBACK_ACTIONS, VERSION)!;
    const acciones = teclado.inline_keyboard.flat().map((b) => parseCallbackData(b.callback_data));

    expect(acciones.map((a) => a?.action)).toEqual(['template', 'manual']);
  });
});

describe('el límite de 64 bytes', () => {
  it('ningún callback_data se pasa', () => {
    // Telegram rechaza el MENSAJE ENTERO si un botón se excede.
    for (const acciones of [DRAFT_ACTIONS, FALLBACK_ACTIONS]) {
      for (const boton of buildKeyboard(acciones, VERSION)!.inline_keyboard.flat()) {
        expect(new TextEncoder().encode(boton.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('todo lo que se construye se puede volver a leer', () => {
    // Si `buildCallbackData` y `parseCallbackData` divergieran, los botones
    // saldrían bien y no harían nada al pulsarlos.
    for (const boton of buildKeyboard(DRAFT_ACTIONS, VERSION)!.inline_keyboard.flat()) {
      expect(parseCallbackData(boton.callback_data)).not.toBeNull();
    }
  });
});

describe('la forma', () => {
  it('es una sola fila: en un móvil tres botones caben', () => {
    expect(buildKeyboard(DRAFT_ACTIONS, VERSION)!.inline_keyboard).toHaveLength(1);
  });

  it('un teclado sin acciones no se construye vacío', () => {
    // Un `inline_keyboard: [[]]` hace que Telegram devuelva 400.
    expect(buildKeyboard([], VERSION)).toBeNull();
  });
});
