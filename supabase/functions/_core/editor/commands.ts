/**
 * El editor de rutinas, por comandos de Telegram.
 *
 * El entrenador escribe desde el móvil, así que la sintaxis tolera cómo
 * escribe una persona: espacios de más, `X` mayúscula, la `s` de segundos.
 * Lo que NO tolera son valores fuera de rango: eso se rechaza con un mensaje
 * que explica qué se esperaba.
 *
 * Todas las operaciones son inmutables: devuelven una rutina nueva. Editar un
 * borrador lo modifica in-place a nivel de dominio, pero eso lo decide quien
 * llama, no este módulo.
 */
import type { Exercise, Workout, WorkoutDay } from '../domain/workout.ts';
import { WORKOUT_LIMITS as L } from '../domain/workout.ts';

export type EditorCommand =
  | { readonly kind: 'setDay'; readonly dayNumber: number; readonly focus: string }
  | {
      readonly kind: 'addExercise';
      readonly dayNumber: number;
      readonly name: string;
      readonly sets: number;
      readonly reps: string;
      readonly restSeconds: number;
    }
  | { readonly kind: 'removeExercise'; readonly dayNumber: number; readonly index: number }
  /** Reemplaza TODOS los días. Lo que produce `/rutina` (SPEC-022). */
  | { readonly kind: 'setDays'; readonly days: readonly WorkoutDay[] }
  | {
      readonly kind: 'setNote';
      readonly dayNumber: number;
      readonly index: number;
      readonly note: string | null;
    };

export type ParseResult =
  | { readonly ok: true; readonly command: EditorCommand }
  /** El mensaje va directo al entrenador: se escribe en español y explica la sintaxis. */
  | { readonly ok: false; readonly error: string };

export type ApplyResult =
  | { readonly ok: true; readonly workout: Workout }
  | { readonly ok: false; readonly error: string };

const DEFAULT_REST_SECONDS = 90;

/** `4x8`, `3X10-12`, `5x AMRAP`. El grupo 1 son series, el 2 las repeticiones. */
const SETS_REPS = /^(\d{1,3})[xX](.+)$/;

function fail(error: string): ParseResult & { ok: false } {
  return { ok: false, error };
}

