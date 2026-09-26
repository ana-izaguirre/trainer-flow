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
import type { VersionState } from '../domain/version.ts';
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
  revise: '✏️ Crear v2',
  intake: '📄 Ver evaluación',
  link: '🔗 Reenviar enlace',
  reassess: '📝 Pedir actualización',
};

/**
 * Lo que se puede hacer con una versión que aún no tiene contenido.
 *
 * Son las tres fuentes del principio 2, hechas interfaz: las tres producen un
 * `WorkoutDraft` y pasan por la misma validación. Que la IA sea la primera no
 * la hace especial — es la que más tarda, nada más.
 */
export const NEW_ACTIONS: readonly CallbackAction[] = [
  'intake',
  'generate',
  'template',
  'manual',
];

/**
 * Lo que el entrenador puede hacer con un borrador.
 *
 * Aprobar y rechazar NO aparecen sobre una versión en `NEW`: no se puede
 * aprobar lo que todavía no existe (SPEC-003 regla 8).
 */
export const DRAFT_ACTIONS: readonly CallbackAction[] = ['edit', 'approve', 'reject'];

/**
 * Lo que el CLIENTE puede hacer con la rutina que recibió (SPEC-010).
 *
 * Sin estos dos botones, «pedir un cambio» sería una función que el cliente
 * nunca ve y la spec entera no existiría en la práctica (regla 10).
 */
export const CLIENT_ACTIONS: readonly CallbackAction[] = ['accept', 'change'];

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
 * Qué se puede hacer con la versión vigente de un cliente, según su estado.
 *
 * La usan la ficha de `/cliente` (SPEC-007 regla 7) y el aviso de datos
 * actualizados (SPEC-027): los mismos botones en los dos sitios. El porqué de
 * cada exclusión está junto a `keyboardForDetail` y en docs/STATE-MACHINE.md.
 */
export function actionsForState(state: VersionState | null): readonly CallbackAction[] {
  switch (state) {
    case 'NEW':
      return NEW_ACTIONS;
    case 'GENERATING':
      return ['intake'];
    case 'DRAFT':
      return ['approve', 'reject', 'intake'];
    case 'APPROVED':
      return ['reject', 'intake'];
    case 'SENT':
    case 'REJECTED':
      return ['revise', 'intake'];
    default:
      return [];
  }
}

/**
 * Una fila por defecto: en un móvil tres botones caben sin apretarse.
 *
 * `extraRow` es la excepción, no la norma: SPEC-007 regla 7 la usa para
 * separar «reenviar enlace» de los botones que dependen del estado de la
 * rutina, porque son dos preguntas distintas y meter un quinto botón de
 * texto largo en la misma fila se aprieta en un móvil.
 *
 * `null` sin ninguna acción: un `inline_keyboard: [[]]` hace que Telegram
 * devuelva 400, y ese error aparecería lejos de su causa.
 */
export function buildKeyboard(
  actions: readonly CallbackAction[],
  versionId: string,
  extraRow: readonly CallbackAction[] = [],
): InlineKeyboard | null {
  const filas = [actions, extraRow].filter((fila) => fila.length > 0);
  if (filas.length === 0) return null;

  return {
    inline_keyboard: filas.map((fila) =>
      fila.map((action) => ({
        text: ETIQUETAS[action],
        callback_data: buildCallbackData(action, versionId),
      })),
    ),
  };
}
