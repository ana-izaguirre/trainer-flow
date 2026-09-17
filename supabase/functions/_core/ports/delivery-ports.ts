/**
 * SPEC-005 — Lo que la vinculación y la entrega necesitan del exterior.
 */
import type { VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';

export interface ClientForLink {
  readonly clientId: string;
  readonly fullName: string;
  /** `null` mientras no se haya vinculado. */
  readonly linkedProfileId: string | null;
  readonly trainerChatId: number;
}

export interface VersionForDelivery {
  readonly versionId: string;
  readonly state: VersionState;
  readonly content: Workout;
  readonly clientName: string;
  readonly clientChatId: number;
  readonly trainerChatId: number;
  readonly goal: string;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
}

export interface DeliveryRepo {
  /** El `link_token` es una credencial: nunca se loguea. */
  findClientByToken(token: string): Promise<ClientForLink | null>;

  /** Guarda el perfil y `linked_at`. `false` si otro se adelantó. */
  linkClient(clientId: string, profileId: string, chatId: number): Promise<boolean>;

  /** La versión aprobada que espera entrega, si la hay. */
  findApprovedVersion(clientId: string): Promise<VersionForDelivery | null>;

  findVersion(versionId: string): Promise<VersionForDelivery | null>;

  /** Aplica una transición ya validada. `false` si el estado ya cambió. */
  transition(versionId: string, from: VersionState, to: VersionState): Promise<boolean>;
}
