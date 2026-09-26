/**
 * Los puertos que el flujo del webhook necesita del mundo exterior.
 *
 * Están en `_core` como INTERFACES; quien las implementa vive en `_shared`.
 * Es el mismo patrón que `AIProvider`: el dominio declara qué necesita, no
 * cómo se consigue.
 */
import type { Identity } from '../domain/identity.ts';
import type { InlineKeyboard } from '../telegram/keyboard.ts';

export interface TelegramRepo {
  /**
   * Registra el evento. Devuelve `false` si ya se había procesado.
   *
   * La idempotencia es el `UNIQUE (source, external_id)` de la base de datos,
   * no una comprobación previa: dos peticiones simultáneas no pueden pasar
   * las dos.
   */
  claimEvent(externalId: string, payload: unknown, requestId: string): Promise<boolean>;

  markProcessed(externalId: string): Promise<void>;

  /** `null` si no hay perfil: nadie se auto-registra (SPEC-009 regla 1). */
  findIdentity(telegramUserId: number): Promise<Identity | null>;
}

export interface TelegramSender {
  /**
   * `keyboard` es opcional: un aviso que no pide ninguna decisión no lleva
   * botones, y un `inline_keyboard` vacío hace que Telegram devuelva 400.
   */
  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard | null): Promise<void>;
  /**
   * Telegram deja el botón girando si no se responde pronto.
   *
   * `text` es opcional: sin él, el botón solo deja de girar. Con él, sale
   * como aviso emergente — hoy solo lo usa el acuse del check-in (SPEC-030
   * regla 9). Texto plano: Telegram no interpreta Markdown ahí.
   */
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;
}
