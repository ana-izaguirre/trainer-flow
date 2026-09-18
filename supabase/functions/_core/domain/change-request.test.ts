/**
 * SPEC-010 §3 — Los motivos y su callback.
 */
import { describe, expect, it } from 'vitest';
import {
  buildChangeCallback,
  CHANGE_REASONS,
  parseChangeCallback,
  REASON_LABELS,
} from './change-request.ts';

const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

describe('los siete motivos', () => {
  it.each(CHANGE_REASONS)('%s se construye y se vuelve a leer', (reason) => {
    expect(parseChangeCallback(buildChangeCallback(reason, VERSION))).toEqual({
      reason,
      versionId: VERSION,
    });
  });

  it('🔴 ninguno pasa los 64 bytes de Telegram', () => {
    // `chg:uncomfortable_exercise:<uuid>` ocupa 63. Va justo, así que un
    // motivo nuevo con nombre largo tiene que verse AQUÍ y no en un botón
    // que deja de responder en producción.
    for (const reason of CHANGE_REASONS) {
      const data = buildChangeCallback(reason, VERSION);
      expect(new TextEncoder().encode(data).length, reason).toBeLessThanOrEqual(64);
    }
  });

  it('cada uno tiene su etiqueta, y ninguna se repite', () => {
    const etiquetas = CHANGE_REASONS.map((r) => REASON_LABELS[r]);

    expect(etiquetas.filter((e) => e.length > 0)).toHaveLength(CHANGE_REASONS.length);
    expect(new Set(etiquetas).size).toBe(CHANGE_REASONS.length);
  });
});

describe('lo que no se acepta', () => {
  it.each([
    ['un motivo inventado', `chg:inventado:${VERSION}`],
    ['otro prefijo', `act:approve:${VERSION}`],
    ['un callback de plantilla', `tpl:full-body-3d:${VERSION}`],
    ['un callback de check-in', `chk:feeling:good:${VERSION}`],
    ['sin versión', 'chg:too_hard'],
    ['una versión que no es UUID', 'chg:too_hard:no-soy-uuid'],
    ['vacío', ''],
  ])('rechaza %s', (_nombre, raw) => {
    expect(parseChangeCallback(raw)).toBeNull();
  });

  it('un motivo con mayúsculas se normaliza', () => {
    expect(parseChangeCallback(`chg:TOO_HARD:${VERSION}`)).toEqual({
      reason: 'too_hard',
      versionId: VERSION,
    });
  });
});
