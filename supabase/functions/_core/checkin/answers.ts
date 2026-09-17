/**
 * SPEC-006 — Las respuestas del check-in semanal.
 *
 * ┌─ LA REGLA QUE IMPORTA ES LA 7 ─────────────────────────────────────────┐
 * │ Si el cliente reporta una molestia, el entrenador se entera DE         │
 * │ INMEDIATO. No al final de la semana, no cuando abra el bot.            │
 * │                                                                        │
 * │ Un dolor que aparece el martes y se avisa el domingo es una lesión     │
 * │ que se pudo evitar.                                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Lo que el cliente escribe aquí es información de salud: **no se loguea**.
 */

/** Su propio prefijo: los dos callbacks viajan por el mismo canal. */
const PREFIX = 'chk';

/** SPEC-001 §7: todo texto libre se acota. */
const MAX_DISCOMFORT = 500;

export type Feeling = 'hard' | 'good' | 'easy';

export interface CheckinAnswers {
  /** `4` significa «4 o más». `null` mientras no conteste. */
  readonly sessions: number | null;
  readonly feeling: Feeling | null;
  /**
   * `''` es «ninguna», `null` es «no contestó».
   *
   * Distinguirlos es lo que permite saber si el check-in está completo.
   */
  readonly discomfort: string | null;
}

export const EMPTY_ANSWERS: CheckinAnswers = {
  sessions: null,
  feeling: null,
  discomfort: null,
};

export type CheckinField = 'sessions' | 'feeling' | 'discomfort';

export interface CheckinAnswer {
  readonly field: CheckinField;
  readonly value: string;
}

export interface CheckinCallback extends CheckinAnswer {
  readonly checkinId: string;
}

/**
 * Qué valores admite cada botón.
 *
 * Los tres son cerrados: el texto libre de una molestia llega como MENSAJE,
 * no como callback, así que nunca pasa por aquí.
 */
const VALORES: Readonly<Record<CheckinField, readonly string[]>> = {
  sessions: ['0', '1', '2', '3', '4'],
  feeling: ['hard', 'good', 'easy'],
  discomfort: ['none'],
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATRON = new RegExp(`^${PREFIX}:([a-z]+):([a-z0-9]+):(${UUID})$`, 'i');

export function buildCheckinCallback(
  field: CheckinField,
  value: string,
  checkinId: string,
): string {
  return `${PREFIX}:${field}:${value}:${checkinId}`;
}

/** `null` ante cualquier cosa que no sea exactamente lo esperado. */
export function parseCheckinCallback(raw: string): CheckinCallback | null {
  const match = PATRON.exec(raw);
  const field = match?.[1]?.toLowerCase();
  const value = match?.[2]?.toLowerCase();
  const checkinId = match?.[3];

  if (field === undefined || value === undefined || checkinId === undefined) return null;
  if (!isField(field)) return null;

  // Un valor que no es de ese campo se rechaza: «feeling=7» no existe, y
  // aceptarlo guardaría basura en `answers`.
  if (!VALORES[field].includes(value)) return null;

  return { field, value, checkinId };
}

function isField(value: string): value is CheckinField {
  return value === 'sessions' || value === 'feeling' || value === 'discomfort';
}

/** Suma una respuesta a las que ya había. La última gana. */
export function mergeAnswer(answers: CheckinAnswers, answer: CheckinAnswer): CheckinAnswers {
  switch (answer.field) {
    case 'sessions':
      return { ...answers, sessions: Number.parseInt(answer.value, 10) };

    case 'feeling':
      return { ...answers, feeling: answer.value as Feeling };

    default:
      // `none` viene del botón; cualquier otra cosa es lo que escribió.
      return {
        ...answers,
        discomfort: answer.value === 'none' ? '' : answer.value.slice(0, MAX_DISCOMFORT),
      };
  }
}

/** Las tres contestadas. El cero cuenta, y es la respuesta más importante. */
export function isComplete(answers: CheckinAnswers): boolean {
  return answers.sessions !== null && answers.feeling !== null && answers.discomfort !== null;
}

/**
 * Cuándo se avisa al entrenador en el momento.
 *
 * Una molestia, obviamente. Pero también un «muy duro»: tres semanas de eso
 * sin que nadie mire es cómo se abandona un plan, y el entrenador decide si
 * ajusta.
 */
export function needsTrainerAlert(answers: CheckinAnswers): boolean {
  const molestia = answers.discomfort !== null && answers.discomfort.trim().length > 0;
  return molestia || answers.feeling === 'hard';
}
