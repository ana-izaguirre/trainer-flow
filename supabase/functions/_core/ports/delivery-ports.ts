/**
 * SPEC-005 — Lo que la vinculación y la entrega necesitan del exterior.
 */
import type { VersionState } from '../domain/version.ts';
import type { Workout } from '../domain/workout.ts';
import type { PlanSummary } from '../telegram/client-format.ts';

export interface ClientForLink {
  readonly clientId: string;
  readonly fullName: string;
  /** `null` mientras no se haya vinculado. */
  readonly linkedProfileId: string | null;
  /**
   * El `telegram_user_id` de quien ya lo canjeó, si alguien lo hizo.
   *
   * Viene junto al cliente **a propósito**: permite saber si quien está
   * canjeando es la misma persona sin crear antes su perfil. Un intento con
   * un token ajeno no puede dejar rastro en `profiles`.
   */
  readonly linkedTelegramUserId: number | null;
  readonly trainerChatId: number;
}

/** Quien escribe, tal y como viene del update verificado (ADR-009). */
export interface TelegramUser {
  /** `from.id`: QUIÉN es. */
  readonly telegramUserId: number;
  /** `chat.id`: DÓNDE responderle. */
  readonly chatId: number;
}

export interface ClientProfile {
  readonly profileId: string;
  readonly chatId: number;
}

export interface VersionForDelivery {
  readonly versionId: string;
  readonly state: VersionState;
  readonly content: Workout;
  readonly clientName: string;
  /** `null` si el cliente aún no canjeó su enlace: no hay dónde escribirle. */
  readonly clientChatId: number | null;
  readonly trainerChatId: number;
  /** `null` en una rutina manual o de plantilla (SPEC-005 regla 13). */
  readonly plan: PlanSummary | null;
  /** SPEC-030 regla 10: `1` es la primera entrega, más que eso es una revisión. */
  readonly versionNumber: number;
  /** SPEC-037: ya calculado — nunca la edad ni la fecha de nacimiento. */
  readonly clientIsMinor: boolean;
}

export interface DeliveryRepo {
  /** El `link_token` es una credencial: nunca se loguea. */
  findClientByToken(token: string): Promise<ClientForLink | null>;

  /**
   * El perfil de esta persona, **creándolo si es su primera vez**.
   *
   * Es el único sitio del sistema donde nace un perfil de cliente, y solo se
   * llega aquí con un token válido en la mano (SPEC-009 regla 1).
   *
   * `fullName` sale de `clients.full_name`, no del `first_name` del update:
   * ese lo elige quien escribe.
   *
   * Devuelve `null` si ese `telegram_user_id` ya tiene un perfil que **no** es
   * de cliente: un entrenador no puede canjear un token (SPEC-005 regla 9).
   */
  ensureClientProfile(
    telegramUserId: number,
    chatId: number,
    fullName: string,
  ): Promise<ClientProfile | null>;

  /**
   * Guarda el perfil y `linked_at`. `false` si otro se adelantó.
   *
   * No recibe el `chat_id`: `ensureClientProfile` ya lo guardó en el perfil,
   * y tenerlo en dos sitios es tenerlo mal en uno de los dos.
   */
  linkClient(clientId: string, profileId: string): Promise<boolean>;

  /** La versión aprobada que espera entrega, si la hay. */
  findApprovedVersion(clientId: string): Promise<VersionForDelivery | null>;

  findVersion(versionId: string): Promise<VersionForDelivery | null>;

  /** Aplica una transición ya validada. `false` si el estado ya cambió. */
  transition(versionId: string, from: VersionState, to: VersionState): Promise<boolean>;

  /**
   * Cierra las solicitudes del plan al ENVIAR esta versión (SPEC-010 regla 12).
   *
   * Al enviar, no al crear la revisión: una revisión abandonada dejaría al
   * cliente sin respuesta y sin solicitud abierta que lo recordara.
   *
   * Devuelve cuántas se cerraron. Cero es normal: la primera rutina de un
   * cliente no responde a ninguna queja.
   */
  resolveRequests(versionId: string): Promise<number>;
}
