/**
 * SPEC-008 — Lo que las plantillas, la creación manual y el editor necesitan
 * del exterior.
 *
 * ┌─ NINGUNA DE ESTAS OPERACIONES LLAMA A LA IA ───────────────────────────┐
 * │ Es la regla 1, y es lo que garantiza que la IA no sea punto único de   │
 * │ fallo: este puerto no conoce ningún proveedor, así que el camino       │
 * │ manual sigue funcionando con el proveedor caído.                       │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Level } from '../domain/assessment.ts';
import type { VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';

/** Lo que hace falta para ORDENAR las plantillas de este cliente. */
export interface VersionForCreation {
  readonly versionId: string;
  readonly state: VersionState;
  readonly clientName: string;
  readonly versionNumber: number;
  /** `null` en un plan sin evaluación de Tally. */
  readonly daysPerWeek: number | null;
  readonly level: Level | null;
  readonly equipment: string | null;
  /** Decide si `applyTemplate` inyecta el aviso (regla 9). */
  readonly hasLimitations: boolean;
}

/** El borrador sobre el que actúa el editor. */
export interface CurrentDraft {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly clientName: string;
  readonly content: Workout;
}

export interface CreationRepo {
  findVersion(versionId: string): Promise<VersionForCreation | null>;

  /**
   * Escribe contenido y fuente, y pasa a `DRAFT`. **Atómico**: el `CHECK` del
   * esquema exige que `source='template'` y `template_id` vayan juntos.
   *
   * `false` si el estado esperado ya no es el actual: alguien se adelantó.
   * Es lo que impide que dos pulsaciones carguen dos plantillas encima.
   */
  fillVersion(
    versionId: string,
    expected: VersionState,
    source: 'template' | 'manual',
    templateId: string | null,
    content: Workout,
  ): Promise<boolean>;

  /**
   * El borrador que el entrenador tocó más recientemente.
   *
   * Es el contexto implícito del editor: los comandos no llevan cliente
   * (SPEC-008 §3). `null` si no tiene ninguno abierto.
   */
  currentDraft(trainerId: string): Promise<CurrentDraft | null>;

  /**
   * Guarda una edición **in-place** (regla 5): sin versión nueva, sin cambio
   * de estado.
   *
   * `false` si la versión ya no está en `DRAFT` — se aprobó mientras el
   * entrenador escribía.
   */
  saveDraft(versionId: string, content: Workout): Promise<boolean>;
}
