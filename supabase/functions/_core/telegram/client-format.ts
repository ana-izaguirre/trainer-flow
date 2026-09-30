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
import {
  cleanFreeText,
  escapeMarkdownV2,
  formatDayHeader,
  formatDayIndex,
  formatExerciseBlock,
} from './format.ts';

/**
 * SPEC-019 §10 — nada más en el mensaje dice que el nombre del ejercicio es
 * un enlace, y un enlace dentro de texto en negrita no siempre resalta.
 * Va una sola vez, en el índice (el primer mensaje que ve el cliente): la
 * vista completa y la de un día no lo repiten.
 */
const EXERCISE_LINK_HINT = '👆 Toca el nombre de un ejercicio para ver fotos de cómo hacerlo\\.';

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
 * SPEC-030 regla 10: la v2 (o más) llega presentada como tal, para que el
 * cliente no la confunda con la primera. Compartido entre las dos vistas
 * (índice y completa): el índice es el primer mensaje desde SPEC-031, así
 * que es ahí donde este aviso tiene que aparecer para que el cliente lo vea.
 */
function saludoInicial(context: ClientContext): string {
  return context.versionNumber > 1
    ? `👋 Hola ${escapeMarkdownV2(context.clientName)}, aquí está tu rutina actualizada\\.`
    : `👋 Hola ${escapeMarkdownV2(context.clientName)}, tu rutina está lista\\.`;
}

/**
 * Devuelve un único texto, con los bloques separados por una línea en
 * blanco: `packBlocks`/`sendLongMessage` (SPEC-029 §6) son quienes lo parten
 * en varios mensajes si no cabe.
 */
export function formatForClient(workout: Workout, context: ClientContext): string {
  const bloques: string[] = [saludoInicial(context)];

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

/**
 * SPEC-031 regla 1 — la vista de índice del cliente: la misma cabecera de
 * siempre (saludo, objetivo si hubo evaluación, resumen) y un renglón por
 * día, sin ejercicios. Es el primer mensaje que recibe al entregarse la
 * rutina o pedir `/rutina`; `formatForClient` queda para «Ver todo».
 */
export function formatIndexForClient(workout: Workout, context: ClientContext): string {
  const bloques: string[] = [saludoInicial(context)];

  if (context.plan !== null) {
    bloques.push(
      `🎯 ${escapeMarkdownV2(context.plan.goal)} · ${context.plan.daysPerWeek} días · ` +
        `${context.plan.sessionMinutes} min`,
    );
  }

  bloques.push(escapeMarkdownV2(cleanFreeText(workout.summary)));
  bloques.push(formatDayIndex(workout));
  bloques.push(EXERCISE_LINK_HINT);

  return bloques.filter((bloque) => bloque.length > 0).join('\n\n');
}
