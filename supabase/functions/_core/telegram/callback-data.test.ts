/**
 * SPEC-003 / SPEC-004 — los datos que viajan en un botón.
 *
 * Telegram limita `callback_data` a 64 bytes. Pasarse no da un error claro:
 * el botón simplemente no funciona.
 */
import { describe, expect, it } from 'vitest';
import { CALLBACK_ACTIONS, buildCallbackData, parseCallbackData } from './callback-data.ts';

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
