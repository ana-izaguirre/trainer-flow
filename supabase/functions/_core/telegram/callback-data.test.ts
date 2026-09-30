/**
 * SPEC-003 / SPEC-004 — los datos que viajan en un botón.
 *
 * Telegram limita `callback_data` a 64 bytes. Pasarse no da un error claro:
 * el botón simplemente no funciona.
 */
import { describe, expect, it } from 'vitest';
import {
  CALLBACK_ACTIONS,
  buildCallbackData,
  buildNavCallback,
  parseCallbackData,
  parseNavCallback,
  type RoutineView,
} from './callback-data.ts';

const UUID = '4c9a1f2e-8b3d-4e5f-9a7c-1d2e3f4a5b6c';

describe('buildCallbackData', () => {
  it.each(CALLBACK_ACTIONS)('construye la acción %s', (action) => {
    expect(buildCallbackData(action, UUID)).toBe(`act:${action}:${UUID}`);
  });

  // El límite de Telegram. Si se supera, el botón no responde y no hay error.
  it.each(CALLBACK_ACTIONS)('la acción %s cabe en 64 bytes', (action) => {
    const data = buildCallbackData(action, UUID);
    expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(64);
  });
});

describe('parseCallbackData', () => {
  it('va y vuelve sin perder nada', () => {
    for (const action of CALLBACK_ACTIONS) {
      expect(parseCallbackData(buildCallbackData(action, UUID))).toEqual({
        action,
        versionId: UUID,
      });
    }
  });

  it.each([
    ['cadena vacía', ''],
    ['sin el prefijo act:', `approve:${UUID}`],
    ['prefijo equivocado', `xxx:approve:${UUID}`],
    ['sin versionId', 'act:approve'],
    ['con partes de más', `act:approve:${UUID}:extra`],
    ['acción desconocida', `act:borrar:${UUID}`],
    ['versionId que no es UUID', 'act:approve:12345'],
    ['versionId vacío', 'act:approve:'],
    ['intento de inyección', `act:approve:${UUID}' OR 1=1--`],
    ['solo separadores', '::'],
    // El patrón aparece, pero no al INICIO: sin el `^`, `.exec` lo encuentra
    // igual a partir de cualquier posición.
    ['el prefijo con basura antes', `xact:approve:${UUID}`],
  ])('rechaza %s', (_nombre, raw) => {
    expect(parseCallbackData(raw)).toBeNull();
  });

  it('no distingue mayúsculas en la acción', () => {
    expect(parseCallbackData(`act:APPROVE:${UUID}`)).toEqual({ action: 'approve', versionId: UUID });
  });

  it('rechaza un UUID con mayúsculas mal formado pero acepta uno válido', () => {
    expect(parseCallbackData(`act:approve:${UUID.toUpperCase()}`)).toEqual({
      action: 'approve',
      versionId: UUID.toUpperCase(),
    });
  });
});

// ---------------------------------------------------------------------------
// SPEC-031 — navegación de la rutina. Prefijo `nav:`, separado de `act:`.
// ---------------------------------------------------------------------------

describe('buildNavCallback', () => {
  it('arma el índice', () => {
    expect(buildNavCallback({ kind: 'index' }, UUID)).toBe(`nav:idx:${UUID}`);
  });

  it('arma la vista completa', () => {
    expect(buildNavCallback({ kind: 'full' }, UUID)).toBe(`nav:full:${UUID}`);
  });

  it.each([1, 7, 15])('arma el día %i', (dayNumber) => {
    expect(buildNavCallback({ kind: 'day', dayNumber }, UUID)).toBe(`nav:d${dayNumber}:${UUID}`);
  });

  // El día de dos dígitos es el caso largo: si este cabe, todos caben.
  it('cabe en 64 bytes incluso con un día de dos dígitos', () => {
    const data = buildNavCallback({ kind: 'day', dayNumber: 15 }, UUID);
    expect(new TextEncoder().encode(data).byteLength).toBeLessThanOrEqual(64);
  });
});

describe('parseNavCallback', () => {
  const casos: readonly RoutineView[] = [
    { kind: 'index' },
    { kind: 'full' },
    { kind: 'day', dayNumber: 1 },
    { kind: 'day', dayNumber: 7 },
    { kind: 'day', dayNumber: 15 },
  ];

  it.each(casos)('va y vuelve sin perder nada: %o', (view) => {
    expect(parseNavCallback(buildNavCallback(view, UUID))).toEqual({ view, versionId: UUID });
  });

  it('no distingue mayúsculas en la vista', () => {
    expect(parseNavCallback(`nav:IDX:${UUID}`)).toEqual({ view: { kind: 'index' }, versionId: UUID });
    expect(parseNavCallback(`nav:D3:${UUID}`)).toEqual({
      view: { kind: 'day', dayNumber: 3 },
      versionId: UUID,
    });
  });

  it.each([
    ['cadena vacía', ''],
    ['sin el prefijo nav:', `idx:${UUID}`],
    ['prefijo equivocado', `act:idx:${UUID}`],
    ['sin versionId', 'nav:idx'],
    ['con partes de más', `nav:idx:${UUID}:extra`],
    ['vista desconocida', `nav:completa:${UUID}`],
    ['día 0', `nav:d0:${UUID}`],
    ['día con tres dígitos', `nav:d100:${UUID}`],
    ['día sin número', `nav:d:${UUID}`],
    ['versionId que no es UUID', 'nav:idx:12345'],
    ['versionId vacío', 'nav:idx:'],
    ['intento de inyección', `nav:idx:${UUID}' OR 1=1--`],
    ['solo separadores', '::'],
    ['el prefijo con basura antes', `xnav:idx:${UUID}`],
  ])('rechaza %s', (_nombre, raw) => {
    expect(parseNavCallback(raw)).toBeNull();
  });
});
