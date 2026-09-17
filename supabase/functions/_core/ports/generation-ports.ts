/**
 * SPEC-002 — Lo que la generación necesita del mundo exterior.
 *
 * Mismo patrón que el resto: `_core` declara qué necesita, `_shared` lo
 * implementa. Aquí no hay ni una consulta SQL ni un `fetch`.
 */
import type { WorkoutConstraints } from '../domain/draft.ts';
import type { VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';
import type { AIFailureReason, AIRequest, TokenUsage } from './ai-provider.ts';

export interface VersionForGeneration {
  readonly versionId: string;
  readonly state: VersionState;
  /** Para el aviso: «rutina lista» sin decir de quién no sirve con varios clientes. */
  readonly clientName: string;
  readonly versionNumber: number;
  /** La evaluación, ya traducida a lo que el proveedor necesita. */
  readonly request: AIRequest;
  readonly constraints: WorkoutConstraints;
  /** A dónde va el aviso cuando algo falla. */
  readonly trainerChatId: number;
}

export interface GenerationRecord {
  readonly provider: string;
  readonly model: string;
  readonly versionId: string;
}

export type GenerationOutcome =
  | { readonly status: 'SUCCEEDED'; readonly usage: TokenUsage; readonly latencyMs: number }
  | {
      readonly status: 'FAILED';
      readonly failureReason: AIFailureReason;
      readonly latencyMs: number;
    };

export interface GenerationRepo {
  findVersion(versionId: string): Promise<VersionForGeneration | null>;

  /** Cuándo se hizo cada generación dentro de la ventana. Para el rate limit. */
  recentGenerations(windowMinutes: number): Promise<readonly Date[]>;

  /** Inserta `ai_generations` en `GENERATING`. Devuelve su id. */
  startGeneration(record: GenerationRecord): Promise<number>;

  /** Cierra la fila con su resultado. TODA llamada queda registrada (regla 3). */
  finishGeneration(id: number, outcome: GenerationOutcome): Promise<void>;

  /**
   * Aplica una transición **ya validada por la máquina de estados**.
   *
   * `false` si el estado esperado ya no es el actual: otra petición se
   * adelantó. No es un error, es la guarda de concurrencia.
   */
  transition(versionId: string, from: VersionState, to: VersionState): Promise<boolean>;

  saveContent(versionId: string, workout: Workout): Promise<void>;
}
