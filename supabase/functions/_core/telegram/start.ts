/**
 * SPEC-005 §3 — el token que viaja dentro de `/start`.
 *
 * ┌─ POR QUÉ SE COMPRUEBA LA FORMA ANTES DE CONSULTAR ─────────────────────┐
 * │ `/start` lo puede escribir cualquiera con cualquier cosa detrás. Un    │
 * │ token con forma imposible no llega a tocar la base de datos: se        │
 * │ descarta aquí, sin consulta y sin dejar rastro de lo que se intentó.   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * **Lo que sale de aquí sigue siendo dato no confiable.** Tener la forma
 * correcta no lo hace válido; eso lo decide la base al buscarlo.
 */

/**
 * El alfabeto de base64url, que es el que produce `newLinkToken`, y el único
 * que Telegram acepta en el argumento de un deep link.
 *
 * Los límites son los de la base (`length between 16 and 64`) y el de Telegram
 * (64) a la vez: por eso no hay dos constantes que puedan desalinearse.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** El token del `/start`, o `null` si esto no es un canje. */
export function parseStartToken(command: string, args: string): string | null {
  if (command !== 'start') return null;

  // Un `/start` a secas es legítimo: alguien abriendo el bot sin enlace.
  return TOKEN_PATTERN.test(args) ? args : null;
}
