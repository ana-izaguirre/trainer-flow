/**
 * Máquina de estados de una versión de rutina.
 *
 * Especificación: `docs/STATE-MACHINE.md`. La tabla `TRANSITIONS` de abajo es
 * esa tabla, escrita en TypeScript. Si cambia una, cambia la otra.
 *
 * ┌─ LA GARANTÍA ──────────────────────────────────────────────────────────┐
 * │ `DRAFT → SENT` no existe. El único camino a `SENT` sale de `APPROVED`, │
 * │ y a `APPROVED` solo se llega con `DRAFT + APPROVE`, que es la decisión │
 * │ del entrenador. Ninguna rutina llega al cliente sin que él la apruebe. │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Qué responde este módulo:  ¿es legal esta transición desde este estado?
 * Qué NO responde:           ¿quién eres? → authorization.ts
 *
 * Sin dependencias, sin I/O: es una tabla de consulta y tres funciones.
 * No se usa XState porque 6 estados no justifican una librería, y meterla en
 * `_core` rompería el ADR-001.
 */
import type { VersionState } from './version.ts';

export type VersionEvent =
  /** El entrenador pide generar con IA. */
  | 'GENERATE'
  /** El entrenador carga una plantilla de `_core/templates.ts`. */
  | 'LOAD_TEMPLATE'
  /** El entrenador escribe la rutina desde cero. */
  | 'CREATE_MANUAL'
  /** El entrenador modifica un borrador. No cambia de etapa. */
  | 'EDIT'
  /** La generación terminó y el draft pasó la validación. */
  | 'GENERATION_SUCCEEDED'
  /** La generación falló: rate limit, timeout o salida inválida. */
  | 'GENERATION_FAILED'
  /** La decisión del entrenador. */
  | 'APPROVE'
  | 'REJECT'
  /** El sistema entrega la rutina al cliente. */
  | 'SEND';

export const VERSION_EVENTS: readonly VersionEvent[] = [
  'GENERATE',
  'LOAD_TEMPLATE',
  'CREATE_MANUAL',
  'EDIT',
  'GENERATION_SUCCEEDED',
  'GENERATION_FAILED',
  'APPROVE',
  'REJECT',
  'SEND',
];

/**
 * Las 11 transiciones válidas. Todo lo que no esté aquí es inválido.
 *
 * `SENT` y `REJECTED` están vacíos a propósito: son terminales.
 */
const TRANSITIONS: Readonly<
  Record<VersionState, Readonly<Partial<Record<VersionEvent, VersionState>>>>
> = {
  NEW: {
    GENERATE: 'GENERATING',
    LOAD_TEMPLATE: 'DRAFT',
    CREATE_MANUAL: 'DRAFT',
    REJECT: 'REJECTED',
  },
  GENERATING: {
    GENERATION_SUCCEEDED: 'DRAFT',
    // Vuelve a NEW, no a un estado muerto: el entrenador sigue por plantilla
    // o manual sobre la misma versión. El motivo queda en ai_generations.
    GENERATION_FAILED: 'NEW',
  },
  DRAFT: {
    // Editar un borrador lo modifica in-place: no crea versión ni cambia etapa.
    EDIT: 'DRAFT',
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
  },
  APPROVED: {
    // Solo si el cliente está vinculado. Esa comprobación es del handler.
    SEND: 'SENT',
    REJECT: 'REJECTED',
  },
  SENT: {},
  REJECTED: {},
};

/**
 * El estado resultante, o `null` si la transición no existe.
 *
 * Ningún `UPDATE` de estado debe ocurrir sin pasar por aquí (ADR-004).
 */
export function nextState(from: VersionState, event: VersionEvent): VersionState | null {
  return TRANSITIONS[from][event] ?? null;
}

/** Un estado terminal no acepta ningún evento. */
export function isTerminal(state: VersionState): boolean {
  return Object.keys(TRANSITIONS[state]).length === 0;
}

/** Los eventos válidos desde un estado. Útil para construir los botones. */
export function allowedEvents(from: VersionState): readonly VersionEvent[] {
  return VERSION_EVENTS.filter((event) => nextState(from, event) !== null);
}
