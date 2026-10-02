/**
 * Verificación del payload del Telegram Login Widget (SPEC-033 §3.3).
 *
 * Algoritmo oficial de Telegram: https://core.telegram.org/widgets/login#checking-authorization
 * `secret_key = SHA256(bot_token)`, y el hash recibido tiene que coincidir con
 * `HMAC_SHA256(data_check_string, secret_key)` — nunca se confía en el payload
 * sin esto, igual criterio que `TELEGRAM_WEBHOOK_SECRET` del lado del bot.
 */
import { createHash, createHmac } from "node:crypto";
import { constantTimeEquals } from "@core/security/constant-time.ts";

export interface TelegramWidgetPayload {
  readonly id: number;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly photo_url?: string;
  readonly auth_date: number;
  readonly hash: string;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

function buildDataCheckString(payload: TelegramWidgetPayload): string {
  const { hash: _hash, ...rest } = payload;
  return Object.entries(rest)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/**
 * `null` si el payload no viene de Telegram, o si el login es viejo (ventana
 * de replay). Nunca lanza: un payload ajeno no es un error del servidor.
 */
export function verifyTelegramWidget(
  payload: TelegramWidgetPayload,
  botToken: string,
): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - payload.auth_date > MAX_AUTH_AGE_SECONDS) return false;

  const secretKey = createHash("sha256").update(botToken).digest();
  const dataCheckString = buildDataCheckString(payload);
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  return constantTimeEquals(payload.hash, expectedHash);
}
