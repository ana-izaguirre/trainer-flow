/**
 * SPEC-007 regla 2 y 3 — Encontrar a un cliente por lo que el entrenador teclea.
 *
 * ┌─ POR QUÉ NO HAY DISTANCIA DE EDICIÓN ──────────────────────────────────┐
 * │ Con diez clientes, un Levenshtein es maquinaria para un problema que   │
 * │ no existe. Contiene-el-texto resuelve «carl» → Carlos, y las           │
 * │ iniciales resuelven el dedazo. Si algún día hay cien clientes, esto    │
 * │ se cambia; hoy sería resolver un problema que no tenemos.              │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/** Lo mínimo para buscar. El resto de la ficha no hace falta aquí. */
export interface Named {
  readonly clientId: string;
  readonly fullName: string;
}

export type MatchResult<T extends Named> =
  | { readonly kind: 'one'; readonly client: T }
  /** Varios: se listan para que elija. */
  | { readonly kind: 'many'; readonly clients: readonly T[] }
  /** Ninguno contiene lo escrito, pero estos empiezan igual. */
  | { readonly kind: 'none'; readonly suggestions: readonly T[] };

/**
 * Sin acentos y en minúsculas: el entrenador escribe «perez» desde el móvil
 * y encontrar a «Pérez» no debería depender de que se acuerde de la tilde.
 *
 * Exportada porque `exercise-library.ts` necesita la misma normalización
 * para nombres de ejercicio — mismo criterio de texto en español, dos sitios.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function matchClientName<T extends Named>(
  clients: readonly T[],
  query: string,
): MatchResult<T> {
  const buscado = normalize(query);

  // Una búsqueda vacía no es «todos»: es que no escribió nada.
  if (buscado.length === 0) return { kind: 'none', suggestions: [] };

  const contienen = clients.filter((c) => normalize(c.fullName).includes(buscado));

  if (contienen.length === 1) return { kind: 'one', client: contienen[0]! };
  if (contienen.length > 1) {
    // Un nombre completo exacto gana sobre los que solo lo contienen: si hay
    // «Ana» y «Ana María», escribir «Ana» tiene que dar Ana.
    const exacto = contienen.find((c) => normalize(c.fullName) === buscado);
    return exacto === undefined ? { kind: 'many', clients: contienen } : { kind: 'one', client: exacto };
  }

  // Nada contiene lo escrito: se ofrece quien empiece por la misma letra.
  const inicial = buscado[0]!;
  return {
    kind: 'none',
    suggestions: clients.filter((c) => normalize(c.fullName).startsWith(inicial)),
  };
}
