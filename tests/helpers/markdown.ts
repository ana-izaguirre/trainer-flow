/**
 * Detector de MarkdownV2 sin escapar, compartido entre los tests que mandan
 * mensajes de Telegram.
 *
 * ┌─ POR QUÉ EXISTE ────────────────────────────────────────────────────────┐
 * │ El bug que esto atrapa pasó tres veces en la misma semana (PR #57, #58) │
 * │ en archivos distintos: un `${clientName}` o un signo de puntuación sin  │
 * │ `escapeMarkdownV2`, que Telegram rechaza — el mensaje ENTERO, no solo   │
 * │ el carácter. Cada archivo tenía su propia copia de este detector; una   │
 * │ sola versión es una sola cosa que mantener correcta.                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Vive en `tests/helpers/`, no en `_core/`: es infraestructura de test, no
 * código que se despliega (ADR-001 no aplica aquí, pero mezclarlo con lo que
 * sí se despliega sería confuso igual).
 *
 * ┌─ DOS SINTAXIS QUE NO SON «UN ESPECIAL SUELTO» ─────────────────────────┐
 * │ `*negrita*` y `[texto](url)` (SPEC-019: el nombre de cada ejercicio es │
 * │ un enlace) son estructura, no texto que se olvidó escapar. Sin         │
 * │ reconocerlas, cualquier mensaje real con negrita o un link —el volcado │
 * │ completo de una rutina— disparaba un falso positivo. Nadie lo notó     │
 * │ porque hasta ahora ningún test pasaba ese mensaje por este detector.   │
 * └────────────────────────────────────────────────────────────────────────┘
 */
const ESPECIALES = new Set('\\_*[]()~`>#+-=|{}.!');

/**
 * ¿Telegram rechazaría este texto por tener un carácter especial suelto?
 */
export function tieneCaracterSinEscapar(texto: string): boolean {
  return escanear(texto, 0, null) === null;
}

/**
 * Escanea desde `inicio` hasta encontrar `cierre` sin escapar (negrita o el
 * texto de un link, que usan su propio carácter de cierre), o hasta el final
 * del texto si `cierre` es `null` (la llamada de más afuera).
 *
 * Devuelve el índice siguiente al cierre encontrado, o `null` si algo quedó
 * sin cerrar o hay un especial que no es parte de ninguna sintaxis conocida.
 */
function escanear(texto: string, inicio: number, cierre: '*' | ']' | null): number | null {
  let i = inicio;

  while (i < texto.length) {
    const c = texto[i]!;

    if (c === cierre) return i + 1;

    if (c === '\\') {
      i += 2; // la barra y lo que escapa cuentan como una sola unidad
      continue;
    }

    if (c === '`') {
      const valla = texto.startsWith('```', i) ? '```' : '`';
      const fin = texto.indexOf(valla, i + valla.length);
      if (fin === -1) return null;
      i = fin + valla.length;
      continue;
    }

    // Negrita: no anida consigo misma (un `*` buscando otro `*` no vuelve a
    // abrir), pero sí puede contener un link.
    if (c === '*' && cierre !== '*') {
      const fin = escanear(texto, i + 1, '*');
      if (fin === null) return null;
      i = fin;
      continue;
    }

    if (c === '[') {
      const finTexto = escanear(texto, i + 1, ']');
      if (finTexto === null || texto[finTexto] !== '(') return null;
      const finUrl = finDeUrl(texto, finTexto + 1);
      if (finUrl === null) return null;
      i = finUrl;
      continue;
    }

    if (ESPECIALES.has(c)) return null;
    i += 1;
  }

  // Se acabó el texto: válido solo si no quedó un cierre pendiente.
  return cierre === null ? i : null;
}

/**
 * La parte `(...)` de un link: MarkdownV2 exige escapar solo `\` y `)` ahí
 * (`escapeMarkdownV2LinkUrl`), no la lista completa de especiales.
 */
function finDeUrl(texto: string, inicio: number): number | null {
  let i = inicio;
  while (i < texto.length && texto[i] !== ')') {
    i += texto[i] === '\\' ? 2 : 1;
  }
  return i < texto.length ? i + 1 : null;
}
