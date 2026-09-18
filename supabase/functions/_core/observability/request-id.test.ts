/**
 * SPEC-012 §5 — la regla 1: un identificador por cadena causal, no por función.
 */
import { describe, expect, it } from 'vitest';
import { chooseRequestId } from './request-id.ts';

const VALIDO = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const NUEVO = '00000000-0000-4000-8000-000000000000';

const nuevoId = (): string => NUEVO;

describe('chooseRequestId', () => {
  it('usa el que llega cuando es un UUID: la cadena queda unida', () => {
    expect(chooseRequestId(VALIDO, nuevoId)).toEqual({ requestId: VALIDO, rejected: false });
  });

  it('acepta el UUID en mayúsculas', () => {
    const mayusculas = VALIDO.toUpperCase();
    expect(chooseRequestId(mayusculas, nuevoId).requestId).toBe(mayusculas);
  });

  // ─── No llegar nada es normal, no un síntoma ───
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('genera uno nuevo sin marcarlo cuando llega %s', (_nombre, candidato) => {
    expect(chooseRequestId(candidato, nuevoId)).toEqual({ requestId: NUEVO, rejected: false });
  });

  // ─── Llegar algo con forma inválida SÍ es un síntoma ───
  it.each([
    ['una cadena cualquiera', 'req-42'],
    ['una cadena vacía', ''],
    ['un UUID al que le falta un grupo', '3f2504e0-4f89-41d3-9a0c'],
    ['un UUID con caracteres no hex', 'ZZZZZZZZ-4f89-41d3-9a0c-0305e82c3301'],
    ['un número', 12345],
    ['un objeto', { requestId: VALIDO }],
    ['un array', [VALIDO]],
  ])('descarta %s y lo marca', (_nombre, candidato) => {
    expect(chooseRequestId(candidato, nuevoId)).toEqual({ requestId: NUEVO, rejected: true });
  });

  it('no deja pasar un UUID con basura pegada', () => {
    // El ancla del patrón es lo que separa esto de un `includes`.
    expect(chooseRequestId(`${VALIDO} or 1=1`, nuevoId).rejected).toBe(true);
    expect(chooseRequestId(`\n${VALIDO}`, nuevoId).rejected).toBe(true);
  });

  it('solo genera cuando hace falta', () => {
    let veces = 0;
    chooseRequestId(VALIDO, () => {
      veces += 1;
      return NUEVO;
    });

    expect(veces).toBe(0);
  });
});
