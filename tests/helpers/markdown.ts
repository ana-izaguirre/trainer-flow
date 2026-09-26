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
 */
const ESPECIALES = new Set('\\_*[]()~`>#+-=|{}.!');

/**
 * ¿Telegram rechazaría este texto por tener un carácter especial suelto?
 *
 * El código (```bloque``` o `en línea`) se salta entero: dentro, MarkdownV2
 * solo exige escapar ` y \\. Uno sin cerrar sí cuenta como error, que es lo
 * que Telegram haría con él (SPEC-022 M1).
 */
export function tieneCaracterSinEscapar(texto: string): boolean {
  let i = 0;
  while (i < texto.length) {
    if (texto[i] === '\\') {
      i += 2; // la barra y lo que escapa cuentan como una sola unidad
      continue;
    }
    if (texto[i] === '`') {
      const valla = texto.startsWith('```', i) ? '```' : '`';
      const cierre = texto.indexOf(valla, i + valla.length);
      if (cierre === -1) return true;
      i = cierre + valla.length;
      continue;
    }
    if (ESPECIALES.has(texto[i]!)) return true;
    i += 1;
  }
  return false;
}
