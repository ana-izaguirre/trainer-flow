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
  generate: '🤖 Generar con IA',
  approve: '✅ Aprobar',
  reject: '❌ Rechazar',
  edit: '✏️ Editar',
  template: '📋 Plantilla',
  manual: '✍️ A mano',
  accept: '👍 Me sirve',
  change: '✏️ Pedir un cambio',
};

/**
 * Lo que se puede hacer con una versión que aún no tiene contenido.
 *
 * Son las tres fuentes del principio 2, hechas interfaz: las tres producen un
 * `WorkoutDraft` y pasan por la misma validación. Que la IA sea la primera no
 * la hace especial — es la que más tarda, nada más.
 */
export const NEW_ACTIONS: readonly CallbackAction[] = ['generate', 'template', 'manual'];

/**
 * Lo que el entrenador puede hacer con un borrador.
 *
 * Aprobar y rechazar NO aparecen sobre una versión en `NEW`: no se puede
 * aprobar lo que todavía no existe (SPEC-003 regla 8).
 */
export const DRAFT_ACTIONS: readonly CallbackAction[] = ['edit', 'approve', 'reject'];

/**
 * Las salidas que quedan cuando la IA no puede.
 *
 * Decir «la IA falló» sin ofrecer por dónde seguir deja al entrenador mirando
 * un mensaje (ADR-005).
 *
 * **Reintentar solo aparece cuando puede salir bien.** Sin cuota, o con una
 * respuesta ilegible, el botón fallaría igual: gastaría una pulsación, haría
 * esperar, y enseñaría al entrenador a desconfiar de los botones. Es la misma
 * lista que la de los reintentos automáticos, y por la misma razón.
 */
export const FALLBACK_ACTIONS: readonly CallbackAction[] = ['template', 'manual'];

export const RETRYABLE_FALLBACK_ACTIONS: readonly CallbackAction[] = [
  'generate',
  'template',
  'manual',
];

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
