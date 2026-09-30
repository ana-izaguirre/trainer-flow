/**
 * SPEC-004 — Lo que las acciones del entrenador necesitan del exterior.
 */
import type { VersionRef, VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';
import type { PlanSummary } from '../telegram/client-format.ts';

export interface VersionForAction extends VersionRef {
  readonly clientName: string;
  readonly versionNumber: number;
  /** Para volver a pintar la rutina cuando hace falta. */
  readonly content: Workout | null;
  /**
   * SPEC-031 — para reconstruir la vista de índice o completa del CLIENTE al
   * navegar. `null` en una rutina manual o de plantilla (SPEC-005 regla 13),
   * igual que en `VersionForDelivery`.
   */
  readonly plan: PlanSummary | null;
  /**
   * Lo que el cliente pidió. Hace falta para validar AL APROBAR: es la última
   * puerta antes de que una rutina salga, y la única por la que pasa una
   * hecha a mano (SPEC-008 regla 11).
   *
   * `null` en un plan sin evaluación de Tally: entonces se valida la forma,
   * no el encaje con unos criterios que no existen.
   */
  readonly constraints: { readonly daysPerWeek: number; readonly hasLimitations: boolean } | null;
}

export interface ActionRepo {
  findVersion(versionId: string): Promise<VersionForAction | null>;

  /**
   * Aplica una transición **ya validada por la máquina de estados**.
   *
   * `false` si el estado esperado ya no es el actual: alguien se adelantó.
   * Es la guarda contra la doble pulsación, no un error.
   */
  transition(versionId: string, from: VersionState, to: VersionState): Promise<boolean>;
}
