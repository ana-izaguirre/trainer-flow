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

  /** Cuándo se pesó por última vez: dice si el peso es fiable. */
  readonly lastWeighed: string | null;

  // ┌─ CONTEXTO CLÍNICO ──────────────────────────────────────────────────┐
  // │ Enfermedades propias o familiares, y fármacos.                      │
  // │                                                                     │
  // │ Decisión de Ana: la IA recibe todo el contexto. El seguro no        │
  // │ cambia — `DRAFT → SENT` no existe, así que el entrenador aprueba    │
  // │ cada rutina antes de que salga.                                     │
  // │                                                                     │
  // │ Lo que hace que esto funcione es que el prompt OBLIGA al modelo a   │
  // │ declarar en `warnings` qué tuvo en cuenta y qué decidió por ello.   │
  // │ Así el entrenador revisa decisiones, no tiene que adivinar por qué  │
  // │ la rutina salió como salió (SPEC-016 §3.2).                         │
  // └─────────────────────────────────────────────────────────────────────┘
  readonly chronicConditions: string | null;
  readonly medications: string | null;

  /** «Sedentario, trabajo de oficina». Cambia el volumen y la recuperación. */
  readonly lifestyle: string | null;
  /** Lo que el cliente quiso contar con sus palabras. */
  readonly notes: string | null;
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
