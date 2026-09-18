/**
 * Un borrador de rutina: dato NO confiable, venga de donde venga.
 *
 * Las tres fuentes producen el mismo tipo y pasan la misma validación
 * (SPEC-008 §4). Una rutina escrita a mano se valida igual de estricto que
 * una generada por la IA.
 */
import type { Workout } from './workout.ts';

export type DraftSource = 'ai' | 'template' | 'manual';

export interface WorkoutDraft {
  readonly source: DraftSource;
  /**
   * `unknown`, nunca `any`: el compilador obliga a validar antes de leer nada
   * (SECURITY.md, regla 1 de seguridad de la IA).
   */
  readonly raw: unknown;
}

/**
 * Lo que el cliente pidió. `null` cuando no hay evaluación — una rutina manual
 * no necesita un formulario de Tally.
 */
export interface WorkoutConstraints {
  readonly daysPerWeek: number;
  readonly hasLimitations: boolean;
}

export type ValidationErrorCode =
  /** No es un objeto, o es null/array/primitivo donde se esperaba uno. */
  | 'NOT_AN_OBJECT'
  | 'MISSING_FIELD'
  | 'WRONG_TYPE'
  | 'OUT_OF_RANGE'
  | 'EMPTY'
  | 'TOO_LONG'
  /** El número de días no coincide con lo que pidió el cliente. */
  | 'DAYS_MISMATCH'
  | 'DUPLICATE_DAY'
  /** El cliente declaró limitaciones y la rutina no las menciona. */
  | 'LIMITATIONS_NOT_ACKNOWLEDGED';

export interface ValidationError {
  /** Dónde falló: `days[0].exercises[2].sets`. */
  readonly path: string;
  readonly code: ValidationErrorCode;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly workout: Workout }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };


/**
 * Los errores de validación, en una frase que el entrenador pueda leer.
 *
 * Existe porque `errors.join('; ')` sobre objetos produce
 * `[object Object]` — un mensaje que no dice nada y que no falla en ningún
 * sitio hasta que alguien lo ve en Telegram.
 *
 * Se acota a los tres primeros: una rutina recién empezada produce un error
 * por cada campo que falta, y un muro de texto no ayuda a arreglar nada.
 */
export function describeErrors(errors: readonly ValidationError[], max = 3): string {
  const primeros = errors.slice(0, max).map((e) => e.message);
  const resto = errors.length - primeros.length;

  return resto > 0 ? `${primeros.join(' ')} (y ${resto} más)` : primeros.join(' ');
}
