/**
 * SPEC-002 regla 2 — Control de cuota por VENTANA, no por saldo.
 *
 * ┌─ POR QUÉ UNA VENTANA Y NO UN CONTADOR ─────────────────────────────────┐
 * │ Un saldo hay que guardarlo, decrementarlo y reponerlo. Cualquiera de   │
 * │ esos tres pasos puede quedarse a medias, y entonces el sistema cree    │
 * │ que no tiene cuota cuando sí la tiene —o al revés.                     │
 * │                                                                        │
 * │ Una ventana se calcula contando filas que YA EXISTEN en               │
 * │ `ai_generations`. No hay estado que corromper, y se repone sola.       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Esto es cálculo puro: quien lee las fechas de la base es `_shared`.
 */

export interface RateLimitConfig {
  /** Llamadas permitidas dentro de la ventana. `0` apaga la IA sin desplegar. */
  readonly maxCalls: number;
  readonly windowMinutes: number;
}

export type RateLimitResult =
  | { readonly allowed: true; readonly remaining: number }
  | {
      readonly allowed: false;
      readonly remaining: 0;
      /** Cuándo se libera el primer hueco. `0` si el límite es 0. */
      readonly retryAfterMinutes: number;
    };

const MS_POR_MINUTO = 60_000;

export function checkRateLimit(
  calls: readonly Date[],
  config: RateLimitConfig,
  now: Date,
): RateLimitResult {
  const windowStart = now.getTime() - config.windowMinutes * MS_POR_MINUTO;

  // `>=` y no `>`: una llamada justo en el borde todavía cuenta. Excluirla
  // dejaría pasar una llamada de más en cada ventana.
  //
  // Una fecha en el futuro —relojes desincronizados entre la base y la
  // función— también entra: ante la duda, se cuenta.
  const recientes = calls.filter((fecha) => fecha.getTime() >= windowStart);

  if (recientes.length < config.maxCalls) {
    return { allowed: true, remaining: config.maxCalls - recientes.length };
  }

  return {
    allowed: false,
    remaining: 0,
    retryAfterMinutes: minutosHastaElPrimerHueco(recientes, config, now),
  };
}

/**
 * Cuándo sale de la ventana la llamada MÁS ANTIGUA de las que cuentan.
 *
 * Es la primera que expira, y por tanto la que libera el hueco. Decir un
 * número mayor haría esperar de más; uno menor haría reintentar en vano.
 */
function minutosHastaElPrimerHueco(
  recientes: readonly Date[],
  config: RateLimitConfig,
  now: Date,
): number {
  // Sin llamadas solo se llega aquí con `maxCalls = 0`: la IA está apagada a
  // propósito y esperar no la enciende.
  if (recientes.length === 0) return 0;

  const masAntigua = Math.min(...recientes.map((fecha) => fecha.getTime()));
  const expiraEn = masAntigua + config.windowMinutes * MS_POR_MINUTO - now.getTime();

  // Se redondea hacia arriba: reintentar un segundo antes volvería a fallar.
  return Math.max(0, Math.ceil(expiraEn / MS_POR_MINUTO));
}
