/**
 * SPEC-002 §11 / SPEC-030 regla 13 — el barrido de cada 5 minutos.
 *
 * Como las otras funciones disparadas por cron: aquí solo vive el pegamento.
 * Quién cuenta como "atascada", o como "enlace sin abrir", y qué hacer con
 * cada una está en `_core/ai/sweep-stale-generations.ts` y
 * `_core/delivery/sweep-unopened-links.ts`.
 *
 * ┌─ DOS BARRIDOS, UNA SOLA LLAMADA ────────────────────────────────────────┐
 * │ La regla 13 pide «el mismo sweep que ya corre cada 5 minutos», no un    │
 * │ cron nuevo: un cliente que no vinculó no merece su propio job. El       │
 * │ nombre de la función se queda —renombrarla es tocar el cron ya          │
 * │ programado en producción para ganar nada—, pero desde aquí corren las   │
 * │ dos comprobaciones.                                                     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LA LLAMA EL CRON, Y SOLO EL CRON ─────────────────────────────────────┐
 * │ Igual que `weekly-checkin`: expuesta a internet, y sin la comprobación │
 * │ de abajo cualquiera podría dispararla en bucle.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CORRERLA DE MÁS NO PISA NADA ─────────────────────────────────────────┐
 * │ `transition` lleva la misma guarda de concurrencia de siempre, y el     │
 * │ aviso de enlace se manda como mucho una vez por versión                 │
 * │ (`link_reminder_sent_at`). Ninguno de los dos se duplica.               │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { sweepStaleGenerations, type SweepDeps } from '../_core/ai/sweep-stale-generations.ts';
import {
  sweepUnopenedLinks,
  type LinkReminderDeps,
} from '../_core/delivery/sweep-unopened-links.ts';
import { constantTimeEquals } from '../_core/security/constant-time.ts';
import { createDb, createLinkReminderRepo, createSweepRepo } from '../_shared/db.ts';
import { optionalEnv, requireEnv } from '../_shared/env.ts';
import { createLogger, type Logger } from '../_shared/logger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';

const SECRET_HEADER = 'x-sweep-cron-secret';

/** Margen generoso sobre el timeout de la IA (45s) más un reintento. */
const DEFAULT_MIN_MINUTES = 5;

/** SPEC-030 regla 13. */
const DEFAULT_MIN_HOURS = 48;

export interface HandlerDeps {
  readonly expectedSecret: string;
  readonly build: (log: Logger) => SweepDeps;
  readonly buildLinks: (log: Logger) => LinkReminderDeps;
}

function readPositiveInt(varName: string, fallback: number): number {
  const raw = optionalEnv(varName);
  if (raw === null) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Lee el entorno y abre la conexión. **Una vez, al arrancar.** */
export function readDeps(): HandlerDeps {
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const expectedSecret = requireEnv('SWEEP_CRON_SECRET');
  const db = createDb();
  const minMinutes = readPositiveInt('GENERATION_STALE_MINUTES', DEFAULT_MIN_MINUTES);
  const minHours = readPositiveInt('LINK_REMINDER_HOURS', DEFAULT_MIN_HOURS);

  return {
    expectedSecret,
    build: (log) => ({
      repo: createSweepRepo(db),
      sender: asSender(createTelegramClient(botToken, log)),
      minMinutes,
    }),
    buildLinks: (log) => ({
      repo: createLinkReminderRepo(db),
      sender: asSender(createTelegramClient(botToken, log)),
      minHours,
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
      const generations = await sweepStaleGenerations(deps.build(log));
      const links = await sweepUnopenedLinks(deps.buildLinks(log));
      const resultado = { generations, links };

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
