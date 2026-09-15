/**
 * Emite los logs estructurados a stdout, que es lo que Supabase Logs captura.
 *
 * El formateo y la redacción viven en `_core/observability/log-event.ts`, que
 * es puro y testeable. Aquí solo se escribe.
 */
import type { LogEvent, LogLevel } from '../_core/observability/log-event.ts';
import { formatLogLine } from '../_core/observability/log-event.ts';

export interface Logger {
  readonly requestId: string;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(requestId: string): Logger {
  const emit = (level: LogLevel, event: string, fields: Record<string, unknown> = {}): void => {
    const payload: LogEvent = { event, level, requestId, ...fields };
    console.log(formatLogLine(payload));
  };

  return {
    requestId,
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
