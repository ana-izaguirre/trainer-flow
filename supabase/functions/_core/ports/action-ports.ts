/**
 * SPEC-004 — Lo que las acciones del entrenador necesitan del exterior.
 */
import type { VersionRef, VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';

export interface VersionForAction extends VersionRef {
  readonly clientName: string;
  readonly versionNumber: number;
  /** Para volver a pintar la rutina cuando hace falta. */
  readonly content: Workout | null;
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
