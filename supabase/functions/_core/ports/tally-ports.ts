/**
 * Lo que el flujo del webhook de Tally necesita del mundo exterior.
 *
 * Mismo patrón que `telegram-ports.ts`: `_core` declara qué necesita, no cómo
 * se consigue. Quien las implementa vive en `_shared`.
 */

export interface TallyRepo {
  /**
   * Registra el evento. Devuelve `false` si ya se había procesado.
   *
   * La idempotencia es el `UNIQUE (source, external_id)` de la base de datos,
   * no una comprobación previa: dos entregas simultáneas del mismo `eventId`
   * no pueden pasar las dos.
   */
  claimEvent(externalId: string, payload: unknown, requestId: string): Promise<boolean>;

  markProcessed(externalId: string): Promise<void>;
}

/**
 * Verifica la firma del cuerpo crudo.
 *
 * Está fuera de `_core` porque calcular un HMAC necesita `crypto.subtle`, y
 * el ADR-001 mantiene el dominio sin APIs de plataforma. Lo que `_core` sí
 * garantiza es **cuándo** se llama: antes de absolutamente todo lo demás.
 */
export interface SignatureVerifier {
  /** `true` si la firma corresponde al cuerpo. Comparación en tiempo constante. */
  matches(rawBody: string, signature: string): Promise<boolean>;
}
