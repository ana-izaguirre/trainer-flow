/**
 * SPEC-002 — Cómo se pide una generación desde fuera de `generate-version`.
 *
 * ┌─ SE DISPARA Y NO SE ESPERA ────────────────────────────────────────────┐
 * │ Generar tarda 10–30 segundos. Telegram reintenta el update si el       │
 * │ webhook tarda, así que esperar aquí produciría dos generaciones por    │
 * │ cada pulsación.                                                        │
 * │                                                                        │
 * │ Por eso `trigger` resuelve en cuanto la petición sale, no cuando       │
 * │ termina el trabajo. Quien pulsa recibe «generando…» y el resultado     │
 * │ llega después, en su propio mensaje.                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * **Quien dispara NO transiciona `NEW → GENERATING`.** Eso lo hace
 * `generate-version`, y es lo que serializa dos pulsaciones rápidas: la
 * segunda encuentra `GENERATING` y no llama al proveedor.
 */
export interface GenerationTrigger {
  /**
   * Pide que se genere esta versión.
   *
   * Resuelve cuando la petición se ha enviado. **Un fallo aquí no puede
   * tumbar el webhook**: la versión se queda en `NEW` y el entrenador vuelve
   * a pulsar, o usa una plantilla.
   */
  trigger(versionId: string, requestId: string): Promise<void>;
}
