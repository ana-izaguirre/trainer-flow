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
import type { AIFailureReason, AIProvider } from '../ports/ai-provider.ts';
import type { GenerationRepo } from '../ports/generation-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { buildDraftReady, buildGenerationFailed } from '../telegram/notify.ts';
import { sendLongMessage } from '../telegram/format.ts';
import type { InlineKeyboard } from '../telegram/keyboard.ts';
import { callWithRetry } from './provider-call.ts';
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
    // La versión no se toca: sigue en NEW y el entrenador puede seguir. El
    // aviso lleva los botones de plantilla y manual: decir «no hay cuota» sin
    // ofrecer por dónde seguir lo deja mirando un mensaje.
    await enviar(deps, version.trainerChatId, buildGenerationFailed('RATE_LIMITED', versionId));
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
    operation: 'generate',
  });

  const started = deps.now().getTime();
  const result = await callWithRetry(deps.provider, version.request, deps.newTimeoutSignal);
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

      // El borrador con sus tres botones. Hasta aquí el sistema hacía todo
      // bien y no se lo decía a nadie.
      await enviar(
        deps,
        version.trainerChatId,
        buildDraftReady(
          validado.workout,
          { clientName: version.clientName, versionNumber: version.versionNumber },
          versionId,
        ),
      );

      return { kind: 'generated', versionId };
    }
  }

  // ── 6. Cualquier fallo devuelve la versión a NEW ───────────────────────
  const reason: AIFailureReason = result.ok ? 'INVALID_OUTPUT' : result.reason;

  // ┌─ EL DETALLE SE GUARDABA SOLO EN EL LOG ────────────────────────────────┐
  // │ `API_ERROR` es el cajón de todo lo que no es cuota ni timeout: un 404  │
  // │ de modelo retirado y un 403 de clave sin permisos entraban iguales.    │
  // │                                                                        │
  // │ El proveedor YA calcula «El proveedor respondió 404.» y se tiraba aquí,│
  // │ así que la consulta obvia —`select failure_reason from ai_generations`—│
  // │ devolvía `API_ERROR` y había que bucear en los logs para lo único que  │
  // │ distingue un fallo de otro.                                            │
  // │                                                                        │
  // │ El RUNBOOK dice «la base es el índice». Un índice que no distingue no  │
  // │ es un índice.                                                          │
  // └────────────────────────────────────────────────────────────────────────┘
  const detalle = result.ok ? 'La respuesta no tenía la forma esperada.' : result.detail;

  await deps.repo.finishGeneration(generationId, {
    status: 'FAILED',
    // Acotado como todo texto que llega de fuera: el detalle lo compone el
    // adaptador, pero puede acabar citando al proveedor.
    failureReason: `${reason}: ${detalle}`.slice(0, 300),
    latencyMs,
  });
  await aplicar(deps, versionId, generating, 'GENERATION_FAILED');
  await enviar(deps, version.trainerChatId, buildGenerationFailed(reason, versionId));

  return { kind: 'generation_failed', reason };
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

async function enviar(
  deps: GenerateDeps,
  chatId: number,
  aviso: { readonly text: string; readonly keyboard: InlineKeyboard | null },
): Promise<void> {
  // SPEC-029 §6: el aviso de «borrador listo» lleva la rutina entera, que
  // puede no caber en un mensaje. Un aviso corto pasa intacto por aquí.
  await sendLongMessage(deps.sender, chatId, aviso.text, aviso.keyboard);
}
