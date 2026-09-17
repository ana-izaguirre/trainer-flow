/**
 * El flujo del webhook de Telegram, sin HTTP.
 *
 * ┌─ POR QUÉ NO DEVUELVE UNA `Response` ───────────────────────────────────┐
 * │ El punto §11 dice que `_core` no depende de HTTP. Así que este módulo  │
 * │ decide QUÉ PASÓ, y la Edge Function traduce eso a un código de estado. │
 * │ A cambio, todo el flujo se puede probar sin levantar un servidor.      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * El ORDEN de los pasos es lo que este módulo garantiza:
 *
 *   1. Verificar el secreto  → antes de tocar absolutamente nada
 *   2. Parsear el update     → dato no confiable
 *   3. Reclamar el evento    → idempotencia
 *   4. Resolver la identidad → nadie se auto-registra
 *   5. Atender
 */
import type { UserRole } from '../domain/identity.ts';
import type { TelegramRepo, TelegramSender } from '../ports/telegram-ports.ts';
import { handleAction, type ActionOutcome, type ActionDeps } from './actions.ts';
import { parseCallbackData } from './callback-data.ts';
import { parseUpdate } from './update.ts';
import { constantTimeEquals } from '../security/constant-time.ts';

/** Lo mismo para un desconocido que para un token inválido: no se filtra nada. */
export const NEUTRAL_REPLY = 'No te tengo registrado. Habla con tu entrenador.';

export type WebhookOutcome =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'duplicate'; readonly updateId: number }
  | { readonly kind: 'unknown_user'; readonly telegramUserId: number }
  | {
      readonly kind: 'handled';
      readonly updateId: number;
      readonly profileId: string;
      readonly role: UserRole;
      readonly updateKind: 'command' | 'text' | 'callback';
      /** Qué pasó con el botón, cuando el update era uno. */
      readonly action?: ActionOutcome;
    }
  | { readonly kind: 'failed'; readonly message: string };

export interface WebhookInput {
  readonly secretHeader: string | null;
  /** El cuerpo ya parseado como JSON, o `null` si el parseo falló. */
  readonly body: unknown;
}

export interface WebhookDeps {
  readonly repo: TelegramRepo;
  readonly sender: TelegramSender;
  readonly expectedSecret: string;
  readonly requestId: string;
  /** Qué hacer con un botón. Ausente mientras no haya nada que enrutar. */
  readonly actions?: ActionDeps;
}

/**
 * Traduce el resultado a un código HTTP.
 *
 * Solo el secreto inválido devuelve 401. Todo lo demás devuelve 200 **a
 * propósito**: un 500 haría que Telegram reintentara el mismo update en bucle,
 * y el problema real ya quedó en los logs.
 */
export function outcomeToStatus(outcome: WebhookOutcome): number {
  return outcome.kind === 'unauthorized' ? 401 : 200;
}

export async function handleTelegramWebhook(
  input: WebhookInput,
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  // ── 1. El secreto, antes de tocar nada ─────────────────────────────────
  if (!constantTimeEquals(input.secretHeader, deps.expectedSecret)) {
    return { kind: 'unauthorized' };
  }

  if (input.body === null || input.body === undefined) {
    return { kind: 'malformed' };
  }

  // ── 2. El update es dato no confiable ──────────────────────────────────
  const update = parseUpdate(input.body);
  if (update.kind === 'ignored') {
    return { kind: 'ignored', reason: update.reason };
  }

  const externalId = String(update.updateId);

  try {
    // Telegram deja el botón girando si se tarda, así que se responde antes
    // del trabajo (SPEC-004 regla 2).
    if (update.kind === 'callback') {
      await deps.sender.answerCallback(update.callbackQueryId);
    }

    // ── 3. Idempotencia ──────────────────────────────────────────────────
    const isNew = await deps.repo.claimEvent(externalId, input.body, deps.requestId);
    if (!isNew) {
      return { kind: 'duplicate', updateId: update.updateId };
    }

    // ── 4. Identidad ─────────────────────────────────────────────────────
    const identity = await deps.repo.findIdentity(update.telegramUserId);
    if (identity === null) {
      await deps.sender.sendMessage(update.chatId, NEUTRAL_REPLY);
      await deps.repo.markProcessed(externalId);
      return { kind: 'unknown_user', telegramUserId: update.telegramUserId };
    }

    // ── 5. Atender ───────────────────────────────────────────────────────
    // El `callback_data` es dato NO confiable: cualquiera puede fabricar uno.
    // Lo que impide tocar la versión de otro no es este parseo, sino la
    // comprobación de pertenencia que hace `handleAction`.
    let action: ActionOutcome | undefined;

    if (update.kind === 'callback' && deps.actions !== undefined) {
      const payload = parseCallbackData(update.data);

      if (payload === null) {
        // Un `callback_data` que no se puede leer no llegó de un botón
        // nuestro. Se responde para que no quede girando y se ignora.
        await deps.sender.answerCallback(update.callbackQueryId);
      } else {
        action = await handleAction(
          {
            action: payload.action,
            versionId: payload.versionId,
            callbackQueryId: update.callbackQueryId,
          },
          identity,
          deps.actions,
        );
      }
    }

    await deps.repo.markProcessed(externalId);

    return {
      kind: 'handled',
      updateId: update.updateId,
      profileId: identity.profileId,
      role: identity.role,
      updateKind: update.kind,
      ...(action === undefined ? {} : { action }),
    };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    };
  }
}
