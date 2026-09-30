/**
 * SPEC-003 — El teclado que acompaña a cada aviso.
 *
 * Un botón de Telegram lleva un `callback_data` de 64 bytes como máximo. Pasarse
 * no da error al construirlo: Telegram rechaza el mensaje entero al enviarlo, y
 * el entrenador se queda sin aviso sin que nadie sepa por qué.
 */
import { describe, expect, it } from 'vitest';
import { buildKeyboard, buildNavKeyboard, CLIENT_ACTIONS, DRAFT_ACTIONS, FALLBACK_ACTIONS } from './keyboard.ts';
import { parseCallbackData, parseNavCallback } from './callback-data.ts';

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
  it('ofrece plantilla y manual: las salidas que siempre quedan', () => {
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

describe('extraRow — una segunda fila, la excepción de SPEC-007 regla 7', () => {
  it('sin extraRow, se comporta exactamente igual que antes', () => {
    expect(buildKeyboard(DRAFT_ACTIONS, VERSION)).toEqual(buildKeyboard(DRAFT_ACTIONS, VERSION, []));
  });

  it('con extraRow, salen DOS filas', () => {
    const teclado = buildKeyboard(DRAFT_ACTIONS, VERSION, ['intake'])!;

    expect(teclado.inline_keyboard).toHaveLength(2);
    expect(teclado.inline_keyboard[1]!.map((b) => parseCallbackData(b.callback_data)?.action)).toEqual([
      'intake',
    ]);
  });

  it('sin acciones principales pero con extraRow, sale una fila con esa sola', () => {
    const teclado = buildKeyboard([], VERSION, ['intake'])!;

    expect(teclado.inline_keyboard).toHaveLength(1);
    expect(teclado.inline_keyboard[0]!.map((b) => parseCallbackData(b.callback_data)?.action)).toEqual([
      'intake',
    ]);
  });

  it('las dos vacías siguen dando null', () => {
    expect(buildKeyboard([], VERSION, [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SPEC-031 — navegación de la rutina: índice, por día, completa.
// ---------------------------------------------------------------------------

describe('buildNavKeyboard', () => {
  it('el índice de una rutina de 5 días trae «Ver todo» y «Día 1»', () => {
    const teclado = buildNavKeyboard({ view: { kind: 'index' }, totalDays: 5, versionId: VERSION }, [])!;
    expect(teclado.inline_keyboard[0]!.map((b) => b.text)).toEqual(['📖 Ver todo', '▶️ Día 1']);
  });

  it('el día 1 de 5 no ofrece «anterior»', () => {
    const teclado = buildNavKeyboard(
      { view: { kind: 'day', dayNumber: 1 }, totalDays: 5, versionId: VERSION },
      [],
    )!;
    expect(teclado.inline_keyboard[0]!.map((b) => b.text)).toEqual(['📋 Índice', 'Día 2 ▶️']);
  });

  it('un día del medio (3 de 5) ofrece los dos lados', () => {
    const teclado = buildNavKeyboard(
      { view: { kind: 'day', dayNumber: 3 }, totalDays: 5, versionId: VERSION },
      [],
    )!;
    expect(teclado.inline_keyboard[0]!.map((b) => b.text)).toEqual(['◀️ Día 2', '📋 Índice', 'Día 4 ▶️']);
  });

  it('el último día (5 de 5) no ofrece «siguiente»', () => {
    const teclado = buildNavKeyboard(
      { view: { kind: 'day', dayNumber: 5 }, totalDays: 5, versionId: VERSION },
      [],
    )!;
    expect(teclado.inline_keyboard[0]!.map((b) => b.text)).toEqual(['◀️ Día 4', '📋 Índice']);
  });

  it('una rutina de un solo día no ofrece ni anterior ni siguiente', () => {
    const teclado = buildNavKeyboard(
      { view: { kind: 'day', dayNumber: 1 }, totalDays: 1, versionId: VERSION },
      [],
    )!;
    expect(teclado.inline_keyboard[0]!.map((b) => b.text)).toEqual(['📋 Índice']);
  });

  it('la vista completa solo ofrece «Índice»', () => {
    const teclado = buildNavKeyboard({ view: { kind: 'full' }, totalDays: 5, versionId: VERSION }, [])!;
    expect(teclado.inline_keyboard[0]!.map((b) => b.text)).toEqual(['📋 Índice']);
  });

  it('la fila de decisión va SEGUNDA, con las acciones que le correspondan al rol y estado', () => {
    const teclado = buildNavKeyboard(
      { view: { kind: 'index' }, totalDays: 5, versionId: VERSION },
      CLIENT_ACTIONS,
    )!;
    expect(teclado.inline_keyboard).toHaveLength(2);
    expect(teclado.inline_keyboard[1]!.map((b) => parseCallbackData(b.callback_data)?.action)).toEqual([
      'accept',
      'change',
    ]);
  });

  it('sin acciones de decisión, sale una sola fila: la de navegación', () => {
    // A diferencia de `buildKeyboard`, nunca da null: «Índice»/«Ver todo»
    // garantizan que la fila de navegación nunca está vacía.
    const teclado = buildNavKeyboard({ view: { kind: 'full' }, totalDays: 5, versionId: VERSION }, []);
    expect(teclado.inline_keyboard).toHaveLength(1);
    expect(teclado.inline_keyboard[0]!.map((b) => b.text)).toEqual(['📋 Índice']);
  });

  it('cada botón de navegación apunta a ESTA versión y se puede volver a leer', () => {
    const teclado = buildNavKeyboard(
      { view: { kind: 'day', dayNumber: 3 }, totalDays: 5, versionId: VERSION },
      [],
    )!;
    for (const boton of teclado.inline_keyboard[0]!) {
      expect(parseNavCallback(boton.callback_data)?.versionId).toBe(VERSION);
    }
  });

  it('ningún callback_data se pasa de 64 bytes, ni con un día de dos dígitos', () => {
    for (const view of [
      { kind: 'index' as const },
      { kind: 'full' as const },
      { kind: 'day' as const, dayNumber: 15 },
    ]) {
      const teclado = buildNavKeyboard({ view, totalDays: 15, versionId: VERSION }, CLIENT_ACTIONS)!;
      for (const boton of teclado.inline_keyboard.flat()) {
        expect(new TextEncoder().encode(boton.callback_data).length).toBeLessThanOrEqual(64);
      }
    }
  });
});
