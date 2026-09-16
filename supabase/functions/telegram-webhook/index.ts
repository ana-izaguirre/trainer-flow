/**
 * SPEC-003 / SPEC-009 — la puerta de entrada de Telegram.
 *
 * El orden de estos pasos NO es negociable:
 *
 *   1. Verificar el secreto de cabecera  → 401 sin tocar la base de datos
 *   2. Parsear el update                 → dato no confiable, se valida
 *   3. Reclamar el evento                → idempotencia por UNIQUE
 *   4. Resolver la identidad             → nadie se auto-registra
 *   5. Atender                           → la autorización decide qué puede
 *
 * Siempre responde 200 salvo en el paso 1. Un 500 hace que Telegram reintente
 * el mismo update en bucle, y el problema real ya quedó en los logs.
 */
import { parseUpdate } from '../_core/telegram/update.ts';
import { secretsMatch } from '../_core/telegram/secret.ts';
import { createLogger } from '../_shared/logger.ts';
import { createTelegramClient } from '../_shared/telegram/client.ts';
import { claimWebhookEvent, createDb, findIdentity, markWebhookProcessed } from '../_shared/db.ts';
import { requireEnv } from '../_shared/env.ts';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Lo mismo para un desconocido que para un token inválido: no se filtra nada. */
const NEUTRAL_REPLY = 'No te tengo registrado. Habla con tu entrenador.';

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const log = createLogger(requestId);
  const startedAt = Date.now();

  // ── 1. El secreto, antes que nada ────────────────────────────────────────
  if (!secretsMatch(request.headers.get(SECRET_HEADER), requireEnv('TELEGRAM_WEBHOOK_SECRET'))) {
    log.warn('telegram.secreto_invalido');
    return new Response('unauthorized', { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    log.warn('telegram.cuerpo_invalido');
    return new Response('ok', { status: 200 });
  }

  // ── 2. El update es dato no confiable ────────────────────────────────────
  const update = parseUpdate(raw);
  if (update.kind === 'ignored') {
    log.info('telegram.ignorado', { reason: update.reason, updateId: update.updateId });
    return new Response('ok', { status: 200 });
  }

  const db = createDb();
  const telegram = createTelegramClient(requireEnv('TELEGRAM_BOT_TOKEN'), log);

  // Telegram deja el botón girando si tarda. Se responde antes del trabajo.
  if (update.kind === 'callback') {
    await telegram.answerCallbackQuery(update.callbackQueryId);
  }

  try {
    // ── 3. Idempotencia ────────────────────────────────────────────────────
    const isNew = await claimWebhookEvent(db, 'telegram', String(update.updateId), raw, requestId);
    if (!isNew) {
      log.info('telegram.duplicado', { updateId: update.updateId });
      return new Response('ok', { status: 200 });
    }

    // ── 4. Identidad ───────────────────────────────────────────────────────
    const identity = await findIdentity(db, update.telegramUserId);
    if (identity === null) {
      // Se registra el intento, sin datos del recurso (SPEC-009 CA-8).
      log.warn('telegram.desconocido', { telegramUserId: update.telegramUserId });
      await telegram.sendMessage(update.chatId, NEUTRAL_REPLY);
      await markWebhookProcessed(db, 'telegram', String(update.updateId));
      return new Response('ok', { status: 200 });
    }

    // ── 5. Atender ─────────────────────────────────────────────────────────
    // El enrutado de comandos y botones llega en S-10 y S-11. Hoy el webhook
    // ya identifica, verifica y registra: lo que falta es a quién llamar.
    log.info('telegram.recibido', {
      kind: update.kind,
      role: identity.role,
      profileId: identity.profileId,
      updateId: update.updateId,
    });

    await markWebhookProcessed(db, 'telegram', String(update.updateId));
    return new Response('ok', { status: 200 });
  } catch (error) {
    log.error('telegram.error', {
      updateId: update.updateId,
      message: error instanceof Error ? error.message : 'desconocido',
    });
    // 200 a propósito: un 500 haría que Telegram reintentara en bucle.
    return new Response('ok', { status: 200 });
  } finally {
    log.info('telegram.fin', { durationMs: Date.now() - startedAt });
  }
});
