/**
 * Formateo de mensajes para Telegram.
 *
 * Dos límites que Telegram no perdona:
 *
 *   · **4096 caracteres por mensaje.** Pasarse devuelve un error de la API.
 *   · **MarkdownV2 rompe el mensaje ENTERO** si un carácter especial va sin
 *     escapar. Y el nombre del cliente lo escribe un desconocido en Tally.
 *
 * SPEC-029 exige además que se LEA bien: un ejercicio es un bloque de 2-3
 * líneas, el descanso se dice en palabras y nada del Markdown que el modelo
 * mete por costumbre (`**negrita**`, viñetas) llega al chat sin procesar.
 */
import type { Exercise, Workout, WorkoutDay } from '../domain/workout.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import type { InlineKeyboard } from './keyboard.ts';

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
 *
 * Es el último recurso de `packBlocks`: para un `Workout` formateado, la
 * división por bloques (§ más abajo) es la que respeta los ejercicios.
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

/**
 * SPEC-029 §6 — divide un texto en mensajes por BLOQUE, no por línea.
 *
 * Un bloque es lo que separa una línea en blanco: la cabecera de un día, o
 * un ejercicio entero con su nota. `formatWorkout` y `formatForClient`
 * construyen el texto así a propósito, para que cortar aquí nunca parta un
 * ejercicio por la mitad.
 *
 * Un bloque que por sí solo no cabe (rarísimo: haría falta una nota al
 * límite de `WORKOUT_LIMITS`) se parte con `splitMessage`, como último
 * recurso.
 */
export function packBlocks(text: string, maxLength = TELEGRAM_MAX_MESSAGE): string[] {
  if (text.trim().length === 0) return [];

  const blocks = text.split('\n\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentLength = 0;
    }
  };

  for (const block of blocks) {
    if (block.length > maxLength) {
      flush();
      chunks.push(...splitMessage(block, maxLength));
      continue;
    }

    const nuevaLongitud = currentLength === 0 ? block.length : currentLength + 2 + block.length;
    if (nuevaLongitud > maxLength) {
      flush();
      current = [block];
      currentLength = block.length;
    } else {
      current.push(block);
      currentLength = nuevaLongitud;
    }
  }

  flush();
  return chunks;
}

/**
 * SPEC-029 §6 — manda un texto de rutina, partido si hace falta.
 *
 * El teclado va **solo en el último mensaje**: es donde está la decisión
 * (SPEC-005 regla 10, SPEC-010 regla 10), y ponerlo en cada trozo daría
 * varios botones idénticos.
 */
export async function sendLongMessage(
  sender: TelegramSender,
  chatId: number,
  text: string,
  keyboard: InlineKeyboard | null = null,
): Promise<void> {
  const chunks = packBlocks(text);

  for (let i = 0; i < chunks.length; i++) {
    await sender.sendMessage(chatId, chunks[i]!, i === chunks.length - 1 ? keyboard : null);
  }
}

/**
 * SPEC-029 regla 6 — limpia el Markdown que el modelo mete por costumbre.
 *
 * Actúa SOLO sobre lo que se muestra: lo guardado en `Workout` no cambia.
 * Una rutina manual o de plantilla pasa por aquí igual: si alguien escribe
 * `**fuerte**` a mano, se lee «fuerte», no con los asteriscos.
 */
export function cleanFreeText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]*[-*•]\s+/gm, '')
    .trim();
}

/** `0` → «sin descanso»; menos de 60 → segundos; el resto, minutos y segundos. */
function formatRestSeconds(seconds: number): string {
  if (seconds <= 0) return 'sin descanso';

  const minutos = Math.floor(seconds / 60);
  const segundos = seconds % 60;

  if (minutos === 0) return `${segundos} s`;
  if (segundos === 0) return minutos === 1 ? '1 min' : `${minutos} min`;
  return `${minutos} min ${segundos} s`;
}

/** El guion entre dos números («8-10») se lee como un rango, no como un menos. */
function formatReps(reps: string): string {
  return escapeMarkdownV2(reps.replace(/(\d)\s*-\s*(\d)/g, '$1–$2'));
}

/**
 * SPEC-029 §4 — un ejercicio, como un bloque de 2 o 3 líneas: nombre
 * numerado en negrita, series con su descanso, y la nota si la hay.
 *
 * Compartido por la vista del entrenador y la del cliente: los dos numeran
 * igual, y la numeración del entrenador es la que usan `/quitar` y `/nota`.
 */
export function formatExerciseBlock(exercise: Exercise, number: number): string {
  const lineas = [
    `*${number}\\. ${escapeMarkdownV2(cleanFreeText(exercise.name))}*`,
    `${exercise.sets} × ${formatReps(exercise.reps)} · descanso ${formatRestSeconds(exercise.restSeconds)}`,
  ];

  if (exercise.notes !== null && exercise.notes.trim().length > 0) {
    lineas.push(`💡 ${escapeMarkdownV2(cleanFreeText(exercise.notes))}`);
  }

  return lineas.join('\n');
}

/** `📅 Día N · foco`, en negrita. Sin el `━━━` de antes: se parte feo en el móvil. */
export function formatDayHeader(day: WorkoutDay): string {
  return `📅 *Día ${day.dayNumber} · ${escapeMarkdownV2(cleanFreeText(day.focus))}*`;
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
 *
 * Devuelve un único texto, con los bloques separados por una línea en
 * blanco: `packBlocks` es quien lo parte en varios mensajes si no cabe.
 */
export function formatWorkout(workout: Workout, context: FormatContext): string {
  const bloques: string[] = [
    `🏋️ *Rutina para ${escapeMarkdownV2(context.clientName)}* · v${context.versionNumber}`,
    escapeMarkdownV2(cleanFreeText(workout.summary)),
  ];

  for (const day of workout.days) {
    bloques.push(formatDayHeader(day));
    day.exercises.forEach((exercise, index) => {
      bloques.push(formatExerciseBlock(exercise, index + 1));
    });
  }

  if (workout.warnings.length > 0) {
    bloques.push(
      [
        '⚠️ *Tenido en cuenta*',
        ...workout.warnings.map((warning) => `• ${escapeMarkdownV2(cleanFreeText(warning))}`),
      ].join('\n'),
    );
  }

  return bloques.filter((bloque) => bloque.length > 0).join('\n\n');
}
