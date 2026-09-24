/**
 * SPEC-002 §11 — la Edge Function que desatasca una GENERATING que murió a medias.
 *
 * Como las otras funciones disparadas por cron: aquí solo vive el pegamento.
 * Quién cuenta como "atascada" y qué hacer con cada una está en
 * `_core/ai/sweep-stale-generations.ts`.
 *
 * ┌─ LA LLAMA EL CRON, Y SOLO EL CRON ─────────────────────────────────────┐
 * │ Igual que `weekly-checkin`: expuesta a internet, y sin la comprobación │
 * │ de abajo cualquiera podría dispararla en bucle.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CORRERLA DE MÁS NO PISA NADA ─────────────────────────────────────────┐
 * │ `transition` lleva la misma guarda de concurrencia de siempre: si una  │
 * │ generación terminó de verdad un instante antes, esta pasada no la toca.│
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { sweepStaleGenerations, type SweepDeps } from '../_core/ai/sweep-stale-generations.ts';
import { constantTimeEquals } from '../_core/security/constant-time.ts';
import { createDb, createSweepRepo } from '../_shared/db.ts';
import { optionalEnv, requireEnv } from '../_shared/env.ts';
import { createLogger, type Logger } from '../_shared/logger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';

const SECRET_HEADER = 'x-sweep-cron-secret';

/** Margen generoso sobre el timeout de la IA (45s) más un reintento. */
const DEFAULT_MIN_MINUTES = 5;

export interface HandlerDeps {
  readonly expectedSecret: string;
  readonly build: (log: Logger) => SweepDeps;
}

function readMinMinutes(): number {
  const raw = optionalEnv('GENERATION_STALE_MINUTES');
  if (raw === null) return DEFAULT_MIN_MINUTES;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_MINUTES;
}

/** Lee el entorno y abre la conexión. **Una vez, al arrancar.** */
export function readDeps(): HandlerDeps {
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const expectedSecret = requireEnv('SWEEP_CRON_SECRET');
  const db = createDb();
  const minMinutes = readMinMinutes();

  return {
    expectedSecret,
    build: (log) => ({
      repo: createSweepRepo(db),
      sender: asSender(createTelegramClient(botToken, log)),
      minMinutes,
    }),
  };
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID();
    const log = createLogger(requestId);
    const startedAt = Date.now();

    if (!constantTimeEquals(request.headers.get(SECRET_HEADER), deps.expectedSecret)) {
      log.warn('sweep.unauthorized');
      return new Response('unauthorized', { status: 401 });
    }

    try {
      const resultado = await sweepStaleGenerations(deps.build(log));

      // Son contadores, no datos de nadie: es seguro loguearlos enteros.
      log.info('sweep.run', { ...resultado, durationMs: Date.now() - startedAt });

      return Response.json(resultado);
    } catch (error) {
      log.error('sweep.failed', {
        message: error instanceof Error ? error.message : 'Error desconocido.',
        durationMs: Date.now() - startedAt,
      });

      // 500 a propósito, igual que weekly-checkin: quien llama es el cron,
      // que no reintenta en bucle, y un fallo tiene que verse.
      return new Response('error', { status: 500 });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createHandler(readDeps()));
}
