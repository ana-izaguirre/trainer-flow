/**
 * SPEC-003 — Los botones que acompañan a un aviso.
 *
 * ┌─ EL LÍMITE DE 64 BYTES ────────────────────────────────────────────────┐
 * │ Telegram acota `callback_data` a 64 bytes. Pasarse NO da error al      │
 * │ construirlo: Telegram rechaza el mensaje entero al enviarlo, y el      │
 * │ entrenador se queda sin aviso sin que nadie sepa por qué.              │
 * │                                                                        │
 * │ `buildCallbackData` ya lo respeta; aquí hay un test que lo comprueba   │
 * │ para cada botón que se llegue a añadir.                                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Qué hace cada botón al pulsarse es SPEC-004. Esto solo los dibuja.
 */
import { buildCallbackData, type CallbackAction } from './callback-data.ts';

export interface InlineButton {
  readonly text: string;
  readonly callback_data: string;
}

export interface InlineKeyboard {
  readonly inline_keyboard: readonly (readonly InlineButton[])[];
}

/** El texto de cada acción. Con emoji: se leen de un vistazo en el móvil. */
const ETIQUETAS: Readonly<Record<CallbackAction, string>> = {
  approve: '✅ Aprobar',
  reject: '❌ Rechazar',
  edit: '✏️ Editar',
  template: '📋 Plantilla',
  manual: '✍️ A mano',
  accept: '👍 Me sirve',
  change: '✏️ Pedir un cambio',
};

/** Lo que el entrenador puede hacer con un borrador. */
export const DRAFT_ACTIONS: readonly CallbackAction[] = ['edit', 'approve', 'reject'];

/**
 * Las dos salidas que quedan cuando la IA no puede.
 *
 * Decir «la IA falló» sin ofrecer por dónde seguir deja al entrenador mirando
 * un mensaje (ADR-005).
 */
export const FALLBACK_ACTIONS: readonly CallbackAction[] = ['template', 'manual'];

/**
 * Una sola fila: en un móvil tres botones caben sin apretarse.
 *
 * `null` sin acciones: un `inline_keyboard: [[]]` hace que Telegram devuelva
 * 400, y ese error aparecería lejos de su causa.
 */
export function buildKeyboard(
  actions: readonly CallbackAction[],
  versionId: string,
): InlineKeyboard | null {
  if (actions.length === 0) return null;

  return {
    inline_keyboard: [
      actions.map((action) => ({
        text: ETIQUETAS[action],
        callback_data: buildCallbackData(action, versionId),
      })),
    ],
  };
}
