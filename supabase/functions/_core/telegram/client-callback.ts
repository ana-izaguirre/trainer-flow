/**
 * SPEC-022 M4 — El botón que abre la ficha de UN cliente.
 *
 * `/cliente Ana` con dos Anas listaba los nombres como texto, y había que
 * volver a escribir el comando con el apellido. Cada nombre es ahora un botón.
 *
 * ┌─ POR QUÉ UN PREFIJO PROPIO ────────────────────────────────────────────┐
 * │ No es una acción sobre una versión (`act:`), ni la elección de una     │
 * │ plantilla (`tpl:`): es elegir a QUIÉN mirar. Igual que los demás, es   │
 * │ un literal distinto y no puede confundirse con ellos.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Ocupa 40 de los 64 bytes de Telegram.
 *
 * Que el id tenga forma de UUID **no lo hace válido ni ajeno**: la ficha solo
 * se abre si el cliente está en la cartera de quien pulsa (`showClient`).
 */

const PREFIX = 'cli';

const PATTERN = /^cli:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface ClientChoice {
  readonly clientId: string;
}

export function buildClientCallback(clientId: string): string {
  return `${PREFIX}:${clientId}`;
}

/** `null` ante cualquier cosa que no sea exactamente lo esperado. */
export function parseClientCallback(raw: string): ClientChoice | null {
  const clientId = PATTERN.exec(raw)?.[1]?.toLowerCase();
  return clientId === undefined ? null : { clientId };
}