function parseDayNumber(token: string | undefined): number | null {
  if (token === undefined) return null;
  const value = Number.parseInt(token, 10);
  if (!Number.isInteger(value)) return null;
  if (value < L.dayNumber.min || value > L.dayNumber.max) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseEditorCommand(command: string, args: string): ParseResult {
  const normalized = command.toLowerCase();
  const tokens = args.trim().split(/\s+/).filter((token) => token.length > 0);

  switch (normalized) {
    case 'dia':
    case 'día':
      return parseSetDay(tokens);
    case 'add':
      return parseAddExercise(tokens);
    case 'quitar':
      return parseRemoveExercise(tokens);
    case 'nota':
      return parseSetNote(tokens);
    default:
      return fail(`No conozco el comando /${command}. Usa /ayuda para ver los disponibles.`);
  }
}

function parseSetDay(tokens: readonly string[]): ParseResult {
  const dayNumber = parseDayNumber(tokens[0]);
  if (dayNumber === null) {
    return fail(`Sintaxis: /dia <${L.dayNumber.min}-${L.dayNumber.max}> <foco>. Ejemplo: /dia 1 Empuje`);
  }

  const focus = tokens.slice(1).join(' ').trim();
  if (focus.length === 0) return fail('Falta el foco del día. Ejemplo: /dia 1 Empuje');

  return { ok: true, command: { kind: 'setDay', dayNumber, focus: focus.slice(0, L.text.focus) } };
}

/** Qué le pasa a una línea de ejercicio que no se entiende. */
export type ExerciseProblem =
  | 'no_sets_reps'
  | 'no_name'
  | 'sets_range'
  | 'reps_long'
  | 'bad_rest'
  | 'rest_range';

export type ExerciseParse =
  | { readonly ok: true; readonly exercise: Exercise }
  | { readonly ok: false; readonly problem: ExerciseProblem };

/**
 * `Press banca 4x8 90` → el ejercicio. **Sin el día**: eso lo pone quien llama.
 *
 * Devuelve el PROBLEMA, no el mensaje. `/add` y `/rutina` leen lo mismo pero
 * no pueden decir lo mismo: uno habla de su sintaxis, el otro del renglón que
 * falló. Compartir el texto obligaría a que uno de los dos mintiera.
 */
export function parseExerciseTokens(tokens: readonly string[]): ExerciseParse {
  // El nombre puede tener espacios, así que se ancla en el token `4x8`.
  // Una sola pasada: busca y captura a la vez, en vez de `test` y luego `exec`.
  let setsRepsIndex = -1;
  let rawSets: string | undefined;
  let reps: string | undefined;

  for (const [i, token] of tokens.entries()) {
    const match = SETS_REPS.exec(token);
    if (match !== null) {
      setsRepsIndex = i;
      rawSets = match[1];
      reps = match[2];
      break;
    }
  }

  if (rawSets === undefined || reps === undefined) return { ok: false, problem: 'no_sets_reps' };

  const name = tokens.slice(0, setsRepsIndex).join(' ').trim();
  if (name.length === 0) return { ok: false, problem: 'no_name' };

  const sets = Number.parseInt(rawSets, 10);
  if (sets < L.sets.min || sets > L.sets.max) return { ok: false, problem: 'sets_range' };
  if (reps.length > L.text.reps) return { ok: false, problem: 'reps_long' };

  // El descanso es opcional y admite la `s` de segundos.
  const restToken = tokens[setsRepsIndex + 1];
  let restSeconds = DEFAULT_REST_SECONDS;
  if (restToken !== undefined) {
    const parsed = Number.parseInt(restToken.replace(/s$/i, ''), 10);
    if (!Number.isInteger(parsed)) return { ok: false, problem: 'bad_rest' };
    if (parsed < L.restSeconds.min || parsed > L.restSeconds.max) {
      return { ok: false, problem: 'rest_range' };
    }
    restSeconds = parsed;
  }

  return {
    ok: true,
    exercise: { name: name.slice(0, L.text.name), sets, reps, restSeconds, notes: null },
  };
}

function parseAddExercise(tokens: readonly string[]): ParseResult {
  const syntax =
    'Sintaxis: /add <día> <nombre> <series>x<reps> [descanso]. Ejemplo: /add 1 Press banca 4x8 90';

  const dayNumber = parseDayNumber(tokens[0]);
  if (dayNumber === null) return fail(syntax);

  const parsed = parseExerciseTokens(tokens.slice(1));
  if (!parsed.ok) {
    switch (parsed.problem) {
      case 'no_name':
        return fail('Falta el nombre del ejercicio. ' + syntax);
      case 'sets_range':
        return fail(`Las series deben estar entre ${L.sets.min} y ${L.sets.max}.`);
      case 'reps_long':
        return fail('Las repeticiones son demasiado largas.');
      case 'rest_range':
        return fail(
          `El descanso debe estar entre ${L.restSeconds.min} y ${L.restSeconds.max} segundos.`,
        );
      default:
        return fail(syntax);
    }
  }

  const { name, sets, reps, restSeconds } = parsed.exercise;
  return { ok: true, command: { kind: 'addExercise', dayNumber, name, sets, reps, restSeconds } };
}

function parseRemoveExercise(tokens: readonly string[]): ParseResult {
  const syntax = 'Sintaxis: /quitar <día> <número del ejercicio>. Ejemplo: /quitar 1 2';

  const dayNumber = parseDayNumber(tokens[0]);
  if (dayNumber === null) return fail(syntax);

  const index = Number.parseInt(tokens[1] ?? '', 10);
  // Se cuenta desde 1 porque es el número que muestra el mensaje.
  if (!Number.isInteger(index) || index < 1) return fail(syntax);

  return { ok: true, command: { kind: 'removeExercise', dayNumber, index } };
}

function parseSetNote(tokens: readonly string[]): ParseResult {
  const syntax = 'Sintaxis: /nota <día> <número> <texto>. Sin texto, borra la nota.';

  const dayNumber = parseDayNumber(tokens[0]);
  if (dayNumber === null) return fail(syntax);

  const index = Number.parseInt(tokens[1] ?? '', 10);
  if (!Number.isInteger(index) || index < 1) return fail(syntax);

  const text = tokens.slice(2).join(' ').trim();
  const note = text.length === 0 ? null : text.slice(0, L.text.notes);

  return { ok: true, command: { kind: 'setNote', dayNumber, index, note } };
}

// ---------------------------------------------------------------------------
// Aplicación
// ---------------------------------------------------------------------------

/** Los días se mantienen ordenados aunque se creen desordenados. */
/**
 * Exportada: SPEC-031 la usa directo, sin pasar por `applyEditorCommand`.
 * `setDays` nunca falla (no hay `ok:false` posible para ella), así que
 * envolverla en `ApplyResult` allí solo obligaría a un `if (!ok)` que ningún
 * test podría alcanzar — una rama muerta en un módulo con 100% obligatorio.
 */
export function withDays(workout: Workout, days: readonly WorkoutDay[]): Workout {
  return { ...workout, days: days.toSorted((a, b) => a.dayNumber - b.dayNumber) };
}

function findDay(workout: Workout, dayNumber: number): WorkoutDay | undefined {
  return workout.days.find((day) => day.dayNumber === dayNumber);
}

export function applyEditorCommand(workout: Workout, command: EditorCommand): ApplyResult {
  switch (command.kind) {
    case 'setDay':
      return applySetDay(workout, command);
    case 'addExercise':
      return applyAddExercise(workout, command);
    case 'removeExercise':
      return applyRemoveExercise(workout, command);
    case 'setNote':
      return applySetNote(workout, command);
    case 'setDays':
      // `summary` y `warnings` se conservan: el aviso de limitaciones del
      // cliente no es algo que el entrenador esté reescribiendo al dictar
      // los días, y perderlo haría fallar la validación al aprobar.
      return { ok: true, workout: withDays(workout, [...command.days]) };
  }
}

function applySetDay(
  workout: Workout,
  command: Extract<EditorCommand, { kind: 'setDay' }>,
): ApplyResult {
  const existing = findDay(workout, command.dayNumber);

  if (existing !== undefined) {
    const days = workout.days.map((day) =>
      day.dayNumber === command.dayNumber ? { ...day, focus: command.focus } : day,
    );
    return { ok: true, workout: withDays(workout, days) };
  }

  const nuevo: WorkoutDay = {
    dayNumber: command.dayNumber,
    focus: command.focus,
    exercises: [],
  };
  return { ok: true, workout: withDays(workout, [...workout.days, nuevo]) };
}

function applyAddExercise(
  workout: Workout,
  command: Extract<EditorCommand, { kind: 'addExercise' }>,
): ApplyResult {
  const exercise: Exercise = {
    name: command.name,
    sets: command.sets,
    reps: command.reps,
    restSeconds: command.restSeconds,
    notes: null,
  };

  const existing = findDay(workout, command.dayNumber);

  // Añadir a un día que no existe lo crea: es lo que espera quien escribe
  // `/add 3 ...` sin haber hecho `/dia 3` antes.
  if (existing === undefined) {
    const nuevo: WorkoutDay = {
      dayNumber: command.dayNumber,
      focus: `Día ${command.dayNumber}`,
      exercises: [exercise],
    };
    return { ok: true, workout: withDays(workout, [...workout.days, nuevo]) };
  }

  if (existing.exercises.length >= L.exercisesPerDay.max) {
    return { ok: false, error: `Un día no puede tener más de ${L.exercisesPerDay.max} ejercicios.` };
  }

  const days = workout.days.map((day) =>
    day.dayNumber === command.dayNumber
      ? { ...day, exercises: [...day.exercises, exercise] }
      : day,
  );
  return { ok: true, workout: withDays(workout, days) };
}

function applyRemoveExercise(
  workout: Workout,
  command: Extract<EditorCommand, { kind: 'removeExercise' }>,
): ApplyResult {
  const day = findDay(workout, command.dayNumber);
  if (day === undefined) return { ok: false, error: `El día ${command.dayNumber} no existe.` };

  if (command.index > day.exercises.length) {
    return {
      ok: false,
      error: `El día ${command.dayNumber} tiene ${day.exercises.length} ejercicios.`,
    };
  }

  const days = workout.days.map((current) =>
    current.dayNumber === command.dayNumber
      ? { ...current, exercises: current.exercises.filter((_, i) => i !== command.index - 1) }
      : current,
  );
  return { ok: true, workout: withDays(workout, days) };
}

function applySetNote(
  workout: Workout,
  command: Extract<EditorCommand, { kind: 'setNote' }>,
): ApplyResult {
  const day = findDay(workout, command.dayNumber);
  if (day === undefined) return { ok: false, error: `El día ${command.dayNumber} no existe.` };

  if (command.index > day.exercises.length) {
    return {
      ok: false,
      error: `El día ${command.dayNumber} tiene ${day.exercises.length} ejercicios.`,
    };
  }

  const days = workout.days.map((current) =>
    current.dayNumber === command.dayNumber
      ? {
          ...current,
          exercises: current.exercises.map((exercise, i) =>
            i === command.index - 1 ? { ...exercise, notes: command.note } : exercise,
          ),
        }
      : current,
  );
  return { ok: true, workout: withDays(workout, days) };
}
