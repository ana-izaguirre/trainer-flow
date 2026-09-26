/**
 * SPEC-027 — El token de actualización: leerlo del formulario, sacarlo del
 * payload que se guarda, y armar el enlace.
 */
import { describe, expect, it } from 'vitest';
import type { FormField } from './field-mapping.ts';
import { buildUpdateUrl, readUpdateToken, redactUpdateToken } from './update-token.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

const oculto = (value: unknown, label = 'update'): FormField => ({
  key: 'question_hidden',
  label,
  type: 'HIDDEN_FIELDS',
  value,
});

const nombre: FormField = { key: 'q1', label: 'Nombre', type: 'INPUT_TEXT', value: 'Carlos' };

describe('readUpdateToken', () => {
  it('lo encuentra en el campo oculto `update`', () => {
    expect(readUpdateToken([nombre, oculto(TOKEN)])).toEqual({ kind: 'present', token: TOKEN });
  });

  it('sin el campo: un envío normal', () => {
    expect(readUpdateToken([nombre])).toEqual({ kind: 'none' });
  });

  // Con el campo oculto ya configurado en Tally, TODO envío lo trae; el de
  // quien llega por primera vez, vacío. Eso no es un token malo.
  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('el campo %s: un envío normal', (_caso, valor) => {
    expect(readUpdateToken([oculto(valor)])).toEqual({ kind: 'none' });
  });

  it.each([
    ['demasiado corto', 'abc'],
    ['con caracteres raros', 'token con espacios y ñ!!!!!!!!'],
    ['un número', 12345],
    ['demasiado largo', 'a'.repeat(65)],
  ])('%s: presente pero inválido', (_caso, valor) => {
    expect(readUpdateToken([oculto(valor)])).toEqual({ kind: 'invalid' });
  });

  it('no distingue mayúsculas en la etiqueta', () => {
    expect(readUpdateToken([oculto(TOKEN, 'Update')])).toEqual({ kind: 'present', token: TOKEN });
  });
});

describe('redactUpdateToken', () => {
  const sobre = (fields: unknown) => ({ eventId: 'e1', data: { responseId: 'r', fields } });

  it('🔴 el token no llega a la base de datos', () => {
    const limpio = redactUpdateToken(sobre([nombre, oculto(TOKEN)]));

    expect(JSON.stringify(limpio)).not.toContain(TOKEN);
    expect(JSON.stringify(limpio)).toContain('Carlos');
  });

  it('deja el resto del payload tal cual', () => {
    const original = sobre([nombre]);
    expect(redactUpdateToken(original)).toEqual(original);
  });

  it.each([
    ['null', null],
    ['un texto', 'x'],
    ['sin data', { eventId: 'e' }],
    ['data sin fields', { data: {} }],
    ['fields que no es lista', { data: { fields: 'x' } }],
  ])('%s: no revienta y lo devuelve igual', (_caso, raw) => {
    expect(redactUpdateToken(raw)).toEqual(raw);
  });

  it('un campo raro dentro de la lista no revienta', () => {
    const raw = sobre([null, 'x', nombre, oculto(TOKEN)]);
    expect(JSON.stringify(redactUpdateToken(raw))).not.toContain(TOKEN);
  });
});

describe('buildUpdateUrl', () => {
  it('añade el token como parámetro', () => {
    expect(buildUpdateUrl('https://tally.so/r/abc123', TOKEN)).toBe(
      `https://tally.so/r/abc123?update=${TOKEN}`,
    );
  });

  it('si el enlace ya tiene parámetros, lo suma con &', () => {
    expect(buildUpdateUrl('https://tally.so/r/abc123?lang=es', TOKEN)).toBe(
      `https://tally.so/r/abc123?lang=es&update=${TOKEN}`,
    );
  });
});
