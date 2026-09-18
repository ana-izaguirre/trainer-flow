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
  NEW_ACTIONS,
  RETRYABLE_FALLBACK_ACTIONS,
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

/**
 * Los motivos que se arreglan volviendo a intentarlo.
 *
 * Es la misma lista que la de los reintentos automáticos de
 * `_core/ai/generate-version.ts`: sin cuota o con una respuesta ilegible, un
 * botón de reintentar fallaría igual.
 */
const REINTENTABLES: readonly AIFailureReason[] = ['API_ERROR', 'TIMEOUT'];

const MOTIVO: Readonly<Record<AIFailureReason, string>> = {
  RATE_LIMITED: 'La IA no tiene margen de cuota ahora mismo.',
  TIMEOUT: 'La IA tardó demasiado en responder.',
  API_ERROR: 'La IA no respondió.',
  INVALID_OUTPUT: 'La IA devolvió una rutina que no se pudo leer.',
};

/**
 * Llegó una evaluación nueva.
 *
 * ┌─ ANTES ESTE AVISO MENTÍA ──────────────────────────────────────────────┐
 * │ Decía «Preparando el borrador...» y no se preparaba nada: el disparo   │
 * │ automático de la generación nunca llegó a cablearse, así que el        │
 * │ entrenador esperaba un mensaje que no iba a llegar.                    │
 * │                                                                        │
 * │ Ahora pregunta, y las tres respuestas son botones. Que la primera      │
 * │ acción sobre una rutina sea suya, y no del sistema, es la forma más    │
 * │ barata de que «la IA propone» sea literal (SPEC-001 regla 8).          │
 * └────────────────────────────────────────────────────────────────────────┘
 */
export function buildAssessmentArrived(
  summary: AssessmentSummary,
  versionId: string,
  deepLink: string,
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

  // SPEC-014: el enlace de vinculación, para reenviárselo.
  //
  // El token se genera al ingerir y se guardaba sin que nadie lo entregara:
  // sin este renglón el cliente no puede vincularse, y su rutina aprobada se
  // queda en `APPROVED` para siempre.
  //
  // Se escapa como cualquier otro texto: base64url produce `-` y `_`, que en
  // MarkdownV2 son caracteres especiales.
  lines.push(
    '',
    `🔗 Mándale este enlace a ${escapeMarkdownV2(summary.clientName)} para que reciba su rutina:`,
    escapeMarkdownV2(deepLink),
  );

  lines.push('', '¿Cómo preparamos la rutina?');

  return { text: lines.join('\n'), keyboard: buildKeyboard(NEW_ACTIONS, versionId) };
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
  const sePuedeReintentar = REINTENTABLES.includes(reason);

  return {
    text: [
      `⚠️ ${escapeMarkdownV2(MOTIVO[reason])}`,
      '',
      sePuedeReintentar
        ? 'Puedes reintentar, o seguir con una plantilla o a mano, sobre esta misma versión\\.'
        : 'Puedes seguir con una plantilla o escribirla a mano, sobre esta misma versión\\.',
    ].join('\n'),
    keyboard: buildKeyboard(
      sePuedeReintentar ? RETRYABLE_FALLBACK_ACTIONS : FALLBACK_ACTIONS,
      versionId,
    ),
  };
}
