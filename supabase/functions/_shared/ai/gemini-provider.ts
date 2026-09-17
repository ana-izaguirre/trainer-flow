/**
 * SPEC-002 / ADR-007 — La implementación del proveedor de IA.
 *
 * **Este es el único archivo del repositorio donde vive la clave de la API.**
 * `_core` solo conoce la interfaz `AIProvider`, y un test hace grep para que
 * siga siendo así.
 *
 * ┌─ LA CLAVE VA EN CABECERA, NO EN LA URL ────────────────────────────────┐
 * │ La documentación del proveedor enseña `?key=...`. Una URL acaba en los │
 * │ logs de errores, en las trazas y en los mensajes de excepción; una     │
 * │ cabecera, no. Cuesta lo mismo escribirlo bien.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * **El prompt no se loguea nunca**: lleva datos de salud. Sí sus metadatos —
 * tokens, latencia, resultado (SPEC-002 §7).
 */
import { buildPrompt } from '../../_core/ai/prompt-builder.ts';
import type {
  AIProvider,
  AIRequest,
  AIResult,
  TokenUsage,
} from '../../_core/ports/ai-provider.ts';
import type { Logger } from '../logger.ts';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface ProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly log: Logger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** El texto que devolvió el modelo, o `null` si la respuesta no tiene la forma esperada. */
function readText(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const candidates = payload['candidates'];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const first = candidates[0];
  if (!isRecord(first) || !isRecord(first['content'])) return null;

  const parts = (first['content'] as Record<string, unknown>)['parts'];
  if (!Array.isArray(parts) || parts.length === 0) return null;

  const part = parts[0];
  if (!isRecord(part) || typeof part['text'] !== 'string') return null;

  return part['text'];
}

/** Los contadores de tokens. Ausentes o raros cuentan como cero: son telemetría. */
function readUsage(payload: unknown): TokenUsage {
  const meta = isRecord(payload) ? payload['usageMetadata'] : null;
  const leer = (campo: string): number => {
    const valor = isRecord(meta) ? meta[campo] : null;
    return typeof valor === 'number' ? valor : 0;
  };

  return { tokensIn: leer('promptTokenCount'), tokensOut: leer('candidatesTokenCount') };
}

export function createProvider({ apiKey, model, log }: ProviderOptions): AIProvider {
  return {
    name: 'google',
    model,

    async generate(request: AIRequest, signal: AbortSignal): Promise<AIResult> {
      const started = Date.now();

      // `responseMimeType` obliga a JSON. La FORMA va en el prompt, que ya la
      // describe campo a campo con sus límites.
      //
      // No se manda `responseSchema` todavía: su dialecto es un subconjunto
      // de OpenAPI que no hemos podido verificar contra la API real, y una
      // traducción mal hecha devolvería 400 en TODAS las llamadas. El control
      // de verdad es `validateDraft`, que corre pase lo que pase.
      const body = {
        contents: [{ parts: [{ text: buildPrompt(request) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
      };

      let response: Response;
      try {
        response = await fetch(`${API_BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        // Un abort es el timeout que puso quien llama (regla 8: 45 segundos).
        const abortado = signal.aborted || (error as { name?: string }).name === 'AbortError';
        const reason = abortado ? 'TIMEOUT' : 'API_ERROR';

        log.warn('ai.fallo_red', { reason, durationMs: Date.now() - started });
        return { ok: false, reason, detail: abortado ? 'Se agotó el tiempo.' : 'Fallo de red.' };
      }

      const durationMs = Date.now() - started;

      if (!response.ok) {
        // 429 NO se reintenta (regla 8): reintentar sobre una cuota agotada
        // la agota más. El sistema degrada a plantilla o manual.
        const reason = response.status === 429 ? 'RATE_LIMITED' : 'API_ERROR';

        log.warn('ai.error', { reason, status: response.status, durationMs });
        return { ok: false, reason, detail: `El proveedor respondió ${response.status}.` };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        log.warn('ai.respuesta_ilegible', { durationMs });
        return { ok: false, reason: 'INVALID_OUTPUT', detail: 'La respuesta no es JSON.' };
      }

      const text = readText(payload);
      if (text === null) {
        log.warn('ai.respuesta_sin_texto', { durationMs });
        return { ok: false, reason: 'INVALID_OUTPUT', detail: 'La respuesta no trae contenido.' };
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        log.warn('ai.json_invalido', { durationMs });
        return { ok: false, reason: 'INVALID_OUTPUT', detail: 'El modelo no devolvió JSON.' };
      }

      const usage = readUsage(payload);
      log.info('ai.ok', { durationMs, ...usage });

      // `raw` es `unknown` a propósito: nadie lo lee hasta que `validateDraft`
      // lo apruebe. Que el JSON parseara no dice nada de su contenido.
      return { ok: true, draft: { source: 'ai', raw }, usage };
    },
  };
}
