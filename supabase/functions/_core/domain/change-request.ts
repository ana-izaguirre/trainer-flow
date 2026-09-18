/**
 * SPEC-010 — Lo que el cliente puede pedir, y cómo viaja.
 *
 * ┌─ EL CLIENTE NUNCA EDITA LA RUTINA ─────────────────────────────────────┐
 * │ Solo elige un motivo de esta lista y, si quiere, escribe un            │
 * │ comentario. Quien produce la versión nueva es el entrenador — es el    │
 * │ principio 1 aplicado al otro extremo del sistema.                      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 63 DE LOS 64 BYTES ───────────────────────────────────────────────────┐
 * │ `chg:uncomfortable_exercise:<uuid>` va JUSTO. Hay un test que mide los │
 * │ siete motivos contra el límite: uno nuevo con nombre largo se vería    │
 * │ ahí, y no en un botón que deja de responder en producción.             │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/** El enum `change_reason` de la base, en el mismo orden. */
export const CHANGE_REASONS = [
  'too_hard',
  'too_easy',
  'too_long',
  'no_equipment',
  'uncomfortable_exercise',
  'want_variety',
  'other',
] as const;

export type ChangeReason = (typeof CHANGE_REASONS)[number];

/** Cómo se le ofrece al cliente, y cómo se le cuenta al entrenador. */
export const REASON_LABELS: Readonly<Record<ChangeReason, string>> = {
  too_hard: '😰 Muy difícil',
  too_easy: '😴 Muy fácil',
  too_long: '⏱️ Muy larga',
  no_equipment: '🏋️ Sin equipo',
  uncomfortable_exercise: '😖 Ejercicio incómodo',
  want_variety: '🔄 Quiero variedad',
  other: '✍️ Otro',
};

const PREFIX = 'chg';

const PATTERN =
  /^chg:([a-z_]{1,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface ChangeChoice {
  readonly reason: ChangeReason;
  readonly versionId: string;
}

export function buildChangeCallback(reason: ChangeReason, versionId: string): string {
  return `${PREFIX}:${reason}:${versionId}`;
}

function isReason(value: string): value is ChangeReason {
  return (CHANGE_REASONS as readonly string[]).includes(value);
}

/** `null` ante cualquier cosa que no sea exactamente uno de los siete. */
export function parseChangeCallback(raw: string): ChangeChoice | null {
  const match = PATTERN.exec(raw);
  const reason = match?.[1]?.toLowerCase();
  const versionId = match?.[2];

  if (reason === undefined || versionId === undefined) return null;
  // Un motivo inventado no se guarda: la columna es un enum y lo rechazaría,
  // pero fallar aquí da un mensaje y no un error de base de datos.
  if (!isReason(reason)) return null;

  return { reason, versionId };
}
