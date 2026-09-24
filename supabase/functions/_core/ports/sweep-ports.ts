/**
 * SPEC-002 §11 — Lo que el barrido de generaciones atascadas necesita.
 */
import type { VersionState } from '../domain/version.ts';

export interface StaleGeneration {
  readonly versionId: string;
  readonly trainerChatId: number;
  readonly clientName: string;
  /** Solo para el aviso: cuánto lleva atascada. */
  readonly minutesStuck: number;
}

export interface SweepRepo {
  /** Las que llevan más de `minMinutes` en GENERATING. */
  staleGenerations(minMinutes: number): Promise<readonly StaleGeneration[]>;

  /**
   * La misma guarda de concurrencia de siempre: `false` si el estado
   * esperado ya no es el actual. Aquí es lo que evita pisar una generación
   * que en realidad sí terminó un instante antes del barrido.
   */
  transition(versionId: string, from: VersionState, to: VersionState): Promise<boolean>;
}
