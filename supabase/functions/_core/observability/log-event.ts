/**
 * Formato de los logs estructurados.
 *
 * Una línea JSON por evento, que es lo que Supabase Logs sabe consultar. No se
 * añade infraestructura de observabilidad: con este volumen, Supabase alcanza.
 *
 * ┌─ LA RED DE SEGURIDAD ──────────────────────────────────────────────────┐
 * │ Redacta por NOMBRE DE CAMPO, no por confianza en quien llama. Si       │
 * │ alguien loguea `limitationsDetail` por descuido, sale `[redactado]`.   │
 * │ Un dato de salud en un log es un incidente, no un despiste.            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Esto es formateo puro: el `console.log` lo hace `_shared/logger.ts`, porque
 * escribir a stdout es I/O y aquí no se hace I/O (ADR-001).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  /** Qué pasó, en punto: `version.aprobada`, `webhook.duplicado`. */
  readonly event: string;
  readonly level: LogLevel;
  /** Cruza el log con `webhook_events`, `plan_events` y `ai_generations`. */
  readonly requestId: string;
  readonly [key: string]: unknown;
}

const REDACTED = '[redactado]';

/**
 * Fragmentos que marcan un campo como no logueable.
 *
 * Se comparan contra el nombre normalizado (minúsculas, sin guiones ni
 * subrayados), así que `X-Api-Key`, `api_key` y `apiKey` caen los tres.
 */
const SENSITIVE_FRAGMENTS = [
  'secret',
  'password',
  'authorization',
  'apikey',
  'linktoken',
  'limitation',
  'comment',
  'answers',
] as const;

/** Campos que contienen la palabra pero son métricas, no credenciales. */
const ALLOWED_EXACT = new Set(['tokencount', 'tokensin', 'tokensout']);

function normalize(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function isSensitive(key: string): boolean {
  const normalized = normalize(key);
  if (ALLOWED_EXACT.has(normalized)) return false;
  if (normalized === 'token' || normalized.endsWith('token')) return true;
  return SENSITIVE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function formatLogLine(event: LogEvent): string {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (value === undefined) continue;
    safe[key] = isSensitive(key) ? REDACTED : value;
  }

  try {
    return JSON.stringify(safe);
  } catch {
    // Una referencia circular no puede tumbar el logging de un webhook.
    return JSON.stringify({
      event: event.event,
      level: event.level,
      requestId: event.requestId,
      logError: 'No se pudo serializar el evento.',
    });
  }
}
