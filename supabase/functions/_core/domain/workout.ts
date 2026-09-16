/**
 * El modelo VALIDADO de una rutina.
 *
 * Un `Workout` solo existe si pasó por `validateDraft`. Lo que viene de la IA,
 * de una plantilla o del editor es un `WorkoutDraft`, que es dato no confiable.
 */

export interface Exercise {
  readonly name: string;
  readonly sets: number;
  /** Texto libre: "8-10", "12", "AMRAP", "al fallo". */
  readonly reps: string;
  readonly restSeconds: number;
  readonly notes: string | null;
}

export interface WorkoutDay {
  /** 1..7. Único dentro de la rutina. */
  readonly dayNumber: number;
  readonly focus: string;
  readonly exercises: readonly Exercise[];
}

export interface Workout {
  readonly summary: string;
  readonly days: readonly WorkoutDay[];
  /** Qué limitaciones se tuvieron en cuenta. El entrenador las ve destacadas. */
  readonly warnings: readonly string[];
}

/**
 * Los límites del modelo, en un solo sitio.
 *
 * `sets` y `restSeconds` vienen de SPEC-002 regla 7. Los de texto existen
 * porque todo campo libre se acota (SPEC-001 §7 y SECURITY.md).
 */
export const WORKOUT_LIMITS = {
  sets: { min: 1, max: 10 },
  restSeconds: { min: 0, max: 600 },
  dayNumber: { min: 1, max: 7 },
  exercisesPerDay: { min: 1, max: 15 },
  text: {
    summary: 500,
    focus: 80,
    name: 120,
    reps: 20,
    notes: 500,
    warning: 300,
  },
} as const;
