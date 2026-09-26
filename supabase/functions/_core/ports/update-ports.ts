/**
 * SPEC-027 — Lo que pedir una actualización de datos necesita del exterior.
 *
 * Los dos métodos ESCRIBEN (emiten un token), por eso no viven en
 * `QueryRepo`, que es de solo lectura a propósito (SPEC-007 §5).
 *
 * Reciben el token EN CLARO: el hash lo calcula la base de datos
 * (`update_token_hash`, migración 0026), y `_core` no tiene crypto.
 */
export interface UpdateTokenRepo {
  /**
   * El cliente pide el SUYO. Recibe su perfil, no un id de cliente: no hay
   * dónde poner el de otro. Devuelve el cliente, o `null` si ese perfil no
   * es de ninguno.
   */
  issueForProfile(profileId: string, token: string): Promise<string | null>;

  /**
   * El entrenador lo pide para un cliente suyo; la pertenencia la comprueba
   * `_core` antes. Devuelve el chat del cliente, o `null` si no está
   * vinculado (y entonces no se emitió nada).
   */
  issueForClient(clientId: string, token: string): Promise<number | null>;
}
