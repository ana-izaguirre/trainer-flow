/**
 * SPEC-002 / ADR-007 — La interfaz que el dominio conoce de la IA.
 *
 * ┌─ AQUÍ NO SE NOMBRA A NINGÚN PROVEEDOR ─────────────────────────────────┐
 * │ Ni el modelo, ni la URL, ni la clave. Añadir otro proveedor es un      │
 * │ archivo nuevo en `_shared/ai/`; ni una línea de `_core` cambia.        │
 * │                                                                        │
 * │ Un test hace grep sobre `_core` buscando nombres de proveedores y      │
 * │ falla si aparece alguno (CA-8). Ya me pilló dos veces.                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * La IA es una CAPACIDAD del sistema, no la dueña del dominio: devuelve un
 * borrador y se va. Quien valida y persiste es el código.
 */
import type { WorkoutDraft } from '../domain/draft.ts';
import type { Level } from '../domain/assessment.ts';

export interface AIRequest {
  readonly goal: string;
  readonly level: Level;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
  readonly equipment: string;
  /** Información de salud. Va al prompt, **nunca a un log**. */
  readonly limitations: string | null;
  /** Para editar una versión existente. `null` al generar desde cero. */
  readonly instruction: string | null;

  // ── SPEC-016: lo que cambia cómo se programa ───────────────────────────
  readonly gender: string | null;
  readonly age: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  /** Falta de tiempo, de motivación, de dinero, de equipo… */
  readonly quitReasons: string | null;
  /**
   * Variable de programación, no diagnóstico: «postmenopáusica» se traduce en
   * más fuerza por densidad ósea y más margen de recuperación (SPEC-016 §3.1).
   */
  readonly menopauseStage: string | null;

  // ┌─ LO QUE NO ESTÁ AQUÍ, Y NO ES UN OLVIDO ────────────────────────────┐
  // │ `chronicConditions` NO tiene campo en este tipo, y por eso no puede │
  // │ llegar al proveedor: no hay dónde escribirlo.                       │
  // │                                                                     │
  // │ La IA no necesita saber «diabetes» para escribir una rutina.        │
  // │ Traducir eso en intensidad segura es criterio clínico, y es el      │
  // │ trabajo del entrenador — y su responsabilidad. Lo ve él en la       │
  // │ ficha 📄 y decide (SPEC-016 §3.2).                                  │
  // │                                                                     │
  // │ `lastWeighed` tampoco: dice si el peso es fiable, y eso lo juzga    │
  // │ una persona.                                                        │
  // └─────────────────────────────────────────────────────────────────────┘
}

export type AIFailureReason = 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'INVALID_OUTPUT';

export interface TokenUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
}

export type AIResult =
  | { readonly ok: true; readonly draft: WorkoutDraft; readonly usage: TokenUsage }
  | { readonly ok: false; readonly reason: AIFailureReason; readonly detail: string };

export interface AIProvider {
  /** Para `ai_generations.provider`. No lo usa ninguna decisión del dominio. */
  readonly name: string;
  readonly model: string;
  /**
   * `signal` lo controla quien llama: el timeout es una decisión del dominio
   * (regla 8: 45 segundos), no del proveedor.
   */
  generate(request: AIRequest, signal: AbortSignal): Promise<AIResult>;
}
