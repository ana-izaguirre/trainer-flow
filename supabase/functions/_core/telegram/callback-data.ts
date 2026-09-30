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
  /** SPEC-015: leer la evaluación. Es la única que NO escribe nada. */
  'intake',
  /** SPEC-014 §3: reenviar el enlace de vinculación. Tampoco escribe nada. */
  'link',
  /** SPEC-027: pedirle al cliente que actualice sus datos. Emite un token. */
  'reassess',
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

/**
 * Devuelve `null` ante cualquier cosa que no sea exactamente lo esperado.
 *
 * Hallado con mutation testing (Stryker): la guarda de abajo es redundante,
 * y por una razón estructural, no de descuido. `rawAction` y `versionId`
 * salen del MISMO `match`: si el regex no matchea, `match` es `null` y los
 * dos son `undefined` A LA VEZ; si matchea, sus dos grupos de captura son
 * obligatorios (no `?` en el patrón), así que los dos existen a la vez.
 * Nunca hay un estado intermedio donde uno sea `undefined` y el otro no —
 * por eso cambiar `||` por `&&`, o forzar cualquiera de los dos operandos a
 * `false`, no cambia el resultado para ningún input real.
 */
export function parseCallbackData(raw: string): CallbackPayload | null {
  const match = CALLBACK_PATTERN.exec(raw);
  const rawAction = match?.[1];
  const versionId = match?.[2];
  // Stryker disable next-line all: ver el comentario de la función.
  if (rawAction === undefined || versionId === undefined) return null;

  const action = rawAction.toLowerCase();
  if (!isKnownAction(action)) return null;

  return { action, versionId };
}

/**
 * SPEC-031 — qué vista de la rutina se pide. Solo cambia qué se muestra:
 * nunca escribe nada, así que vive separado de `CallbackAction` (que son
 * decisiones sobre el dominio) para que `actionsForState` no tenga que
 * filtrar acciones que no lo son.
 */
export type RoutineView =
  | { readonly kind: 'index' }
  | { readonly kind: 'day'; readonly dayNumber: number }
  | { readonly kind: 'full' };

export interface NavPayload {
  readonly view: RoutineView;
  readonly versionId: string;
}

const NAV_PREFIX = 'nav';

/**
 * `nav:idx:<id>`, `nav:full:<id>` o `nav:d<N>:<id>`. `N` entre 1 y 99: dos
 * dígitos de sobra frente a `WORKOUT_LIMITS.dayNumber.max` (7), para que un
 * `callback_data` fabricado a mano no rompa el parseo en vez de, simplemente,
 * no encontrar el día (regla 12 de SPEC-031).
 */
const NAV_PATTERN =
  /^nav:(idx|full|d([1-9][0-9]?)):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function buildNavCallback(view: RoutineView, versionId: string): string {
  const vista = view.kind === 'index' ? 'idx' : view.kind === 'full' ? 'full' : `d${view.dayNumber}`;
  return `${NAV_PREFIX}:${vista}:${versionId}`;
}

/**
 * Hallado con mutation testing, mismo patrón que `parseCallbackData` arriba:
 * `vista` y `versionId` salen del mismo `match`, así que son `undefined` a
 * la vez o ninguno lo es. El segundo `?.` de `match?.[1]?.toLowerCase()` es
 * igual de redundante: el grupo 1 (`idx|full|d(...)`) no tiene alternativa
 * vacía, así que si el regex matchea, siempre captura algo.
 */
export function parseNavCallback(raw: string): NavPayload | null {
  const match = NAV_PATTERN.exec(raw);
  // Stryker disable next-line OptionalChaining: ver el comentario de la función.
  const vista = match?.[1]?.toLowerCase();
  const dia = match?.[2];
  const versionId = match?.[3];
  // Stryker disable next-line all: ver el comentario de la función.
  if (vista === undefined || versionId === undefined) return null;

  const view: RoutineView =
    vista === 'idx'
      ? { kind: 'index' }
      : vista === 'full'
        ? { kind: 'full' }
        : { kind: 'day', dayNumber: Number(dia) };

  return { view, versionId };
}
