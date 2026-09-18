/**
 * SPEC-002 — Dispara `generate-version` sin esperarla.
 *
 * ┌─ POR QUÉ NO SE ESPERA LA RESPUESTA ────────────────────────────────────┐
 * │ Generar tarda 10–30 segundos. Telegram reintenta el update si el       │
 * │ webhook tarda, así que esperar aquí produciría DOS generaciones por    │
 * │ cada pulsación del botón.                                              │
 * │                                                                        │
 * │ `trigger` resuelve en cuanto la petición sale. El resultado llega al   │
 * │ entrenador como un mensaje aparte, que manda `generate-version`.       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ EL RUNTIME NO PUEDE MORIRSE A MEDIAS ─────────────────────────────────┐
 * │ Una Edge Function puede terminar en cuanto devuelve la respuesta, y    │
 * │ una petición a medio enviar se cortaría. `EdgeRuntime.waitUntil` le    │
 * │ dice al runtime que espere a esa promesa aunque el handler ya haya     │
 * │ contestado.                                                            │
 * │                                                                        │
 * │ No existe fuera de Supabase —en `deno test` no está—, así que se       │
 * │ comprueba antes de usarlo en vez de darlo por hecho.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { GenerationTrigger } from '../_core/ports/generation-trigger.ts';
import type { Logger } from './logger.ts';
import { requireEnv } from './env.ts';

/** Lo que Supabase inyecta en el runtime de una Edge Function. */
interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
}

function edgeRuntime(): EdgeRuntimeLike | null {
  const candidato = (globalThis as Record<string, unknown>)['EdgeRuntime'];

  return typeof candidato === 'object' &&
    candidato !== null &&
    typeof (candidato as EdgeRuntimeLike).waitUntil === 'function'
    ? (candidato as EdgeRuntimeLike)
    : null;
}

export function createGenerationTrigger(log: Logger): GenerationTrigger {
  // Se leen al construir, no por petición: una variable mal escrita revienta
  // al arrancar la función y no en el primer botón que alguien pulse.
  const baseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return {
    trigger(versionId, requestId) {
      const pendiente = fetch(`${baseUrl}/functions/v1/generate-version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // La clave va en cabecera, nunca en la URL: las URLs acaban en los
          // logs de acceso y esta es una credencial de servicio.
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ versionId, requestId }),
      })
        .then((response) => {
          // Un fallo aquí NO puede tumbar el webhook: la versión sigue en NEW
          // y el entrenador puede reintentar o usar una plantilla.
          if (!response.ok) {
            log.warn('generation.trigger_rejected', { versionId, status: response.status });
          }
        })
        .catch((error: unknown) => {
          log.warn('generation.trigger_failed', {
            versionId,
            message: error instanceof Error ? error.message : 'Error desconocido.',
          });
        });

      edgeRuntime()?.waitUntil(pendiente);

      // Se resuelve YA, no cuando termine: ese es el punto del disparo.
      return Promise.resolve();
    },
  };
}
