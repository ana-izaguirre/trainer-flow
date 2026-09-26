/**
 * Adaptador de la API de Telegram.
 *
 * Aquí vive el token del bot y el `fetch`. El dominio no sabe que Telegram
 * existe: recibe y devuelve datos.
 */
import type { InlineKeyboard } from '../../_core/telegram/keyboard.ts';
import type { TelegramSender } from '../../_core/ports/telegram-ports.ts';
import type { Logger } from '../logger.ts';

const API_BASE = 'https://api.telegram.org';

/** Telegram corta los mensajes en 4096 caracteres. */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export interface TelegramClient {
  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard | null): Promise<number | null>;
  /**
   * Telegram deja el botón girando si no se responde en unos segundos, así
   * que esto se llama ANTES de hacer el trabajo lento (SPEC-004 regla 2).
   */
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

export function createTelegramClient(botToken: string, log: Logger): TelegramClient {
  async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const started = Date.now();
    try {
      const response = await fetch(`${API_BASE}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const durationMs = Date.now() - started;
      const payload: unknown = await response.json();

      if (!response.ok) {
        // El token nunca entra al log: `method` y el status bastan para depurar.
        log.warn('telegram.error', { method, status: response.status, durationMs });
        return null;
      }

      log.debug('telegram.ok', { method, durationMs });
      return payload;
    } catch (error) {
      log.error('telegram.fallo_red', {
        method,
        durationMs: Date.now() - started,
        message: error instanceof Error ? error.message : 'desconocido',
      });
      return null;
    }
  }

  return {
    async sendMessage(chatId, text, keyboard) {
      const payload = await call('sendMessage', {
        chat_id: chatId,
        text: text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH),
        // Los mensajes se componen con MarkdownV2 escapado en `_core/telegram/
        // format.ts`. Sin esto, Telegram los muestra con los backslash a la
        // vista.
        parse_mode: 'MarkdownV2',
        ...(keyboard === undefined || keyboard === null ? {} : { reply_markup: keyboard }),
      });

      if (typeof payload !== 'object' || payload === null) return null;
      const result = (payload as { result?: unknown }).result;
      if (typeof result !== 'object' || result === null) return null;

      const messageId = (result as { message_id?: unknown }).message_id;
      return typeof messageId === 'number' ? messageId : null;
    },

    async answerCallbackQuery(callbackQueryId, text) {
      await call('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text === undefined ? {} : { text }),
      });
    },
  };
}

/**
 * Adapta el cliente al puerto `TelegramSender` que espera `_core`.
 *
 * El puerto devuelve `void`: al dominio no le interesa el `message_id`, solo
 * que el mensaje salió.
 */
export function asSender(client: TelegramClient): TelegramSender {
  return {
    sendMessage: async (chatId, text, keyboard) => {
      await client.sendMessage(chatId, text, keyboard);
    },
    answerCallback: (callbackQueryId, text) => client.answerCallbackQuery(callbackQueryId, text),
  };
}
