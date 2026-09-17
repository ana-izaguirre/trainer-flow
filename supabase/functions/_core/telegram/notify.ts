/**
 * SPEC-003 — Lo que el entrenador recibe en Telegram.
 *
 * Hasta ahora el sistema hacía todo bien y no se lo decía a nadie: llegaba una
 * evaluación, se creaban las cuatro filas, y el entrenador se enteraba si
 * miraba la base de datos.
 *
 * ┌─ EL DETALLE DE UNA LESIÓN NO VA EN EL AVISO ───────────────────────────┐
 * │ El aviso de llegada dice QUE hay limitaciones, no cuáles. Un mensaje de│
 * │ Telegram se ve en la pantalla de bloqueo, con el móvil encima de la    │
 * │ mesa; la limitación se lee al abrir la rutina, que es donde hace falta.│
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Qué pasa al pulsar cada botón es SPEC-004. Aquí solo se compone el mensaje.
 */
import type { Level } from '../domain/assessment.ts';
import type { Workout } from '../domain/workout.ts';
import type { AIFailureReason } from '../ports/ai-provider.ts';
import { escapeMarkdownV2, formatWorkout, type FormatContext } from './format.ts';
import {
  buildKeyboard,
  DRAFT_ACTIONS,
  FALLBACK_ACTIONS,
  type InlineKeyboard,
} from './keyboard.ts';

export interface Notification {
  readonly text: string;
  /** `null` cuando el aviso no pide ninguna decisión. */
  readonly keyboard: InlineKeyboard | null;
}

export interface AssessmentSummary {
  readonly clientName: string;
  readonly goal: string;
  readonly level: Level;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
  readonly equipment: string;
  readonly hasLimitations: boolean;
  /** Se acepta para que quien llama no tenga que filtrarlo: aquí NO se usa. */
  readonly limitationsDetail?: string | null;
}

/** Corto, para leer de un vistazo. El prompt usa otros, más explicativos. */
const NIVEL: Readonly<Record<Level, string>> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
};

const MOTIVO: Readonly<Record<AIFailureReason, string>> = {
  RATE_LIMITED: 'La IA no tiene margen de cuota ahora mismo.',
  TIMEOUT: 'La IA tardó demasiado en responder.',
  API_ERROR: 'La IA no respondió.',
  INVALID_OUTPUT: 'La IA devolvió una rutina que no se pudo leer.',
};

/**
 * Llegó una evaluación nueva.
 *
 * Sin botones: la generación arranca sola. El entrenador no tiene que pedir
 * el borrador — decide al APROBARLO, que es donde vive el principio.
 */
export function buildAssessmentArrived(
  summary: AssessmentSummary,
  _versionId: string,
): Notification {
  const lines = [
    `📋 *Nueva evaluación: ${escapeMarkdownV2(summary.clientName)}*`,
    '',
    `Objetivo: ${escapeMarkdownV2(summary.goal)}`,
    `Nivel: ${NIVEL[summary.level]}`,
    `${summary.daysPerWeek} días · ${summary.sessionMinutes} min`,
    `Material: ${escapeMarkdownV2(summary.equipment)}`,
  ];

  // El QUÉ, no el CUÁL. Ver el recuadro de arriba.
  if (summary.hasLimitations) {
    lines.push('', '⚠️ Declaró limitaciones \\(las verás en la rutina\\)');
  }

  lines.push('', 'Preparando el borrador\\.\\.\\.');

  return { text: lines.join('\n'), keyboard: null };
}

/** El borrador está listo y hay que decidir sobre él. */
export function buildDraftReady(
  workout: Workout,
  context: FormatContext,
  versionId: string,
): Notification {
  return {
    text: formatWorkout(workout, context),
    keyboard: buildKeyboard(DRAFT_ACTIONS, versionId),
  };
}

/**
 * La IA no pudo, y el producto sigue.
 *
 * Los botones son la degradación del ADR-005 hecha interfaz: decir «la IA
 * falló» sin ofrecer por dónde seguir deja al entrenador mirando un mensaje.
 */
export function buildGenerationFailed(
  reason: AIFailureReason,
  versionId: string,
): Notification {
  return {
    text: [
      `⚠️ ${escapeMarkdownV2(MOTIVO[reason])}`,
      '',
      'Puedes seguir con una plantilla o escribirla a mano, sobre esta misma versión\\.',
    ].join('\n'),
    keyboard: buildKeyboard(FALLBACK_ACTIONS, versionId),
  };
}
