/**
 * Los datos que viajan dentro de un botón de Telegram.
 *
 * Formato: `act:<accion>:<versionId>`
 *
 * Telegram limita `callback_data` a **64 bytes**, y pasarse no da un error
 * claro: el botón simplemente deja de responder. Por eso hay un test que mide
 * cada acción con el UUID más largo posible.
 *
 * El `callback_data` es dato NO confiable: cualquiera puede fabricar uno. Lo
 * que impide usarlo para tocar la versión de otro cliente no es este módulo,
 * sino `authorization.ts`, que comprueba la pertenencia después.
 */

export const CALLBACK_ACTIONS = [
  'generate',
  'approve',
  'reject',
  'edit',
  'template',
  'manual',
  'accept',
  'change',
  'revise',
] as const;

export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];

export interface CallbackPayload {
  readonly action: CallbackAction;
  readonly versionId: string;
}

const PREFIX = 'act';

/**
 * Prefijo, acción y UUID canónico, en un solo patrón.
 *
 * Va en un regex y no en un `split` para que no queden ramas imposibles de
 * alcanzar: con `split`, comprobar que las partes existen después de verificar
 * que hay tres es código muerto que nunca se puede probar.
 */
const CALLBACK_PATTERN =
  /^act:([A-Za-z]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function buildCallbackData(action: CallbackAction, versionId: string): string {
  return `${PREFIX}:${action}:${versionId}`;
}

function isKnownAction(value: string): value is CallbackAction {
  return (CALLBACK_ACTIONS as readonly string[]).includes(value);
}

/** Devuelve `null` ante cualquier cosa que no sea exactamente lo esperado. */
export function parseCallbackData(raw: string): CallbackPayload | null {
  const match = CALLBACK_PATTERN.exec(raw);
  const rawAction = match?.[1];
  const versionId = match?.[2];
  if (rawAction === undefined || versionId === undefined) return null;

  const action = rawAction.toLowerCase();
  if (!isKnownAction(action)) return null;

  return { action, versionId };
}
