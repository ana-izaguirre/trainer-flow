/**
 * SPEC-015 — Lo que la ficha de admisión necesita del exterior.
 *
 * ┌─ ESTE PUERTO NO PUEDE ESCRIBIR ────────────────────────────────────────┐
 * │ Un solo método, y es de lectura. «Leer la evaluación no cambia nada»   │
 * │ no es una nota en la spec: es que aquí no hay con qué cambiarlo.       │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Level } from '../domain/assessment.ts';
import type { ClientRef, VersionState } from '../domain/version.ts';

export interface IntakeForVersion {
  readonly versionId: string;
  readonly state: VersionState;
  /** De quién es. Sin esto no se puede autorizar (SPEC-013). */
  readonly client: ClientRef;
  readonly clientName: string;
  readonly goal: string;
  readonly level: Level;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
  readonly equipment: string;
  readonly hasLimitations: boolean;
  /**
   * El detalle SÍ viaja aquí, al revés que en el aviso.
   *
   * Es el motivo de la spec: sin esto no se lee en ningún sitio hasta que la
   * rutina existe. Va a un mensaje que el entrenador pide pulsando un botón,
   * no a uno que le llega solo a la pantalla de bloqueo.
   */
  readonly limitationsDetail: string | null;
  readonly lifestyle: string | null;
  readonly notes: string | null;
  readonly submittedAt: Date;

  // ── SPEC-016 ────────────────────────────────────────────────────────────
  readonly gender: string | null;
  readonly age: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly lastWeighed: string | null;
  readonly quitReasons: string | null;
  readonly menopauseStage: string | null;
  /**
   * Enfermedades propias y de familia cercana.
   *
   * Va también al prompt (decisión de Ana), pero aquí se lee entero: el
   * entrenador revisa el contexto Y los `warnings` con los que la IA dice
   * qué tuvo en cuenta, antes de aprobar nada.
   */
  readonly chronicConditions: string | null;
  readonly medications: string | null;
  readonly equipmentDetail: string | null;
  /** `AAAA-MM-DD`. La edad de arriba se deriva de aquí. */
  readonly birthDate: string | null;
}

export interface IntakeRepo {
  /** `null` si la versión no existe o no hubo formulario detrás. */
  findIntake(versionId: string): Promise<IntakeForVersion | null>;
}
