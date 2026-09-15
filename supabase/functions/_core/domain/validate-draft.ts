/**
 * Convierte un borrador NO confiable en un `Workout` validado.
 *
 * ┌─ LA FRONTERA ──────────────────────────────────────────────────────────┐
 * │ Todo lo que entra aquí es `unknown`: venga de la IA, de una plantilla  │
 * │ o del editor. Nada se lee sin comprobarlo antes. Lo que sale, o es un  │
 * │ `Workout` correcto, o es una lista de errores.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Una rutina escrita a mano se valida igual de estricto que una generada por
 * la IA (SPEC-008 regla 4). Un solo camino de validación, tres orígenes.
 *
 * Recolecta TODOS los errores en vez de parar en el primero: el entrenador
 * prefiere ver los tres problemas de una vez.
 */
import type {
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
  WorkoutConstraints,
  WorkoutDraft,
} from './draft.ts';
import type { Exercise, Workout, WorkoutDay } from './workout.ts';
import { WORKOUT_LIMITS as L } from './workout.ts';

/** Acumula errores mientras se recorre el borrador. */
class Errors {
  readonly list: ValidationError[] = [];

  add(path: string, code: ValidationErrorCode, message: string): void {
    this.list.push({ path, code, message });
  }

  get empty(): boolean {
    return this.list.length === 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee un texto obligatorio: presente, string, no en blanco y dentro del límite.
 * Devuelve `null` si algo falla, y deja el error anotado.
 */
function readText(
  value: unknown,
  path: string,
  maxLength: number,
  errors: Errors,
): string | null {
  if (value === undefined || value === null) {
    errors.add(path, 'MISSING_FIELD', `Falta ${path}.`);
    return null;
  }
  if (typeof value !== 'string') {
    errors.add(path, 'WRONG_TYPE', `${path} debe ser texto.`);
    return null;
  }
  if (value.trim().length === 0) {
    errors.add(path, 'EMPTY', `${path} no puede estar en blanco.`);
    return null;
  }
  if (value.length > maxLength) {
    errors.add(path, 'TOO_LONG', `${path} supera los ${maxLength} caracteres.`);
    return null;
  }
  return value;
}

/** Lee un entero obligatorio dentro de un rango. */
function readInt(
  value: unknown,
  path: string,
  range: { readonly min: number; readonly max: number },
  errors: Errors,
): number | null {
  if (value === undefined || value === null) {
    errors.add(path, 'MISSING_FIELD', `Falta ${path}.`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.add(path, 'WRONG_TYPE', `${path} debe ser un número entero.`);
    return null;
  }
  if (value < range.min || value > range.max) {
    errors.add(
      path,
      'OUT_OF_RANGE',
      `${path} debe estar entre ${range.min} y ${range.max}; llegó ${value}.`,
    );
    return null;
  }
  return value;
}

/** Lee un texto opcional. Ausente o null se normaliza a `null`. */
function readOptionalText(
  value: unknown,
  path: string,
  maxLength: number,
  errors: Errors,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.add(path, 'WRONG_TYPE', `${path} debe ser texto.`);
    return null;
  }
  if (value.length > maxLength) {
    errors.add(path, 'TOO_LONG', `${path} supera los ${maxLength} caracteres.`);
    return null;
  }
  return value.trim().length === 0 ? null : value;
}

function readExercise(value: unknown, path: string, errors: Errors): Exercise | null {
  if (!isRecord(value)) {
    errors.add(path, 'NOT_AN_OBJECT', `${path} debe ser un ejercicio.`);
    return null;
  }

  const name = readText(value['name'], `${path}.name`, L.text.name, errors);
  const sets = readInt(value['sets'], `${path}.sets`, L.sets, errors);
  const reps = readText(value['reps'], `${path}.reps`, L.text.reps, errors);
  const restSeconds = readInt(
    value['restSeconds'],
    `${path}.restSeconds`,
    L.restSeconds,
    errors,
  );
  const notes = readOptionalText(value['notes'], `${path}.notes`, L.text.notes, errors);

  if (name === null || sets === null || reps === null || restSeconds === null) return null;
  return { name, sets, reps, restSeconds, notes };
}

function readDay(value: unknown, path: string, errors: Errors): WorkoutDay | null {
  if (!isRecord(value)) {
    errors.add(path, 'NOT_AN_OBJECT', `${path} debe ser un día de entrenamiento.`);
    return null;
  }

  const dayNumber = readInt(value['dayNumber'], `${path}.dayNumber`, L.dayNumber, errors);
  const focus = readText(value['focus'], `${path}.focus`, L.text.focus, errors);

  const rawExercises = value['exercises'];
  const exercisesPath = `${path}.exercises`;
  let exercises: Exercise[] | null = null;

  if (rawExercises === undefined || rawExercises === null) {
    errors.add(exercisesPath, 'MISSING_FIELD', `Falta ${exercisesPath}.`);
  } else if (!Array.isArray(rawExercises)) {
    errors.add(exercisesPath, 'WRONG_TYPE', `${exercisesPath} debe ser una lista.`);
  } else if (rawExercises.length < L.exercisesPerDay.min) {
    errors.add(exercisesPath, 'EMPTY', 'Un día debe tener al menos un ejercicio.');
  } else if (rawExercises.length > L.exercisesPerDay.max) {
    errors.add(
      exercisesPath,
      'OUT_OF_RANGE',
      `Un día no puede tener más de ${L.exercisesPerDay.max} ejercicios.`,
    );
  } else {
    const parsed = rawExercises.map((item, index) =>
      readExercise(item, `${exercisesPath}[${index}]`, errors),
    );
    exercises = parsed.every((item): item is Exercise => item !== null) ? parsed : null;
  }

  if (dayNumber === null || focus === null || exercises === null) return null;
  return { dayNumber, focus, exercises };
}

function readDays(value: unknown, errors: Errors): WorkoutDay[] | null {
  if (value === undefined || value === null) {
    errors.add('days', 'MISSING_FIELD', 'Falta days.');
    return null;
  }
  if (!Array.isArray(value)) {
    errors.add('days', 'WRONG_TYPE', 'days debe ser una lista.');
    return null;
  }
  if (value.length === 0) {
    errors.add('days', 'EMPTY', 'Una rutina necesita al menos un día.');
    return null;
  }

  const parsed = value.map((item, index) => readDay(item, `days[${index}]`, errors));
  const days = parsed.every((item): item is WorkoutDay => item !== null) ? parsed : null;
  if (days === null) return null;

  const numbers = days.map((day) => day.dayNumber);
  if (new Set(numbers).size !== numbers.length) {
    errors.add('days', 'DUPLICATE_DAY', 'Hay dos días con el mismo dayNumber.');
    return null;
  }

  return days;
}

function readWarnings(value: unknown, errors: Errors): string[] | null {
  // Ausente se trata como lista vacía: no todas las rutinas tienen avisos.
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.add('warnings', 'WRONG_TYPE', 'warnings debe ser una lista.');
    return null;
  }

  const parsed = value.map((item, index) =>
    readText(item, `warnings[${index}]`, L.text.warning, errors),
  );

  return parsed.every((item): item is string => item !== null) ? parsed : null;
}

/**
 * Valida un borrador contra el modelo y, si hay evaluación, contra lo que el
 * cliente pidió.
 *
 * `constraints` es `null` cuando no hay evaluación: una rutina manual no
 * necesita un formulario de Tally, así que solo se valida la estructura.
 */
export function validateDraft(
  draft: WorkoutDraft,
  constraints: WorkoutConstraints | null,
): ValidationResult {
  const errors = new Errors();

  if (!isRecord(draft.raw)) {
    errors.add('workout', 'NOT_AN_OBJECT', 'La rutina debe ser un objeto.');
    return { ok: false, errors: errors.list };
  }

  const summary = readText(draft.raw['summary'], 'summary', L.text.summary, errors);
  const warnings = readWarnings(draft.raw['warnings'], errors);
  const days = readDays(draft.raw['days'], errors);

  if (constraints !== null) {
    if (days !== null && days.length !== constraints.daysPerWeek) {
      errors.add(
        'days',
        'DAYS_MISMATCH',
        `El cliente pidió ${constraints.daysPerWeek} días y la rutina trae ${days.length}.`,
      );
    }

    // El cliente declaró limitaciones: la rutina tiene que decir qué tuvo en
    // cuenta. Comprobar que el TEXTO coincide sería adivinar; exigir que exista
    // es lo que se puede garantizar aquí. El criterio médico es del entrenador.
    if (constraints.hasLimitations && warnings !== null && warnings.length === 0) {
      errors.add(
        'warnings',
        'LIMITATIONS_NOT_ACKNOWLEDGED',
        'El cliente declaró limitaciones y la rutina no menciona ninguna.',
      );
    }
  }

  if (!errors.empty || summary === null || days === null || warnings === null) {
    return { ok: false, errors: errors.list };
  }

  const workout: Workout = { summary, days, warnings };
  return { ok: true, workout };
}
