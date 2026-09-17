/**
 * SPEC-002 — La orquestación de una generación con IA.
 *
 * ┌─ LO QUE ESTE MÓDULO GARANTIZA ─────────────────────────────────────────┐
 * │ El sistema NUNCA queda bloqueado. Pase lo que pase con la IA, la       │
 * │ versión termina en un estado desde el que el entrenador puede seguir   │
 * │ con una plantilla o a mano, sobre la MISMA versión.                    │
 * │                                                                        │
 * │ Un fallo devuelve la versión a `NEW`. No la mata.                      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * El orden:
 *
 *   1. Buscar la versión       → si no está en NEW, no se hace nada
 *   2. Consultar la cuota      → SIN MARGEN NO SE LLAMA (regla 1)
 *   3. NEW → GENERATING        → y esa transición es la guarda de concurrencia
 *   4. Registrar la llamada    → antes de hacerla, para que ninguna se pierda
 *   5. Llamar al proveedor     → con un reintento, y nunca sobre un 429
 *   6. Validar                 → `validateDraft`, pase lo que pase
 *   7. Guardar, o volver a NEW
 *
 * Aquí no hay `fetch`, ni SQL, ni relojes: todo entra por `deps`.
 */
import { validateDraft } from '../domain/validate-draft.ts';
import { nextState } from '../domain/state-machine.ts';
import type { VersionState } from '../domain/version.ts';
import type {
  AIFailureReason,
  AIProvider,
  AIRequest,
  AIResult,
} from '../ports/ai-provider.ts';
import type { GenerationRepo } from '../ports/generation-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { checkRateLimit, type RateLimitConfig } from './rate-limit.ts';

export type GenerateOutcome =
  | { readonly kind: 'not_found' }
  /** Ya se generó, o alguien se adelantó. Es idempotencia, no un error. */
  | { readonly kind: 'not_in_new'; readonly state: VersionState }
  | { readonly kind: 'rate_limited'; readonly retryAfterMinutes: number }
  | { readonly kind: 'generated'; readonly versionId: string }
  | { readonly kind: 'generation_failed'; readonly reason: AIFailureReason };

export interface GenerateDeps {
  readonly repo: GenerationRepo;
  readonly provider: AIProvider;
  readonly sender: TelegramSender;
  readonly rateLimit: RateLimitConfig;
  /** El timeout de la regla 8. Lo crea `_shared`: `_core` no tiene relojes. */
  readonly newTimeoutSignal: () => AbortSignal;
  readonly now: () => Date;
}

/**
 * Qué fallos merecen un segundo intento.
 *
 * `RATE_LIMITED` no: reintentar sobre una cuota agotada la agota más.
 * `INVALID_OUTPUT` tampoco: la misma petición devolvería la misma basura.
 */
const REINTENTABLES: readonly AIFailureReason[] = ['API_ERROR', 'TIMEOUT'];

const AVISOS: Readonly<Record<AIFailureReason, string>> = {
  RATE_LIMITED: 'La IA no tiene margen ahora mismo.',
  TIMEOUT: 'La IA tardó demasiado.',
  API_ERROR: 'La IA no respondió.',
  INVALID_OUTPUT: 'La IA devolvió una rutina que no se pudo leer.',
};

const ALTERNATIVA = 'Puedes cargar una plantilla o escribirla a mano sobre esta misma versión.';

