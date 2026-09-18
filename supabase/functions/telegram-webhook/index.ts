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
 *
 * ┌─ POR QUÉ ESTÁ PARTIDO EN TRES ─────────────────────────────────────────┐
 * │ `readDeps()` lee el entorno UNA VEZ, al arrancar. Antes se leía dentro │
 * │ de cada petición, y un secreto mal escrito dejaba desplegar la función │
 * │ y fallaba en el primer mensaje real (SPEC-011 §2).                     │
 * │                                                                        │
 * │ `createHandler()` recibe lo que necesita en vez de construirlo, así    │
 * │ que un test le manda un Request y comprueba la Response sin Docker,    │
 * │ sin red y sin Supabase.                                                │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { ActionRepo } from '../_core/ports/action-ports.ts';
import type { CheckinRepo } from '../_core/ports/checkin-ports.ts';
import type { DeliveryRepo } from '../_core/ports/delivery-ports.ts';
import type { ChangeRequestRepo } from '../_core/ports/change-request-ports.ts';
import type { CreationRepo } from '../_core/ports/creation-ports.ts';
import type { GenerationTrigger } from '../_core/ports/generation-trigger.ts';
import type { QueryRepo } from '../_core/ports/query-ports.ts';
import type { TelegramRepo, TelegramSender } from '../_core/ports/telegram-ports.ts';
import { handleTelegramWebhook, outcomeToStatus } from '../_core/telegram/webhook.ts';
import type { Logger } from '../_shared/logger.ts';
import { createLogger } from '../_shared/logger.ts';
import { createGenerationTrigger } from '../_shared/generation-trigger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';
import {
  createActionRepo,
  createChangeRequestRepo,
  createCheckinRepo,
  createCreationRepo,
  createDb,
  createDeliveryRepo,
  createQueryRepo,
  createTelegramRepo,
} from '../_shared/db.ts';
import { requireEnv } from '../_shared/env.ts';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Lo que el handler necesita del mundo exterior.
 *
 * El repo y el sender son funciones porque se construyen por petición: uno
 * necesita el `request_id` para propagarlo, el otro el logger de esa petición.
 */
export interface HandlerDeps {
  readonly expectedSecret: string;
  readonly repo: (requestId: string) => TelegramRepo;
  readonly sender: (log: Logger) => TelegramSender;
  readonly actionRepo: (requestId: string) => ActionRepo;
  readonly deliveryRepo: () => DeliveryRepo;
  readonly checkinRepo: () => CheckinRepo;
  readonly queryRepo: () => QueryRepo;
  readonly generation: (log: Logger) => GenerationTrigger;
  readonly creationRepo: (requestId: string) => CreationRepo;
  readonly changeRepo: (requestId: string) => ChangeRequestRepo;
}

/**
 * Lee el entorno y abre la conexión. **Se llama una vez, al arrancar.**
 *
 * Si falta un secreto, la función no llega a servir: revienta aquí, nombrando
 * la variable. Es el contrato que `_shared/env.ts` ya decía tener.
 */
export function readDeps(): HandlerDeps {
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const expectedSecret = requireEnv('TELEGRAM_WEBHOOK_SECRET');
  const db = createDb();

  return {
    expectedSecret,
    repo: (requestId) => createTelegramRepo(db, requestId),
    sender: (log) => asSender(createTelegramClient(botToken, log)),
    actionRepo: (requestId) => createActionRepo(db, requestId),
    deliveryRepo: () => createDeliveryRepo(db),
    checkinRepo: () => createCheckinRepo(db),
    queryRepo: () => createQueryRepo(db),
    generation: (log) => createGenerationTrigger(log),
    creationRepo: (requestId) => createCreationRepo(db, requestId),
    changeRepo: (requestId) => createChangeRequestRepo(db, requestId),
  };
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
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

    try {
      // El sender se construye una vez y lo comparten los cinco flujos: así
      // un mensaje del canje y uno de un botón salen por el mismo sitio y
      // quedan bajo el mismo `request_id`.
      const sender = deps.sender(log);

      const outcome = await handleTelegramWebhook(
        { secretHeader: request.headers.get(SECRET_HEADER), body },
        {
          repo: deps.repo(requestId),
          sender,
          expectedSecret: deps.expectedSecret,
          requestId,
          actions: {
            repo: deps.actionRepo(requestId),
            sender,
            generation: deps.generation(log),
            requestId,
          },
          delivery: { repo: deps.deliveryRepo(), sender },
          checkins: { repo: deps.checkinRepo(), sender },
          commands: { repo: deps.queryRepo(), sender },
          creation: { repo: deps.creationRepo(requestId), sender },
          changes: { repo: deps.changeRepo(requestId), sender },
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
    } catch (error) {
      // SPEC-012 regla 3: ninguna petición se muere en silencio. El dominio
      // ya captura lo suyo y devuelve `failed`; esto atrapa lo que pasa
      // FUERA de él, como construir un repo o el propio sender.
      log.error('telegram.excepcion', {
        // El mensaje, nunca el stack: un stack arrastra valores de variables.
        message: error instanceof Error ? error.message : 'Error desconocido.',
        durationMs: Date.now() - startedAt,
      });

      // 200 a propósito, igual que `failed`: un 500 haría que Telegram
      // reintentara en bucle un update que va a volver a romperse.
      return new Response('ok', { status: 200 });
    }
  };
}

// `import.meta.main` es falso cuando un test importa este módulo, así que
// importarlo no intenta leer el entorno ni abrir un puerto.
if (import.meta.main) {
  Deno.serve(createHandler(readDeps()));
}
