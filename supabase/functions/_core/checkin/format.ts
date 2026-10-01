/**
 * SPEC-006 §3 — Los mensajes del check-in.
 *
 * ┌─ DOS DESTINATARIOS, DOS CRITERIOS ─────────────────────────────────────┐
 * │ Al CLIENTE se le pregunta en tres botones y una línea de texto: un     │
 * │ formulario largo por Telegram no lo contesta nadie.                    │
 * │                                                                        │
 * │ Al ENTRENADOR se le manda lo que el cliente escribió, TAL CUAL. Es la  │
 * │ única forma de que pueda decidir si ajusta algo — y decidir es suyo.   │
 * │ Eso no contradice §7: lo que no puede pasar es que acabe en los LOGS.  │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { escapeMarkdownV2 } from '../telegram/format.ts';
import type { InlineKeyboard } from '../telegram/keyboard.ts';
import {
  buildCheckinCallback,
  FEELING_LABELS,
  type CheckinAnswer,
  type CheckinAnswers,
  type CheckinField,
  type Feeling,
} from './answers.ts';

export interface CheckinMessage {
  readonly text: string;
  readonly keyboard: InlineKeyboard;
}

/** `4` es «4 o más»: por encima de eso la cifra exacta no cambia nada. */
const SESIONES = ['0', '1', '2', '3', '4+'] as const;

/**
 * El check-in que recibe el cliente.
 *
 * Los tres bloques van en un solo mensaje con un solo teclado: tres mensajes
 * seguidos se leen como tres notificaciones y se contesta el último.
 */
export function buildCheckinMessage(weekNumber: number, checkinId: string): CheckinMessage {
  const text = [
    `📊 *Check\\-in semanal* — semana ${weekNumber}`,
    '',
    '1️⃣ ¿Cuántas sesiones completaste?',
    '2️⃣ ¿Cómo te sentiste?',
    '3️⃣ ¿Alguna molestia? Escríbela o pulsa el botón\\.',
  ].join('\n');

  return { text, keyboard: buildCheckinKeyboard(checkinId) };
}

/**
 * El único recordatorio, a las 48 horas (regla 6).
 *
 * Lleva el mismo teclado: si llegara sin botones, el cliente tendría que
 * buscar el mensaje anterior para contestar.
 */
export function buildReminderMessage(weekNumber: number, checkinId: string): CheckinMessage {
  const text = [
    `👋 Se me quedó pendiente tu check\\-in de la semana ${weekNumber}\\.`,
    '',
    'Son tres toques\\.',
  ].join('\n');

  return { text, keyboard: buildCheckinKeyboard(checkinId) };
}

/**
 * Tres filas, una por pregunta.
 *
 * En una sola fila, ocho botones se aprietan hasta ser ilegibles en un móvil.
 */
function buildCheckinKeyboard(checkinId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      SESIONES.map((etiqueta, indice) => ({
        text: etiqueta,
        callback_data: buildCheckinCallback('sessions', String(indice), checkinId),
      })),
      (['hard', 'good', 'easy'] as const).map((feeling) => ({
        text: FEELING_LABELS[feeling],
        callback_data: buildCheckinCallback('feeling', feeling, checkinId),
      })),
      [
        {
          text: '✅ Ninguna molestia',
          callback_data: buildCheckinCallback('discomfort', 'none', checkinId),
        },
      ],
    ],
  };
}

/** Lo que se le confirma al cliente cuando ya contestó las tres. */
export const GRACIAS = '✅ Anotado, gracias\\. Nos vemos la semana que viene\\.';

/** Qué falta preguntar, en el orden en que se listan en `buildCheckinMessage`. */
const PREGUNTA_FALTANTE: Readonly<Record<CheckinField, string>> = {
  sessions: '¿cuántas sesiones?',
  feeling: '¿cómo te sentiste?',
  discomfort: '¿alguna molestia?',
};

const ORDEN_PREGUNTAS: readonly CheckinField[] = ['sessions', 'feeling', 'discomfort'];

/**
 * SPEC-030 regla 9 — el acuse de CADA botón, en el aviso emergente de
 * `answerCallbackQuery`. Texto plano: Telegram no interpreta MarkdownV2 ahí,
 * así que nada se escapa (a diferencia de todo lo demás en este archivo).
 */
export function formatCheckinAck(answer: CheckinAnswer, answers: CheckinAnswers): string {
  const falta = ORDEN_PREGUNTAS.find((campo) => answers[campo] === null) ?? null;
  const base = `Anotado: ${etiquetaRespuesta(answer)}`;

  return falta === null ? base : `${base}. Falta: ${PREGUNTA_FALTANTE[falta]}`;
}

/** Solo la respuesta que se acaba de dar, no las tres. */
function etiquetaRespuesta(answer: CheckinAnswer): string {
  if (answer.field === 'feeling') return FEELING_LABELS[answer.value as Feeling];
  // El botón de `discomfort` solo manda `'none'` (SPEC-006): el texto libre
  // de una molestia llega como mensaje, nunca como este callback.
  if (answer.field === 'discomfort') return 'sin molestias';

  const n = Number.parseInt(answer.value, 10);
  return `${n === 4 ? '4 o más' : n} ${n === 1 ? 'sesión' : 'sesiones'}`;
}

/**
 * El resumen para el entrenador.
 *
 * `sessions` sale sobre el total planificado cuando se sabe: «3 de 4» dice si
 * la semana fue buena; «3» a secas, no.
 */
export function formatCheckinSummary(
  clientName: string,
  weekNumber: number,
  answers: CheckinAnswers,
  daysPerWeek: number | null = null,
): string {
  const sesiones =
    answers.sessions === null
      ? 'sin contestar'
      : `${answers.sessions === 4 ? '4 o más' : answers.sessions}` +
        (daysPerWeek === null ? '' : ` de ${daysPerWeek}`);

  return [
    `📊 *${escapeMarkdownV2(clientName)}* — semana ${weekNumber}`,
    `Sesiones: ${escapeMarkdownV2(sesiones)}`,
    `Sensación: ${answers.feeling === null ? 'sin contestar' : FEELING_LABELS[answers.feeling]}`,
    `Molestias: ${molestiaEnPalabras(answers.discomfort)}`,
  ].join('\n');
}

/**
 * El aviso que sale EN EL MOMENTO (regla 7).
 *
 * Un dolor que aparece el martes y se avisa el domingo es una lesión que se
 * pudo evitar. Por eso este mensaje no espera a nada.
 */
export function formatTrainerAlert(
  clientName: string,
  weekNumber: number,
  answers: CheckinAnswers,
): string {
  const motivo =
    answers.discomfort !== null && answers.discomfort.trim().length > 0
      ? '⚠️ Reportó una molestia'
      : '⚠️ La semana se le hizo muy dura';

  return [
    `${motivo}: *${escapeMarkdownV2(clientName)}*, semana ${weekNumber}`,
    '',
    formatCheckinSummary(clientName, weekNumber, answers),
  ].join('\n');
}

/** `''` es «ninguna», `null` es «no contestó». No son lo mismo. */
function molestiaEnPalabras(discomfort: string | null): string {
  if (discomfort === null) return 'sin contestar';
  if (discomfort.trim().length === 0) return 'ninguna';
  return escapeMarkdownV2(discomfort);
}
