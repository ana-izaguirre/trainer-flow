/**
 * SPEC-004 §"Cómo se reconoce «el siguiente mensaje»" — lo que la edición
 * conversacional necesita del exterior.
 *
 * Reusa el mismo `GenerationRecord`/`GenerationOutcome` de SPEC-002: es la
 * misma tabla (`ai_generations`), solo que con `operation = 'edit'`.
 */
import type { WorkoutConstraints } from '../domain/draft.ts';
import type { Workout } from '../domain/workout.ts';
import type { AIRequest } from './ai-provider.ts';
import type { GenerationOutcome, GenerationRecord } from './generation-ports.ts';

export interface VersionForEdit {
  readonly versionId: string;
  readonly editCount: number;
  readonly clientName: string;
  readonly versionNumber: number;
  /** `instruction` viene en `null`: el orquestador la completa con el texto recibido. */
  readonly request: AIRequest;
  readonly constraints: WorkoutConstraints;
  readonly trainerChatId: number;
}

export interface EditRepo {
  /** La versión de este entrenador que está esperando su instrucción, si hay alguna. */
  findAwaitingEdit(trainerId: string): Promise<VersionForEdit | null>;

  /** Apaga la espera sin guardar nada: cambiar de intención no es un error. */
  cancelEditWait(versionId: string): Promise<void>;

  /**
   * Apaga cualquier espera pendiente de este entrenador, sin conocer su
   * versión — es lo que cancela en silencio cuando llega un COMANDO en vez
   * de la instrucción. No-op si no había ninguna.
   */
  cancelAnyEditWait(trainerId: string): Promise<void>;

  /** Cuándo se hizo cada generación dentro de la ventana. Para el rate limit. */
  recentGenerations(windowMinutes: number): Promise<readonly Date[]>;

  /** Inserta `ai_generations` en `GENERATING`. Devuelve su id. */
  startGeneration(record: GenerationRecord): Promise<number>;

  /** Cierra la fila con su resultado. Toda llamada queda registrada, incluso la que falla. */
  finishGeneration(id: number, outcome: GenerationOutcome): Promise<void>;

  /**
   * Guarda el resultado in-place y apaga la espera. `edit_count + 1`, sigue
   * en `DRAFT`, `version_number` no cambia (SPEC-004 regla 6).
   *
   * `false` si ya no está en `DRAFT`: alguien aprobó o rechazó mientras se
   * esperaba la instrucción.
   */
  saveEditedContent(versionId: string, workout: Workout): Promise<boolean>;
}
