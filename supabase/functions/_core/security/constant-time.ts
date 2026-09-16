/**
 * Comparación de secretos en tiempo constante.
 *
 * Vive fuera de `telegram/` porque no es de Telegram: el webhook de Telegram
 * compara un secreto compartido y el de Tally compara un digest HMAC. Las dos
 * comparaciones tienen el mismo requisito, y duplicar una primitiva de
 * seguridad es peor que moverla.
 */

/**
 * Compara dos secretos en tiempo constante.
 *
 * Una comparación normal (`a === b`) corta en la primera diferencia, y el
 * tiempo que tarda revela cuántos caracteres acertó quien la envió. Esto
 * recorre siempre la misma cantidad de trabajo.
 *
 * Un `expected` vacío devuelve **false siempre**: una configuración a medias
 * no puede convertirse en "todo el mundo pasa".
 */
export function constantTimeEquals(received: string | null | undefined, expected: string): boolean {
  if (expected.length === 0) return false;
  if (typeof received !== 'string') return false;

  // La diferencia de longitud se acumula en vez de cortar, para no revelar
  // por tiempo cuántos caracteres tiene el secreto correcto.
  let diff = received.length ^ expected.length;

  for (let i = 0; i < received.length; i += 1) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i % expected.length);
  }

  return diff === 0;
}
