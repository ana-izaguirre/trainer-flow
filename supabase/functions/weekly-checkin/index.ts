/**
 * SPEC-006 — la Edge Function del check-in semanal.
 *
 * Como las otras: aquí solo vive el pegamento. A quién le toca preguntarle y
 * a quién recordarle está en `_core/checkin/`, que se prueba sin reloj real
 * porque recibe el `now` en vez de leerlo.
 *
 * ┌─ LA LLAMA EL CRON, Y SOLO EL CRON ─────────────────────────────────────┐
 * │ Una Edge Function está expuesta a internet. Sin la comprobación de     │
 * │ abajo, cualquiera podría dispararla en bucle y llenar de check-ins el  │
 * │ Telegram de todos los clientes.                                       │
 * │                                                                        │
 * │ El secreto se compara en tiempo constante, igual que el de Telegram.   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ CORRERLA DE MÁS NO DUPLICA NADA ──────────────────────────────────────┐
 * │ El `UNIQUE (client_id, version_id, week_number)` decide qué check-ins  │
 * │ existen, no el número de veces que se llame (CA-2). Así una reejecución│
 * │ manual es segura.                                                      │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { runWeeklyCheckins, type CheckinRunDeps } from '../_core/checkin/send.ts';
import { constantTimeEquals } from '../_core/security/constant-time.ts';
import { createCheckinRepo, createDb } from '../_shared/db.ts';
import { requireEnv } from '../_shared/env.ts';
import { createLogger, type Logger } from '../_shared/logger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';

const SECRET_HEADER = 'x-checkin-cron-secret';

export interface HandlerDeps {
  readonly expectedSecret: string;
  readonly build: (log: Logger) => CheckinRunDeps;
}

/** Lee el entorno y abre la conexión. **Una vez, al arrancar.** */
export function readDeps(): HandlerDeps {
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const expectedSecret = requireEnv('CHECKIN_CRON_SECRET');
  const db = createDb();

  return {
    expectedSecret,
    build: (log) => ({
      repo: createCheckinRepo(db),
      sender: asSender(createTelegramClient(botToken, log)),
    }),
  };
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID();
    const log = createLogger(requestId);
    const startedAt = Date.now();

    if (!constantTimeEquals(request.headers.get(SECRET_HEADER), deps.expectedSecret)) {
      log.warn('checkin.unauthorized');
      return new Response('unauthorized', { status: 401 });
    }

    try {
      // El `now` entra por parámetro: así el dominio se prueba con fechas
      // fijas en vez de con el reloj de la máquina que corre los tests.
      const resultado = await runWeeklyCheckins(deps.build(log), new Date());

      // Son contadores, no datos de nadie: es seguro loguearlos enteros.
      log.info('checkin.run', { ...resultado, durationMs: Date.now() - startedAt });

      return Response.json(resultado);
    } catch (error) {
      log.error('checkin.failed', {
        message: error instanceof Error ? error.message : 'Error desconocido.',
        durationMs: Date.now() - startedAt,
      });

      // 500 a propósito, al revés que en los webhooks: aquí quien llama es el
      // cron, que no reintenta en bucle, y un fallo tiene que verse.
      return new Response('error', { status: 500 });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createHandler(readDeps()));
}
