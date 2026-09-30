/**
 * SPEC-005 regla 5, SPEC-029 — La rutina, como la ve el cliente.
 *
 * ┌─ LOS `warnings` NO LLEGAN AL CLIENTE ──────────────────────────────────┐
 * │ Describen su limitación —«se evitó press militar por la molestia de    │
 * │ hombro»— y existen para que el ENTRENADOR vea qué se tuvo en cuenta.   │
 * │                                                                        │
 * │ El cliente ya sabe lo que tiene. No necesita que su rutina se lo       │
 * │ recuerde por escrito en un chat que puede leer cualquiera que le coja  │
 * │ el móvil. Recibe los ejercicios YA adaptados, que es el resultado.     │
 * │                                                                        │
 * │ Las notas del ejercicio SÍ van: «baja controlado» es entrenamiento, no │
 * │ diagnóstico. Quitarlas daría una rutina peor sin proteger nada.        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * El bloque de cada ejercicio y de cada día es el mismo que ve el
 * entrenador (`formatExerciseBlock`, `formatDayHeader`): los dos numeran
 * igual, así que «el 3 del día 2 me molesta» significa lo mismo para los
 * dos (SPEC-029 §4).
 */
import type { Workout } from '../domain/workout.ts';
import { cleanFreeText, escapeMarkdownV2, formatDayHeader, formatExerciseBlock } from './format.ts';

/** Lo que viene de la evaluación de Tally. Los tres o ninguno. */
export interface PlanSummary {
  readonly goal: string;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
}

export interface ClientContext {
  readonly clientName: string;
  /**
   * `null` en una rutina manual o de plantilla: no hubo formulario.
   *
   * Van los tres juntos porque vienen de la misma fila. Sueltos, haría falta
   * un `if` por campo y existiría el estado «hay objetivo pero no días», que
   * la base no puede producir.
   */
  readonly plan: PlanSummary | null;
  /**
   * SPEC-030 regla 10: `1` es la primera rutina, más que eso es una v2 que
   * responde a algo — la cabecera lo dice, en vez de dejar que el cliente
   * adivine si esto es nuevo o ya lo había visto.
   */
  readonly versionNumber: number;
}

/**
 * Devuelve un único texto, con los bloques separados por una línea en
 * blanco: `packBlocks`/`sendLongMessage` (SPEC-029 §6) son quienes lo parten
 * en varios mensajes si no cabe.
 */
export function formatForClient(workout: Workout, context: ClientContext): string {
  const saludo =
    context.versionNumber > 1
      ? `👋 Hola ${escapeMarkdownV2(context.clientName)}, aquí está tu rutina actualizada\\.`
      : `👋 Hola ${escapeMarkdownV2(context.clientName)}, tu rutina está lista\\.`;
  const bloques: string[] = [saludo];

  // Sin evaluación no hay objetivo que mostrar. Se omite la línea: inventarla
  // sería mentir, y no enviarla dejaría al cliente sin rutina (regla 13).
  if (context.plan !== null) {
    bloques.push(
      `🎯 ${escapeMarkdownV2(context.plan.goal)} · ${context.plan.daysPerWeek} días · ` +
        `${context.plan.sessionMinutes} min`,
    );
  }

  bloques.push(escapeMarkdownV2(cleanFreeText(workout.summary)));

  for (const day of workout.days) {
    bloques.push(formatDayHeader(day));
    day.exercises.forEach((exercise, index) => {
      bloques.push(formatExerciseBlock(exercise, index + 1));
    });
  }

  // Aquí NO va un bloque de warnings. Ver el recuadro de arriba.
  bloques.push('💬 Cualquier duda, habla con tu entrenador\\.');

  return bloques.filter((bloque) => bloque.length > 0).join('\n\n');
}
