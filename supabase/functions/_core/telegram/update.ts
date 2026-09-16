/**
 * Convierte un update de Telegram, que es dato NO confiable, en algo tipado.
 *
 * Llega por HTTP desde fuera, así que se valida igual de estricto que una
 * respuesta de la IA: la entrada es `unknown` y nada se lee sin comprobarlo.
 *
 * Lo que este módulo NO hace: decidir si quien envía tiene permiso. Eso es
 * `authorization.ts`, y ocurre después de resolver el perfil.
 */

/** Telegram corta los mensajes en 4096 caracteres; nada más largo es legítimo. */
const MAX_TEXT_LENGTH = 4096;

interface Base {
  readonly updateId: number;
  /** `from.id`: QUIÉN es. La identidad del sistema (ADR-009). */
  readonly telegramUserId: number;
  /** `chat.id`: DÓNDE responder. */
  readonly chatId: number;
  readonly messageId: number;
}

export type ParsedUpdate =
  | (Base & { readonly kind: 'command'; readonly command: string; readonly args: string })
  | (Base & { readonly kind: 'text'; readonly text: string })
  | (Base & { readonly kind: 'callback'; readonly callbackQueryId: string; readonly data: string })
  /**
   * No accionable, pero se registra igual: si Telegram lo reintenta, la
   * idempotencia lo descarta sin volver a evaluarlo.
   */
  | { readonly kind: 'ignored'; readonly updateId: number | null; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ignored(updateId: number | null, reason: string): ParsedUpdate {
  return { kind: 'ignored', updateId, reason };
}

export function parseUpdate(raw: unknown): ParsedUpdate {
  if (!isRecord(raw)) return ignored(null, 'El update no es un objeto.');

  const updateId = readNumber(raw['update_id']);
  if (updateId === null) return ignored(null, 'El update no trae update_id.');

  const callbackQuery = raw['callback_query'];
  if (isRecord(callbackQuery)) return parseCallback(updateId, callbackQuery);

  const message = raw['message'];
  if (isRecord(message)) return parseMessage(updateId, message);

  return ignored(updateId, 'Tipo de update no soportado.');
}

function readActor(
  container: Record<string, unknown>,
  chatContainer: Record<string, unknown>,
): { telegramUserId: number; chatId: number } | null {
  const from = container['from'];
  if (!isRecord(from)) return null;

  const telegramUserId = readNumber(from['id']);
  if (telegramUserId === null) return null;

  const chat = chatContainer['chat'];
  const chatId = isRecord(chat) ? readNumber(chat['id']) : null;
  if (chatId === null) return null;

  return { telegramUserId, chatId };
}

function parseMessage(updateId: number, message: Record<string, unknown>): ParsedUpdate {
  const actor = readActor(message, message);
  if (actor === null) return ignored(updateId, 'El mensaje no identifica remitente o chat.');

  const messageId = readNumber(message['message_id']);
  if (messageId === null) return ignored(updateId, 'El mensaje no trae message_id.');

  const rawText = message['text'];
  if (typeof rawText !== 'string') {
    return ignored(updateId, 'El mensaje no trae texto: puede ser una foto o un audio.');
  }

  const text = rawText.slice(0, MAX_TEXT_LENGTH).trim();
  if (text.length === 0) return ignored(updateId, 'El mensaje está vacío.');

  const base = { updateId, ...actor, messageId };

  if (!text.startsWith('/')) return { kind: 'text', ...base, text };

  // `/cliente Carlos Pérez` → command: "cliente", args: "Carlos Pérez"
  // En grupos, Telegram añade el sufijo del bot: `/clientes@TrainerFlowBot`.
  const separator = text.indexOf(' ');
  const head = separator === -1 ? text.slice(1) : text.slice(1, separator);
  const atIndex = head.indexOf('@');
  const command = (atIndex === -1 ? head : head.slice(0, atIndex)).toLowerCase();
  if (command.length === 0) return ignored(updateId, 'Comando vacío.');

  const args = separator === -1 ? '' : text.slice(separator + 1).trim();
  return { kind: 'command', ...base, command, args };
}

function parseCallback(updateId: number, callback: Record<string, unknown>): ParsedUpdate {
  const message = callback['message'];
  if (!isRecord(message)) return ignored(updateId, 'El callback no trae mensaje asociado.');

  const actor = readActor(callback, message);
  if (actor === null) return ignored(updateId, 'El callback no identifica remitente o chat.');

  const messageId = readNumber(message['message_id']);
  if (messageId === null) return ignored(updateId, 'El callback no trae message_id.');

  const callbackQueryId = callback['id'];
  if (typeof callbackQueryId !== 'string' || callbackQueryId.length === 0) {
    return ignored(updateId, 'El callback no trae id.');
  }

  const data = callback['data'];
  if (typeof data !== 'string' || data.length === 0) {
    return ignored(updateId, 'El callback no trae data.');
  }

  return { kind: 'callback', updateId, ...actor, messageId, callbackQueryId, data };
}
