/**
 * SPEC-004 — La edición conversacional sobre un borrador en `DRAFT`.
 *
 * ┌─ LA DIFERENCIA CON `generate-version.ts` ──────────────────────────────┐
 * │ Generar arranca desde NEW y, si falla, no pierde nada porque no había  │
 * │ nada. Editar arranca desde DRAFT, que YA tiene contenido: un fallo no  │
 * │ puede «volver a NEW» sin tirar ese trabajo. Por eso ningún camino de   │
 * │ error de este módulo llama a `saveEditedContent`: si no se llama, el   │
 * │ contenido en la base es, bit a bit, el que ya estaba.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * El orden:
 *
 *   1. ¿Hay algo esperando instrucción de este entrenador?  → si no, nada
 *   2. La instrucción es válida (no vacía, no > 500)        → si no, se
 *      vuelve a preguntar y la espera SIGUE abierta
 *   3. La cuota, igual que generar                          → sin margen,
 *      se cancela la espera: reescribir no lo arregla
 *   4. Registrar, llamar, validar, guardar — igual que generar, con
 *      `operation = 'edit'`
 */
import { validateDraft } from '../domain/validate-draft.ts';
import type { AIFailureReason, AIProvider } from '../ports/ai-provider.ts';
import type { EditRepo, VersionForEdit } from '../ports/edit-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { escapeMarkdownV2, sendLongMessage } from '../telegram/format.ts';
import type { InlineKeyboard } from '../telegram/keyboard.ts';
import { buildDraftReady, buildEditFailed } from '../telegram/notify.ts';
import { callWithRetry } from './provider-call.ts';
import { checkRateLimit, type RateLimitConfig } from './rate-limit.ts';

export type EditOutcome =
  /** Ninguna versión de este entrenador estaba esperando instrucción. */
  | { readonly kind: 'nothing_pending' }
  | { readonly kind: 'empty_instruction' }
  | { readonly kind: 'instruction_too_long' }
  | { readonly kind: 'rate_limited'; readonly retryAfterMinutes: number }
  | { readonly kind: 'edited'; readonly versionId: string }
  | { readonly kind: 'edit_failed'; readonly versionId: string; readonly reason: AIFailureReason };

export interface EditDeps {
  readonly repo: EditRepo;
  readonly provider: AIProvider;
  readonly sender: TelegramSender;
  readonly rateLimit: RateLimitConfig;
  readonly newTimeoutSignal: () => AbortSignal;
  readonly now: () => Date;
}

/** SPEC-004 §7: la instrucción es entrada no confiable, acotada en longitud. */
const MAX_INSTRUCTION_LENGTH = 500;

export async function applyEditInstruction(
  trainerId: string,
  text: string,
  deps: EditDeps,
): Promise<EditOutcome> {
  const pendiente = await deps.repo.findAwaitingEdit(trainerId);
  if (pendiente === null) return { kind: 'nothing_pending' };

  const instruction = text.trim();

  if (instruction.length === 0) {
    await deps.sender.sendMessage(
      pendiente.trainerChatId,
      `¿Qué quieres cambiar en la rutina de ${escapeMarkdownV2(pendiente.clientName)}?`,
    );
    return { kind: 'empty_instruction' };
  }

  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    await deps.sender.sendMessage(
      pendiente.trainerChatId,
      'Eso es muy largo — cuéntamelo en menos de 500 caracteres\\.',
    );
    return { kind: 'instruction_too_long' };
  }

  // ── La cuota, igual que generar (regla 7: editar también gasta cuota) ───
  const cuota = checkRateLimit(
    await deps.repo.recentGenerations(deps.rateLimit.windowMinutes),
    deps.rateLimit,
    deps.now(),
  );

  if (!cuota.allowed) {
    // A diferencia de vacía/larga, reescribir no arregla esto: se cancela.
    // Mismo aviso que cualquier otro fallo de edición — con teclado: sin él,
    // el entrenador se queda sin botones para seguir sobre esta versión.
    await deps.repo.cancelEditWait(pendiente.versionId);
    await enviar(
      deps,
      pendiente.trainerChatId,
      buildEditFailed('RATE_LIMITED', pendiente.clientName, pendiente.versionId),
    );
    return { kind: 'rate_limited', retryAfterMinutes: cuota.retryAfterMinutes };
  }

  const generationId = await deps.repo.startGeneration({
    provider: deps.provider.name,
    model: deps.provider.model,
    versionId: pendiente.versionId,
    operation: 'edit',
  });

  const started = deps.now().getTime();
  const result = await callWithRetry(
    deps.provider,
    { ...pendiente.request, instruction },
    deps.newTimeoutSignal,
  );
  const latencyMs = deps.now().getTime() - started;

  if (result.ok) {
    const validado = validateDraft(result.draft, pendiente.constraints);

    if (validado.ok) {
      const guardado = await deps.repo.saveEditedContent(pendiente.versionId, validado.workout);

      if (guardado) {
        await deps.repo.finishGeneration(generationId, {
          status: 'SUCCEEDED',
          usage: result.usage,
          latencyMs,
        });
        await enviar(
          deps,
          pendiente.trainerChatId,
          buildDraftReady(
            validado.workout,
            { clientName: pendiente.clientName, versionNumber: pendiente.versionNumber },
            pendiente.versionId,
          ),
        );
        return { kind: 'edited', versionId: pendiente.versionId };
      }

      // La IA respondió bien, pero ya no había dónde guardarlo: el
      // entrenador aprobó o rechazó mientras tanto.
      return fallar(
        deps,
        generationId,
        pendiente,
        latencyMs,
        'INVALID_OUTPUT',
        'La rutina se generó, pero la versión ya no estaba en DRAFT.',
      );
    }

    return fallar(
      deps,
      generationId,
      pendiente,
      latencyMs,
      'INVALID_OUTPUT',
      'La respuesta no tenía la forma esperada.',
    );
  }

  return fallar(deps, generationId, pendiente, latencyMs, result.reason, result.detail);
}

/**
 * Cualquier fallo: se registra, se cancela la espera y se avisa. La versión
 * NUNCA se toca — es lo que garantiza que «se conserva tal cual estaba».
 */
async function fallar(
  deps: EditDeps,
  generationId: number,
  pendiente: VersionForEdit,
  latencyMs: number,
  reason: AIFailureReason,
  detail: string,
): Promise<EditOutcome> {
  await deps.repo.finishGeneration(generationId, {
    status: 'FAILED',
    failureReason: `${reason}: ${detail}`.slice(0, 300),
    latencyMs,
  });
  await deps.repo.cancelEditWait(pendiente.versionId);
  await enviar(
    deps,
    pendiente.trainerChatId,
    buildEditFailed(reason, pendiente.clientName, pendiente.versionId),
  );

  return { kind: 'edit_failed', versionId: pendiente.versionId, reason };
}

async function enviar(
  deps: EditDeps,
  chatId: number,
  aviso: { readonly text: string; readonly keyboard: InlineKeyboard | null },
): Promise<void> {
  await sendLongMessage(deps.sender, chatId, aviso.text, aviso.keyboard);
}
