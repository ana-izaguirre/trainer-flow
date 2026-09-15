/**
 * Verificación del secreto del webhook.
 *
 * Es lo PRIMERO que corre en cada petición entrante (SPEC-003 regla 1). Si no
 * coincide, se responde 401 sin tocar la base de datos.
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
export function secretsMatch(received: string | null | undefined, expected: string): boolean {
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
