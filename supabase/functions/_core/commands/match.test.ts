/**
 * SPEC-007 reglas 2 y 3 — buscar a un cliente por lo que se teclea.
 */
import { describe, expect, it } from 'vitest';
import { matchClientName, type Named } from './match.ts';

const CLIENTES: Named[] = [
  { clientId: 'c1', fullName: 'Carlos Pérez' },
  { clientId: 'c2', fullName: 'Marta Ruiz' },
  { clientId: 'c3', fullName: 'Marcos Díaz' },
  { clientId: 'c4', fullName: 'Ana' },
  { clientId: 'c5', fullName: 'Ana María López' },
];

describe('una sola coincidencia', () => {
  it('CA-2 · parcial y en minúsculas encuentra a Carlos', () => {
    const r = matchClientName(CLIENTES, 'carl');
    expect(r).toMatchObject({ kind: 'one', client: { clientId: 'c1' } });
  });

  it('encuentra por apellido', () => {
    expect(matchClientName(CLIENTES, 'Ruiz')).toMatchObject({ kind: 'one' });
  });

  it('sin tilde encuentra al que la lleva', () => {
    // El entrenador escribe desde el móvil; acordarse de la tilde no puede
    // ser el requisito.
    expect(matchClientName(CLIENTES, 'perez')).toMatchObject({
      kind: 'one',
      client: { clientId: 'c1' },
    });
    expect(matchClientName(CLIENTES, 'diaz')).toMatchObject({ kind: 'one' });
  });

  it('un nombre exacto gana sobre los que solo lo contienen', () => {
    // Con «Ana» y «Ana María», escribir Ana tiene que dar Ana.
    expect(matchClientName(CLIENTES, 'Ana')).toMatchObject({
      kind: 'one',
      client: { clientId: 'c4' },
    });
  });
});

describe('varias coincidencias', () => {
  it('CA-3 · «Mar» lista a los dos para elegir', () => {
    const r = matchClientName(CLIENTES, 'Mar');

    expect(r.kind).toBe('many');
    if (r.kind === 'many') {
      expect(r.clients.map((c) => c.clientId).toSorted()).toEqual(['c2', 'c3', 'c5']);
    }
  });
});

describe('sin coincidencias', () => {
  it('sugiere por inicial, no por parecido', () => {
    const r = matchClientName(CLIENTES, 'Mxyz');

    expect(r.kind).toBe('none');
    if (r.kind === 'none') {
      expect(r.suggestions.map((c) => c.clientId).toSorted()).toEqual(['c2', 'c3']);
    }
  });

  it('sin nadie con esa inicial, no sugiere nada', () => {
    expect(matchClientName(CLIENTES, 'Zoltan')).toEqual({ kind: 'none', suggestions: [] });
  });

  it('una búsqueda vacía NO devuelve a todos', () => {
    // `/cliente` a secas no es «lístamelos»: es que no escribió nada.
    expect(matchClientName(CLIENTES, '   ')).toEqual({ kind: 'none', suggestions: [] });
  });

  it('sin clientes tampoco revienta', () => {
    expect(matchClientName([], 'quien sea')).toEqual({ kind: 'none', suggestions: [] });
  });
});
