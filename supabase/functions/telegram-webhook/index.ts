/**
 * SPEC-003 / SPEC-009 — la Edge Function del bot.
 *
 * Aquí solo vive el pegamento HTTP: leer la petición, construir las
 * dependencias, y traducir el resultado a un código de estado.
 *
 * **Todo el flujo, y sobre todo el ORDEN de sus pasos, vive en
 * `_core/telegram/webhook.ts`**, que se prueba sin levantar un servidor.
 * Si esto creciera más allá de unas pocas líneas, es señal de que algo se
 * está colando en la capa equivocada.
 */
import { handleTelegramWebhook, outcomeToStatus } from '../_core/telegram/webhook.ts';
import { createLogger } from '../_shared/logger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';
import { createDb, createTelegramRepo } from '../_shared/db.ts';
import { requireEnv } from '../_shared/env.ts';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const log = createLogger(requestId);
  const startedAt = Date.now();

  // Un cuerpo ilegible se convierte en `null`: el flujo lo trata como
  // malformado, no como una excepción.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const telegram = createTelegramClient(requireEnv('TELEGRAM_BOT_TOKEN'), log);

  const outcome = await handleTelegramWebhook(
    { secretHeader: request.headers.get(SECRET_HEADER), body },
    {
      repo: createTelegramRepo(createDb(), requestId),
      sender: asSender(telegram),
      expectedSecret: requireEnv('TELEGRAM_WEBHOOK_SECRET'),
      requestId,
    },
  );

  const durationMs = Date.now() - startedAt;

  // El `outcome` nunca lleva datos del recurso, solo qué pasó: es seguro
  // loguearlo entero.
  if (outcome.kind === 'unauthorized' || outcome.kind === 'failed') {
    log.warn(`telegram.${outcome.kind}`, { ...outcome, durationMs });
  } else {
    log.info(`telegram.${outcome.kind}`, { ...outcome, durationMs });
  }

  const status = outcomeToStatus(outcome);
  return new Response(status === 401 ? 'unauthorized' : 'ok', { status });
});
