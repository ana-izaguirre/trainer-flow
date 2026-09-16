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
import { handleTallyWebhook, outcomeToStatus } from '../_core/tally/webhook.ts';
import { createDb, createTallyRepo } from '../_shared/db.ts';
import { requireEnv } from '../_shared/env.ts';
import { createLogger } from '../_shared/logger.ts';
import { createSignatureVerifier, readSignatureHeader } from '../_shared/tally/signature.ts';

export interface HandlerDeps {
  readonly verifier: SignatureVerifier;
  readonly repo: (requestId: string) => TallyRepo;
}

/**
 * Lee el entorno y abre la conexión. **Se llama una vez, al arrancar.**
 *
 * Si falta un secreto, la función no llega a servir: revienta aquí nombrando
 * la variable, en vez de fallar con el primer envío real (SPEC-011 §2).
 */
export function readDeps(): HandlerDeps {
  const verifier = createSignatureVerifier(requireEnv('TALLY_SIGNING_SECRET'));
  const db = createDb();

  return { verifier, repo: (requestId) => createTallyRepo(db, requestId) };
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = crypto.randomUUID();
    const log = createLogger(requestId);
    const startedAt = Date.now();

    const rawBody = await request.text();

    const outcome = await handleTallyWebhook(
      { rawBody, signature: readSignatureHeader(request.headers) },
      { repo: deps.repo(requestId), verifier: deps.verifier, requestId },
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
  };
}

if (import.meta.main) {
  Deno.serve(createHandler(readDeps()));
}
