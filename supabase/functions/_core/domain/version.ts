/**
 * Referencias a entidades del dominio, ya cargadas desde la base de datos.
 *
 * Estos tipos existen para que las reglas de `_core` reciban datos y no tengan
 * que consultar nada: así se prueban sin base de datos (ADR-001).
 */

/** Los 6 estados del dominio. Ninguno describe qué hace la IA. */
export type VersionState =
  | 'NEW'
  | 'GENERATING'
  | 'DRAFT'
  | 'APPROVED'
  | 'SENT'
  | 'REJECTED';

export const VERSION_STATES: readonly VersionState[] = [
  'NEW',
  'GENERATING',
  'DRAFT',
  'APPROVED',
  'SENT',
  'REJECTED',
];

/** De dónde salió el contenido. Las tres son iguales para el dominio. */
export type VersionSource = 'ai' | 'template' | 'manual';

export interface ClientRef {
  readonly clientId: string;
  /** `profiles.id` del entrenador dueño de este cliente. */
  readonly trainerId: string;
  /** `profiles.id` del cliente. NULL mientras no se haya vinculado al bot. */
  readonly profileId: string | null;
}

export interface VersionRef {
  readonly versionId: string;
  readonly state: VersionState;
  readonly client: ClientRef;
}
