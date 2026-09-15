/**
 * Identidad de quien está actuando.
 *
 * Se resuelve SIEMPRE desde el update verificado de Telegram, nunca desde un
 * dato que envíe el usuario. Ver SPEC-009 y ADR-009.
 */
export type UserRole = 'trainer' | 'client';

export interface Identity {
  /** `profiles.id`. Es la identidad interna del sistema. */
  readonly profileId: string;
  readonly role: UserRole;
  /** `profiles.telegram_user_id`: quién eres. */
  readonly telegramUserId: number;
  /** `profiles.telegram_chat_id`: dónde se te escribe. */
  readonly telegramChatId: number;
}
