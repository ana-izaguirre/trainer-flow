/**
 * SPEC-005 regla 5 — La rutina, como la ve el cliente.
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
 */
import type { Workout } from '../domain/workout.ts';
import { escapeMarkdownV2 } from './format.ts';

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
}

export function formatForClient(workout: Workout, context: ClientContext): string {
  const lines: string[] = [
    `👋 Hola ${escapeMarkdownV2(context.clientName)}, tu rutina está lista\\.`,
  ];

  // Sin evaluación no hay objetivo que mostrar. Se omite la línea: inventarla
  // sería mentir, y no enviarla dejaría al cliente sin rutina (regla 13).
  if (context.plan !== null) {
    lines.push(
      '',
      `🎯 ${escapeMarkdownV2(context.plan.goal)} · ${context.plan.daysPerWeek} días · ` +
        `${context.plan.sessionMinutes} min`,
    );
  }

  lines.push('', escapeMarkdownV2(workout.summary));

  for (const day of workout.days) {
    lines.push('');
    lines.push(`━━━ *Día ${day.dayNumber} — ${escapeMarkdownV2(day.focus)}* ━━━`);

    for (const exercise of day.exercises) {
      lines.push(
        `• ${escapeMarkdownV2(exercise.name)} — ` +
          `${exercise.sets}x${escapeMarkdownV2(exercise.reps)} · descanso ${exercise.restSeconds}s`,
      );

      if (exercise.notes !== null) {
        lines.push(`   _${escapeMarkdownV2(exercise.notes)}_`);
      }
    }
  }

  // Aquí NO va un bloque de warnings. Ver el recuadro de arriba.
  lines.push('', '💬 Cualquier duda, habla con tu entrenador\\.');

  return lines.join('\n');
}