export async function generateVersion(
  versionId: string,
  deps: GenerateDeps,
): Promise<GenerateOutcome> {
  const version = await deps.repo.findVersion(versionId);
  if (version === null) return { kind: 'not_found' };

  // ── 1. Solo desde NEW ──────────────────────────────────────────────────
  // CA-6: reinvocar sobre una versión ya generada no puede tirar el trabajo
  // del entrenador ni gastar cuota.
  if (nextState(version.state, 'GENERATE') === null) {
    return { kind: 'not_in_new', state: version.state };
  }

  // ── 2. La cuota, ANTES de llamar ───────────────────────────────────────
  const cuota = checkRateLimit(
    await deps.repo.recentGenerations(deps.rateLimit.windowMinutes),
    deps.rateLimit,
    deps.now(),
  );

  if (!cuota.allowed) {
    // La versión no se toca: sigue en NEW y el entrenador puede seguir.
    await avisar(deps, version.trainerChatId, AVISOS.RATE_LIMITED);
    return { kind: 'rate_limited', retryAfterMinutes: cuota.retryAfterMinutes };
  }

  // ── 3. NEW → GENERATING, que además serializa ──────────────────────────
  // Si dos peticiones llegan a la vez, solo una gana esta transición. Sin
  // ella, dos pulsaciones del botón harían dos llamadas al proveedor.
  const generating = nextState(version.state, 'GENERATE');
  if (generating === null || !(await deps.repo.transition(versionId, version.state, generating))) {
    return { kind: 'not_in_new', state: version.state };
  }

  // ── 4. Registrar antes de llamar (regla 3) ─────────────────────────────
  // Si se registrara después, una función que muere a mitad dejaría una
  // llamada consumida e invisible.
  const generationId = await deps.repo.startGeneration({
    provider: deps.provider.name,
    model: deps.provider.model,
    versionId,
  });

  const started = deps.now().getTime();
  const result = await llamarConReintento(deps, version.request);
  const latencyMs = deps.now().getTime() - started;

  // ── 5. Lo que devuelve es dato no confiable ────────────────────────────
  if (result.ok) {
    const validado = validateDraft(result.draft, version.constraints);

    if (validado.ok) {
      await deps.repo.saveContent(versionId, validado.workout);
      await deps.repo.finishGeneration(generationId, {
        status: 'SUCCEEDED',
        usage: result.usage,
        latencyMs,
      });
      await aplicar(deps, versionId, generating, 'GENERATION_SUCCEEDED');
      return { kind: 'generated', versionId };
    }
  }

  // ── 6. Cualquier fallo devuelve la versión a NEW ───────────────────────
  const reason: AIFailureReason = result.ok ? 'INVALID_OUTPUT' : result.reason;

  await deps.repo.finishGeneration(generationId, {
    status: 'FAILED',
    failureReason: reason,
    latencyMs,
  });
  await aplicar(deps, versionId, generating, 'GENERATION_FAILED');
  await avisar(deps, version.trainerChatId, AVISOS[reason]);

  return { kind: 'generation_failed', reason };
}

/**
 * Un intento, y uno más solo si el fallo puede salir distinto (regla 8).
 *
 * Cada intento estrena su propio timeout: reusar el primero le daría al
 * segundo lo que quedara del reloj, que puede ser nada.
 */
async function llamarConReintento(deps: GenerateDeps, request: AIRequest): Promise<AIResult> {
  const primera = await deps.provider.generate(request, deps.newTimeoutSignal());

  if (primera.ok || !REINTENTABLES.includes(primera.reason)) return primera;

  return deps.provider.generate(request, deps.newTimeoutSignal());
}

/** Aplica una transición que la máquina de estados ya aprobó. */
async function aplicar(
  deps: GenerateDeps,
  versionId: string,
  from: VersionState,
  event: 'GENERATION_SUCCEEDED' | 'GENERATION_FAILED',
): Promise<void> {
  const to = nextState(from, event);
  // `null` es imposible desde GENERATING, pero el tipo lo admite y suponer
  // que no pasa es cómo se cuelan los bugs de estado.
  if (to !== null) await deps.repo.transition(versionId, from, to);
}

/** Un aviso que falla no puede tumbar la generación que sí funcionó. */
async function avisar(deps: GenerateDeps, chatId: number, motivo: string): Promise<void> {
  await deps.sender.sendMessage(chatId, `${motivo} ${ALTERNATIVA}`);
}
