/**
 * SPEC-037 — si una evaluación es de un menor de edad.
 *
 * ┌─ SOLO AVISA, NUNCA BLOQUEA (D1) ───────────────────────────────────────┐
 * │ Esto no participa en `validateDraft`, en `authorization.ts` ni en      │
 * │ ninguna transición de estado. Es información para el entrenador y el  │
 * │ cliente, no una regla que detenga nada.                                │
 * └────────────────────────────────────────────────────────────────────────┘
 */

export interface AgeInput {
  readonly age: number | null;
  readonly birthDate: string | null;
}

const MAYORIA_DE_EDAD = 18;

function edadDesdeNacimiento(birthDate: string, today: Date): number {
  const [anio, mes, dia] = birthDate.split('-').map(Number) as [number, number, number];
  let edad = today.getUTCFullYear() - anio;

  const cumpleAunNoLlego =
    today.getUTCMonth() + 1 < mes || (today.getUTCMonth() + 1 === mes && today.getUTCDate() < dia);
  if (cumpleAunNoLlego) edad -= 1;

  return edad;
}

/**
 * `birthDate` gana si está: es la edad exacta (D2). Si no, cae a `age`
 * declarada. Sin ninguno de los dos, no hay base para afirmar nada — nunca
 * "es menor" sin evidencia (regla 2): un falso aviso le genera trabajo al
 * entrenador sin motivo.
 */
export function isMinorClient(input: AgeInput, today: Date): boolean {
  const edad = input.birthDate !== null ? edadDesdeNacimiento(input.birthDate, today) : input.age;

  return edad !== null && edad < MAYORIA_DE_EDAD;
}
