/**
 * El flujo del webhook de Tally, sin HTTP.
 *
 * Mismo contrato que el de Telegram (ADR-011): este módulo decide QUÉ PASÓ y
 * la Edge Function traduce eso a un código de estado. A cambio, todo el flujo
 * se prueba sin levantar un servidor.
 *
 * El ORDEN de los pasos es lo que este módulo garantiza:
 *
 *   1. Verificar la firma  → antes de tocar absolutamente nada
 *   2. Parsear el sobre    → dato no confiable
 *   3. Redactar            → las URLs de descarga llevan un JWT dentro
 *   4. Reclamar el evento  → idempotencia
 *
 * El paso 1 va primero **incluso antes de mirar si el cuerpo es JSON**. Al
 * revés, alguien sin la clave podría distinguir un cuerpo válido de uno
 * inválido por la respuesta que recibe.
 */
import { parseTallyEnvelope, redactCredentialUrls } from '../assessment/tally-envelope.ts';
import type { SignatureVerifier, TallyRepo } from '../ports/tally-ports.ts';

export type TallyOutcome =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'malformed'; readonly reason: string }
  | { readonly kind: 'duplicate'; readonly eventId: string }
  | { readonly kind: 'claimed'; readonly eventId: string; readonly formId: string }
  | { readonly kind: 'failed'; readonly message: string };

export interface TallyInput {
  /**
   * El cuerpo **sin parsear**. La firma se calcula sobre estos bytes exactos:
   * volver a serializar el JSON cambiaría espacios y orden, y el HMAC ya no
   * cuadraría.
   */
  readonly rawBody: string;
  readonly signature: string | null;
}

export interface TallyDeps {
  readonly repo: TallyRepo;
  readonly verifier: SignatureVerifier;
  readonly requestId: string;
}

/**
 * Traduce el resultado a un código HTTP.
 *
 * `failed` devuelve **500 a propósito**: Tally reintenta, y la idempotencia
 * hace que el reintento sea seguro. Es lo contrario que en Telegram, donde un
 * 500 provocaría un bucle sobre un update que nunca va a procesarse bien.
 */
export function outcomeToStatus(outcome: TallyOutcome): number {
  switch (outcome.kind) {
    case 'unauthorized':
      return 401;
    case 'malformed':
      return 400;
    case 'failed':
      return 500;
    default:
      return 200;
  }
}

export async function handleTallyWebhook(
  input: TallyInput,
  deps: TallyDeps,
): Promise<TallyOutcome> {
  // ── 1. La firma, antes de tocar nada ───────────────────────────────────
  if (input.signature === null) return { kind: 'unauthorized' };
  if (!(await deps.verifier.matches(input.rawBody, input.signature))) {
    return { kind: 'unauthorized' };
  }

  // ── 2. El sobre es dato no confiable ───────────────────────────────────
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { kind: 'malformed', reason: 'El cuerpo no es JSON.' };
  }

  const sobre = parseTallyEnvelope(body);
  if (!sobre.ok) return { kind: 'malformed', reason: sobre.error };

  try {
    // ── 3 y 4. Redactar, y reclamar ──────────────────────────────────────
    const isNew = await deps.repo.claimEvent(
      sobre.value.eventId,
      redactCredentialUrls(body),
      deps.requestId,
    );
    if (!isNew) return { kind: 'duplicate', eventId: sobre.value.eventId };

    // Crear cliente, evaluación y plan es S-14. Hoy el flujo ya verifica,
    // redacta y registra: lo que falta es qué escribir.
    await deps.repo.markProcessed(sobre.value.eventId);

    return { kind: 'claimed', eventId: sobre.value.eventId, formId: sobre.value.formId };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    };
  }
}
