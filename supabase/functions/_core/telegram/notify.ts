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
import { formatChanges, type AssessmentChange } from '../assessment/changes.ts';
import type { Level } from '../domain/assessment.ts';
import type { VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';
import type { AIFailureReason } from '../ports/ai-provider.ts';
import { escapeMarkdownV2, formatWorkout, type FormatContext } from './format.ts';
import {
  actionsForState,
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

export const MOTIVO: Readonly<Record<AIFailureReason, string>> = {
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

/**
 * SPEC-027 §8 — La línea que se antepone al aviso de evaluación nueva cuando
 * llegó con un enlace de actualización que ya no vale. No se fusiona nada a
 * ciegas: se crea el cliente, y el entrenador decide si es uno que ya tiene.
 */
export const STALE_UPDATE_LINK =
  '⚠️ Llegó con un enlace de actualización que ya no vale\\. Puede ser un cliente que ya tienes\\.';

/** SPEC-027 — Al cliente, cuando su actualización llegó. Sin datos. */
export const UPDATE_RECEIVED =
  '✅ Recibido\\. Tu entrenador ya tiene tus datos nuevos\\. Tu rutina actual sigue igual hasta que la revise\\.';

export interface AssessmentUpdated {
  readonly clientName: string;
  readonly changes: readonly AssessmentChange[];
  readonly versionId: string | null;
  readonly versionState: VersionState | null;
}

/**
 * SPEC-027 — Un cliente actualizó sus datos.
 *
 * Dice QUÉ cambió (regla 8: lo sensible, solo por nombre) y lleva los mismos
 * botones que la ficha para el estado de su rutina: con una `SENT`, «Crear
 * v2». La rutina no cambia sola; decidir si hace falta otra es del
 * entrenador (principio 1).
 */
export function buildAssessmentUpdated(update: AssessmentUpdated): Notification {
  const nombre = escapeMarkdownV2(update.clientName);
  const teclado = (acciones: Parameters<typeof buildKeyboard>[0]) =>
    update.versionId === null ? null : buildKeyboard(acciones, update.versionId);

  // Regla 9: sin cambios, se dice, y no se ofrece una v2 que no hace falta.
  if (update.changes.length === 0) {
    return {
      text: `📝 ${nombre} volvió a enviar su evaluación, sin cambios\\.`,
      keyboard: teclado(['intake']),
    };
  }

  const lines = [
    `📝 ${nombre} actualizó sus datos`,
    '',
    `Cambió: ${escapeMarkdownV2(formatChanges(update.changes))}`,
  ];

  // Regla 7: ese borrador se hizo con los datos de antes, y al aprobarlo se
  // valida contra los nuevos.
  if (update.versionState === 'DRAFT' || update.versionState === 'GENERATING') {
    lines.push(
      '',
      `⚠️ Tienes un borrador para ${nombre} hecho con los datos anteriores\\. Al aprobarlo se valida contra los nuevos\\.`,
    );
  }

  lines.push('', 'Su rutina actual no cambió\\.');

  return { text: lines.join('\n'), keyboard: teclado(actionsForState(update.versionState)) };
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

/**
 * SPEC-004 — La IA no pudo editar. A diferencia de `buildGenerationFailed`,
 * esta versión YA tenía contenido y sigue en `DRAFT`: no hay «seguir con
 * plantilla o a mano» porque no está en `NEW`. Se conserva tal cual estaba.
 */
export function buildEditFailed(
  reason: AIFailureReason,
  clientName: string,
  versionId: string,
): Notification {
  return {
    text: [
      `⚠️ ${escapeMarkdownV2(MOTIVO[reason])}`,
      '',
      `La rutina de ${escapeMarkdownV2(clientName)} no cambió\\. Puedes reintentar la edición\\.`,
    ].join('\n'),
    keyboard: buildKeyboard(DRAFT_ACTIONS, versionId),
  };
}
