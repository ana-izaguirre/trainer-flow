/**
 * Decide con qué `requestId` corre una petición.
 *
 * ┌─ POR QUÉ ESTO EXISTE ──────────────────────────────────────────────────┐
 * │ `telegram-webhook` dispara `generate-version` sin esperarla. Son dos   │
 * │ peticiones HTTP distintas, así que sin un identificador compartido la  │
 * │ traza se corta justo en el único salto asíncrono del sistema.          │
 * │                                                                        │
 * │ Quien dispara manda su `requestId` en el cuerpo. Quien recibe lo usa   │
 * │ en vez de inventarse otro — eso es todo lo que hace falta para que     │
 * │ una búsqueda devuelva la cadena entera.                                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * La generación del identificador entra por parámetro: aquí no se llama a
 * `crypto`, para que los tests sean deterministas y `_core` siga puro.
 */

/** UUID v4 canónico, que es lo que acepta una columna `uuid` de Postgres. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequestIdChoice {
  readonly requestId: string;
  /**
   * `true` solo cuando llegó un valor y hubo que descartarlo.
   *
   * No llegar nada es normal (un `curl` a mano, un disparo en vuelo durante
   * un despliegue). Llegar algo con forma inválida es un síntoma, y quien
   * lee los logs merece verlo.
   */
  readonly rejected: boolean;
}

/**
 * Se exige un UUID aunque quien llama sea de confianza: el identificador
 * acaba en una columna `uuid`, y uno con otra forma haría fallar la
 * escritura. Perder la correlación es malo; perder la fila es peor.
 */
export function chooseRequestId(candidate: unknown, newId: () => string): RequestIdChoice {
  if (candidate === undefined || candidate === null) {
    return { requestId: newId(), rejected: false };
  }

  if (typeof candidate === 'string' && UUID_PATTERN.test(candidate)) {
    return { requestId: candidate, rejected: false };
  }

  return { requestId: newId(), rejected: true };
}
