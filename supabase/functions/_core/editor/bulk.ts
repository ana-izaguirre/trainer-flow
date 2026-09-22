/**
 * SPEC-022 — La rutina entera en un mensaje.
 *
 * ┌─ POR QUÉ EXISTE ───────────────────────────────────────────────────────┐
 * │ Montar tres días de cinco ejercicios con `/add` son dieciocho comandos │
 * │ escritos desde el móvil, sin equivocarse en ninguno. El entrenador que │
 * │ lo probó dijo que salía «bien raro y no se entendía», y dejó de usarlo.│
 * │                                                                        │
 * │ Aquí dicta la rutina como la tiene en la cabeza, de corrido, y el      │
 * │ sistema la lee.                                                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ```
 * /rutina
 * Día 1: Empuje
 * Press banca 4x8 90
 * Press militar 3x10
 *
 * Día 2: Tirón
 * Dominadas 4x6 120
 * ```
 *
 * No valida la rutina completa —de eso se encarga `validateDraft` al aprobar—,
 * solo que cada renglón se entienda. Un error nombra el renglón: desde el
 * móvil, «no se entendió» sin decir dónde no sirve de nada.
 */
import type { WorkoutDay } from '../domain/workout.ts';
import { WORKOUT_LIMITS as L } from '../domain/workout.ts';
import { parseExerciseTokens, type ExerciseProblem } from './commands.ts';

export type BulkResult =
  | { readonly ok: true; readonly days: readonly WorkoutDay[] }
  /** Va directo al entrenador: en español, y diciendo qué renglón falló. */
  | { readonly ok: false; readonly error: string };

/**
 * `Día 1: Empuje`, `Dia 2 - Tirón`, `DÍA 3`.
 *
 * El separador es opcional y admite varios: desde el móvil nadie se acuerda
 * de si eran dos puntos o un guion, y rechazarlo por eso sería absurdo.
 */
const CABECERA = /^d[ií]a\s*(\d{1,2})\s*[:.\-–—]?\s*(.*)$/i;

function problema(renglon: number, texto: string, problem: ExerciseProblem): string {
  const donde = `Renglón ${renglon} («${texto}»): `;

  switch (problem) {
    case 'no_sets_reps':
      return `${donde}falta las series y repeticiones. Ejemplo: Press banca 4x8 90`;
    case 'no_name':
      return `${donde}falta el nombre del ejercicio. Ejemplo: Press banca 4x8 90`;
    case 'sets_range':
      return `${donde}las series deben estar entre ${L.sets.min} y ${L.sets.max}.`;
    case 'reps_long':
      return `${donde}las repeticiones son demasiado largas.`;
    case 'bad_rest':
      return `${donde}el descanso tiene que ser un número de segundos. Ejemplo: 90`;
    case 'rest_range':
      return `${donde}el descanso debe estar entre ${L.restSeconds.min} y ${L.restSeconds.max} segundos.`;
  }
}

export function parseWorkoutText(text: string): BulkResult {
  const dias: { dayNumber: number; focus: string; exercises: WorkoutDay['exercises'] }[] = [];
  let actual: (typeof dias)[number] | undefined;

  const renglones = text.split('\n');

  for (const [index, linea] of renglones.entries()) {
    const texto = linea.trim();
    if (texto.length === 0) continue;

    const numero = index + 1;
    const cabecera = CABECERA.exec(texto);

    if (cabecera !== null) {
      const dayNumber = Number.parseInt(cabecera[1] as string, 10);
      if (dayNumber < L.dayNumber.min || dayNumber > L.dayNumber.max) {
        return {
          ok: false,
          error: `Renglón ${numero}: el día debe estar entre ${L.dayNumber.min} y ${L.dayNumber.max}.`,
        };
      }
      if (dias.some((dia) => dia.dayNumber === dayNumber)) {
        return { ok: false, error: `Renglón ${numero}: el día ${dayNumber} ya estaba.` };
      }

      // Sin foco escrito, el día se llama por su número. Rechazarlo obligaría
      // a inventar un nombre para un día que el entrenador ya tiene claro.
      const escrito = (cabecera[2] as string).trim();
      const focus = (escrito.length === 0 ? `Día ${dayNumber}` : escrito).slice(0, L.text.focus);

      actual = { dayNumber, focus, exercises: [] };
      dias.push(actual);
      continue;
    }

    if (actual === undefined) {
      return {
        ok: false,
        error: `Renglón ${numero} («${texto}»): antes del primer ejercicio hace falta un día. Ejemplo: Día 1: Empuje`,
      };
    }

    const parsed = parseExerciseTokens(texto.split(/\s+/).filter((t) => t.length > 0));
    if (!parsed.ok) return { ok: false, error: problema(numero, texto, parsed.problem) };

    if (actual.exercises.length >= L.exercisesPerDay.max) {
      return {
        ok: false,
        error: `Renglón ${numero}: el día ${actual.dayNumber} ya tiene ${L.exercisesPerDay.max} ejercicios, que es el máximo.`,
      };
    }

    actual.exercises = [...actual.exercises, parsed.exercise];
  }

  if (dias.length === 0) {
    return {
      ok: false,
      error: 'No encontré ningún día. Empieza por uno. Ejemplo: Día 1: Empuje',
    };
  }

  // Se ordenan por número: dictar el día 2 antes que el 1 es raro, pero la
  // rutina que sale no tiene por qué estar del revés.
  return { ok: true, days: dias.toSorted((a, b) => a.dayNumber - b.dayNumber) };
}
