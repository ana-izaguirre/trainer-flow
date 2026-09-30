/**
 * SPEC-002 regla 8 — compartida con SPEC-004: generar y editar llaman al
 * mismo proveedor, y el reintento es la MISMA regla en los dos casos.
 *
 * Cada intento estrena su propio timeout: reusar el primero le daría al
 * segundo lo que quedara del reloj, que puede ser nada.
 */
import type { AIFailureReason, AIProvider, AIRequest, AIResult } from '../ports/ai-provider.ts';

/**
 * Qué fallos merecen un segundo intento.
 *
 * `RATE_LIMITED` no: reintentar sobre una cuota agotada la agota más.
 * `INVALID_OUTPUT` tampoco: la misma petición devolvería la misma basura.
 */
const REINTENTABLES: readonly AIFailureReason[] = ['API_ERROR', 'TIMEOUT'];

export async function callWithRetry(
  provider: AIProvider,
  request: AIRequest,
  newTimeoutSignal: () => AbortSignal,
): Promise<AIResult> {
  const primera = await provider.generate(request, newTimeoutSignal());

  if (primera.ok || !REINTENTABLES.includes(primera.reason)) return primera;

  return provider.generate(request, newTimeoutSignal());
}
