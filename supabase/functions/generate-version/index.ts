/**
 * SPEC-002 — la Edge Function que genera una rutina con IA.
 *
 * Como las otras dos: aquí solo vive el pegamento. La orquestación —y sobre
 * todo la degradación cuando la IA falla— está en `_core/ai/generate-version.ts`.
 *
 * ┌─ ESTA FUNCIÓN ES INTERNA ──────────────────────────────────────────────┐
 * │ No la llama Telegram ni Tally: la invoca otra Edge Function con el     │
 * │ `service_role`. Por eso no verifica firma de proveedor, sino que el    │
 * │ llamante trae la clave de servicio.                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { generateVersion, type GenerateDeps } from '../_core/ai/generate-version.ts';
import type { RateLimitConfig } from '../_core/ai/rate-limit.ts';
import { chooseRequestId } from '../_core/observability/request-id.ts';
import { createProvider } from '../_shared/ai/gemini-provider.ts';
import { createDb, createGenerationRepo } from '../_shared/db.ts';
import { optionalEnv, requireEnv } from '../_shared/env.ts';
import { createLogger, type Logger } from '../_shared/logger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';

/** SPEC-002 regla 8. Cada intento estrena el suyo. */
const TIMEOUT_MS = 45_000;

/** Un entero de una variable de entorno, o el valor por defecto. */
function readInt(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (raw === null) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface HandlerDeps {
  readonly build: (requestId: string, log: Logger) => GenerateDeps;
}

/**
 * Lee el entorno y abre la conexión. **Una vez, al arrancar.**
 *
 * El modelo y los límites de cuota son configuración, no secretos, pero
 * viajan por el mismo mecanismo: es como una Edge Function recibe variables.
 */
export function readDeps(): HandlerDeps {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const model = optionalEnv('AI_MODEL') ?? 'gemini-2.0-flash';
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const db = createDb();

  const rateLimit: RateLimitConfig = {
    // `AI_MAX_CALLS=0` apaga la IA sin desplegar.
    maxCalls: readInt('AI_MAX_CALLS', 20),
    windowMinutes: readInt('AI_WINDOW_MINUTES', 60),
  };

  return {
    build: (requestId, log) => ({
      repo: createGenerationRepo(db, requestId),
      provider: createProvider({ apiKey, model, log }),
      sender: asSender(createTelegramClient(botToken, log)),
      rateLimit,
      newTimeoutSignal: () => AbortSignal.timeout(TIMEOUT_MS),
      now: () => new Date(),
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const startedAt = Date.now();

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    // SPEC-012 regla 1: quien dispara manda su `requestId`. Usarlo es lo que
    // une la pulsación del botón con la generación que provoca.
    const { requestId, rejected } = chooseRequestId(
      isRecord(body) ? body['requestId'] : null,
      () => crypto.randomUUID(),
    );
    const log = createLogger(requestId);

    if (rejected) {
      // La generación sigue: perder la traza no es motivo para no generar.
      log.warn('generate.request_id_invalido', {});
    }

    const versionId = isRecord(body) ? body['versionId'] : null;
    if (typeof versionId !== 'string' || versionId.length === 0) {
      log.warn('generate.sin_version', {});
      return new Response('versionId requerido', { status: 400 });
    }

    try {
      const outcome = await generateVersion(versionId, deps.build(requestId, log));
      const durationMs = Date.now() - startedAt;

      // El `outcome` no lleva contenido de la rutina ni del prompt: solo qué
      // pasó. Es seguro loguearlo entero.
      if (outcome.kind === 'generated' || outcome.kind === 'not_in_new') {
        log.info(`generate.${outcome.kind}`, { ...outcome, durationMs });
      } else {
        log.warn(`generate.${outcome.kind}`, { ...outcome, durationMs });
      }

      // Solo `not_found` es un error del llamante. Todo lo demás son
      // resultados legítimos: la versión quedó donde el entrenador puede
      // seguir, que es lo que esta función promete.
      return new Response(outcome.kind, { status: outcome.kind === 'not_found' ? 404 : 202 });
    } catch (error) {
      // SPEC-012 regla 3: toda petición deja una línea de cierre. Sin esto,
      // la función con más superficie de fallo —red, timeouts, cuatro
      // escrituras— era la única que podía morirse sin decir nada.
      log.error('generate.excepcion', {
        versionId,
        // El mensaje, nunca el stack: un stack arrastra valores de variables.
        message: error instanceof Error ? error.message : 'Error desconocido.',
        durationMs: Date.now() - startedAt,
      });

      // 500 y no 202: nadie reintenta esto en bucle, y un fallo tiene que verse.
      return new Response('error', { status: 500 });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createHandler(readDeps()));
}
