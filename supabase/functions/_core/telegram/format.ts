/**
 * Formateo de mensajes para Telegram.
 *
 * Dos límites que Telegram no perdona:
 *
 *   · **4096 caracteres por mensaje.** Pasarse devuelve un error de la API.
 *   · **MarkdownV2 rompe el mensaje ENTERO** si un carácter especial va sin
 *     escapar. Y el nombre del cliente lo escribe un desconocido en Tally.
 */
import type { Workout } from '../domain/workout.ts';

export const TELEGRAM_MAX_MESSAGE = 4096;

/** La lista exacta de la documentación de Telegram, más la barra invertida. */
const MARKDOWN_V2_SPECIALS = /[\\_*[\]()~`>#+\-=|{}.!]/g;

/**
 * Escapa el texto para MarkdownV2.
 *
 * Se aplica a TODO texto que no controlemos: nombres de cliente, nombres de
 * ejercicio, notas. Un `[` sin escapar no da un error claro: Telegram rechaza
 * el mensaje completo.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_SPECIALS, (char) => `\\${char}`);
}

/**
 * Divide un texto en mensajes que quepan en Telegram.
 *
 * Corta por líneas para no partir una frase por la mitad. Una línea que por sí
 * sola supera el límite se parte igual, porque no hay alternativa.
 */
export function splitMessage(text: string, maxLength = TELEGRAM_MAX_MESSAGE): string[] {
  if (text.trim().length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  for (const line of text.split('\n')) {
    if (line.length > maxLength) {
      // Una sola línea más larga que el límite: se parte a lo bruto.
      flush();
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
      continue;
    }

    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > maxLength) {
      flush();
      current = line;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}

export interface FormatContext {
  readonly clientName: string;
  readonly versionNumber: number;
}

/**
 * La rutina, formateada para que el entrenador la lea en el móvil.
 *
 * Los ejercicios van numerados a propósito: ese número es el que se usa en
 * `/quitar <día> <n>` y `/nota <día> <n>`.
 */
export function formatWorkout(workout: Workout, context: FormatContext): string {
  const lines: string[] = [];

  lines.push(`🏋️ *Rutina para ${escapeMarkdownV2(context.clientName)}* \\(v${context.versionNumber}\\)`);
  lines.push('');
  lines.push(escapeMarkdownV2(workout.summary));

  for (const day of workout.days) {
    lines.push('');
    lines.push(`━━━ *Día ${day.dayNumber} — ${escapeMarkdownV2(day.focus)}* ━━━`);

    day.exercises.forEach((exercise, index) => {
      const head =
        `${index + 1}\\. ${escapeMarkdownV2(exercise.name)} — ` +
        `${exercise.sets}x${escapeMarkdownV2(exercise.reps)} · ${exercise.restSeconds}s`;
      lines.push(head);

      if (exercise.notes !== null) {
        lines.push(`   _${escapeMarkdownV2(exercise.notes)}_`);
      }
    });
  }

  if (workout.warnings.length > 0) {
    lines.push('');
    for (const warning of workout.warnings) {
      lines.push(`⚠️ ${escapeMarkdownV2(warning)}`);
    }
  }

  return lines.join('\n');
}
