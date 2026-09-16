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
import type { TelegramRepo, TelegramSender } from '../_core/ports/telegram-ports.ts';
import { handleTelegramWebhook, outcomeToStatus } from '../_core/telegram/webhook.ts';
import type { Logger } from '../_shared/logger.ts';
import { createLogger } from '../_shared/logger.ts';
import { asSender, createTelegramClient } from '../_shared/telegram/client.ts';
import { createDb, createTelegramRepo } from '../_shared/db.ts';
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

    const outcome = await handleTelegramWebhook(
      { secretHeader: request.headers.get(SECRET_HEADER), body },
      {
        repo: deps.repo(requestId),
        sender: deps.sender(log),
        expectedSecret: deps.expectedSecret,
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
  };
}

// `import.meta.main` es falso cuando un test importa este módulo, así que
// importarlo no intenta leer el entorno ni abrir un puerto.
if (import.meta.main) {
  Deno.serve(createHandler(readDeps()));
}
