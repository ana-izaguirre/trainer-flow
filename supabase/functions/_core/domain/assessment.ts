/**
 * Vocabulario de la evaluación del cliente.
 *
 * Se irá completando en SPEC-001, cuando se escriba el parser de Tally. Por
 * ahora solo lo que ya hace falta.
 */

/** Los mismos tres valores que el CHECK de `assessments.level`. */
export type Level = 'beginner' | 'intermediate' | 'advanced';

export const LEVELS: readonly Level[] = ['beginner', 'intermediate', 'advanced'];
