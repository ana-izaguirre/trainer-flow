/**
 * SPEC-001 — la Edge Function que recibe el formulario.
 *
 * Igual que la de Telegram: aquí solo vive el pegamento HTTP. El flujo, y
 * sobre todo el ORDEN de sus pasos, está en `_core/tally/webhook.ts`.
 *
 * ┌─ POR QUÉ SE LEE EL CUERPO COMO TEXTO ──────────────────────────────────┐
 * │ La firma es un HMAC sobre los BYTES EXACTOS que mandó Tally. Parsear   │
 * │ el JSON y volver a serializarlo cambia espacios y orden de claves, y   │
 * │ el HMAC dejaría de cuadrar. El parseo lo hace `_core`, después de      │
 * │ verificar.                                                            │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { SignatureVerifier, TallyRepo } from '../_core/ports/tally-ports.ts';
import type { TelegramSender } from '../_core/ports/telegram-ports.ts';
import { handleTallyWebhook, outcomeToStatus } from '../_core/tally/webhook.ts';
import { createDb, createTallyRepo } from '../_shared/db.ts';
import { requireEnv } from '../_shared/env.ts';
import { newLinkToken } from '../_shared/link-token.ts';
import { createLogger } from '../_shared/logger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';
import { createSignatureVerifier, readSignatureHeader } from '../_shared/tally/signature.ts';

export interface HandlerDeps {
  readonly verifier: SignatureVerifier;
  readonly botUsername: string;
  readonly repo: (requestId: string) => TallyRepo;
  /** Para avisar al entrenador cuando una evaluación no se puede leer. */
  readonly sender: (log: ReturnType<typeof createLogger>) => TelegramSender;
}

/**
 * Lee el entorno y abre la conexión. **Se llama una vez, al arrancar.**
 *
 * Si falta un secreto, la función no llega a servir: revienta aquí nombrando
 * la variable, en vez de fallar con el primer envío real (SPEC-011 §2).
 */
export function readDeps(): HandlerDeps {
  const verifier = createSignatureVerifier(requireEnv('TALLY_SIGNING_SECRET'));
  // El aviso de la regla 9 sale por Telegram, así que este webhook también
  // necesita el bot.
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');

  // SPEC-014 regla 2. Obligatorio y al arrancar: sin él saldría
  // `t.me/undefined?start=...`, un enlace roto que nadie nota hasta que un
  // cliente lo abre y no pasa nada. Falla al desplegar, no al primer
  // formulario (la lección de SPEC-011).
  const botUsername = requireEnv('TELEGRAM_BOT_USERNAME').replace(/^@/, '');
  const db = createDb();

  return {
    verifier,
    botUsername,
    repo: (requestId) => createTallyRepo(db, requestId),
    sender: (log) => asSender(createTelegramClient(botToken, log)),
  };
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID();
    const log = createLogger(requestId);
    const startedAt = Date.now();

    try {
      const rawBody = await request.text();

      const outcome = await handleTallyWebhook(
        { rawBody, signature: readSignatureHeader(request.headers) },
        {
          repo: deps.repo(requestId),
          verifier: deps.verifier,
          sender: deps.sender(log),
          newLinkToken,
          botUsername: deps.botUsername,
          requestId,
          now: () => new Date(),
        },
      );

      const durationMs = Date.now() - startedAt;

      // El `outcome` no lleva datos del formulario, solo qué pasó: es seguro
      // loguearlo entero. `reason` describe la forma del sobre, nunca una
      // respuesta del cliente.
      if (outcome.kind === 'unauthorized' || outcome.kind === 'failed') {
        log.warn(`tally.${outcome.kind}`, { ...outcome, durationMs });
      } else {
        log.info(`tally.${outcome.kind}`, { ...outcome, durationMs });
      }

      // Tally no lee el cuerpo, solo el código. El texto es para quien depura
      // con curl.
      return new Response(outcome.kind, { status: outcomeToStatus(outcome) });
    } catch (error) {
      // SPEC-012 regla 3: ninguna petición se muere en silencio. Aquí entra
      // lo que pasa fuera del dominio: leer el cuerpo, construir el repo.
      log.error('tally.excepcion', {
        // El mensaje, nunca el stack: un stack arrastra valores de variables,
        // y por aquí pasan respuestas de un formulario de salud.
        message: error instanceof Error ? error.message : 'Error desconocido.',
        durationMs: Date.now() - startedAt,
      });

      // 500, igual que `failed`: Tally reintenta un número acotado de veces
      // y una evaluación perdida deja a un cliente sin rutina.
      return new Response('error', { status: 500 });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createHandler(readDeps()));
}
