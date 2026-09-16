/**
 * Lectura de la configuración del entorno.
 *
 * Los secretos llegan por `supabase secrets set`, nunca desde un archivo del
 * repositorio. Este módulo vive en `_shared` porque `Deno.env` es I/O y en
 * `_core` está prohibido (ADR-001).
 */

/** Falla al arrancar si falta algo, en vez de fallar a mitad de una petición. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value;
}

export function optionalEnv(name: string): string | null {
  const value = Deno.env.get(name);
  return value === undefined || value.length === 0 ? null : value;
}
