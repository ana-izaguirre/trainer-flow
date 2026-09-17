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
 *   4. ¿`/start <token>`?    → es el update que CREA identidad
 *   5. Resolver la identidad → nadie se auto-registra
 *   6. Atender
 *   7. Si se aprobó, entregar → SPEC-005 regla 14
 *
 * ┌─ POR QUÉ EL PASO 4 VA ANTES DEL 5 ─────────────────────────────────────┐
 * │ `/start <token>` es el único update que crea identidad, así que no     │
 * │ puede exigirla. Un cliente que abre su deep link por primera vez       │
 * │ todavía no tiene perfil: resolviendo identidad primero recibiría «no   │
 * │ te tengo registrado» y el enlace no funcionaría NUNCA.                 │
 * │                                                                        │
 * │ No es auto-registro: el entrenador creó la ficha y emitió el token.    │
 * │ La autorización se concedió antes de que la persona escribiera         │
 * │ (SPEC-009 §3).                                                         │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { UserRole } from '../domain/identity.ts';
import type { TelegramRepo, TelegramSender } from '../ports/telegram-ports.ts';
import { parseCheckinCallback } from '../checkin/answers.ts';
import {
  handleCheckinAnswer,
  handleCheckinText,
  type ReplyDeps,
  type ReplyOutcome,
} from '../checkin/reply.ts';
import { handleAction, type ActionOutcome, type ActionDeps } from './actions.ts';
import { parseCallbackData } from './callback-data.ts';
import {
  deliverVersion,
  linkClient,
  type DeliverOutcome,
  type DeliveryDeps,
  type LinkOutcome,
} from './delivery.ts';
import { parseStartToken } from './start.ts';
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
  /**
   * Un canje de `link_token`. **`outcome` no lleva el token**: este resultado
   * se loguea entero.
   */
  | { readonly kind: 'linked'; readonly updateId: number; readonly outcome: LinkOutcome }
  | {
      readonly kind: 'handled';
      readonly updateId: number;
      readonly profileId: string;
      readonly role: UserRole;
      readonly updateKind: 'command' | 'text' | 'callback';
      /** Qué pasó con el botón, cuando el update era uno. */
      readonly action?: ActionOutcome;
      /** Qué pasó con la entrega, cuando el botón fue Aprobar. */
      readonly delivery?: DeliverOutcome;
      /** Qué pasó con el check-in, cuando el update era una respuesta. */
      readonly checkin?: ReplyOutcome;
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
  /**
   * Las tres capacidades son **obligatorias**. Un webhook que se pueda
   * construir sin una de ellas es un bot en el que esa parte no funciona, y
   * eso no puede quedar en un descuido de cableado: ya pasó una vez con el
   * deep link y con los botones, y no falló nada hasta usarlo de verdad.
   */
  readonly actions: ActionDeps;
  readonly delivery: DeliveryDeps;
  readonly checkins: ReplyDeps;
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

    // ── 4. El canje del deep link ────────────────────────────────────────
    // Va antes de resolver identidad porque es lo que la crea. El token es
    // una credencial: no se loguea, ni siquiera al rechazarlo.
    if (update.kind === 'command') {
      const token = parseStartToken(update.command, update.args);

      if (token !== null) {
        const outcome = await linkClient(
          token,
          { telegramUserId: update.telegramUserId, chatId: update.chatId },
          deps.delivery,
        );
        await deps.repo.markProcessed(externalId);
        return { kind: 'linked', updateId: update.updateId, outcome };
      }
    }

    // ── 5. Identidad ─────────────────────────────────────────────────────
    const identity = await deps.repo.findIdentity(update.telegramUserId);
    if (identity === null) {
      await deps.sender.sendMessage(update.chatId, NEUTRAL_REPLY);
      await deps.repo.markProcessed(externalId);
      return { kind: 'unknown_user', telegramUserId: update.telegramUserId };
    }

    // ── 6. Atender ───────────────────────────────────────────────────────
    // El `callback_data` es dato NO confiable: cualquiera puede fabricar uno.
    // Lo que impide tocar la versión de otro no es este parseo, sino la
    // comprobación de pertenencia que hace `handleAction`.
    let action: ActionOutcome | undefined;
    let checkin: ReplyOutcome | undefined;

    if (update.kind === 'callback') {
      // Los dos prefijos viajan por el mismo canal, así que se prueban en
      // orden. `chk:` no puede confundirse con `act:`: son literales.
      const respuesta = parseCheckinCallback(update.data);
      const payload = respuesta === null ? parseCallbackData(update.data) : null;

      if (respuesta !== null) {
        checkin = await handleCheckinAnswer(
          respuesta.checkinId,
          { field: respuesta.field, value: respuesta.value },
          identity,
          deps.checkins,
        );
      } else if (payload !== null) {
        action = await handleAction(
          {
            action: payload.action,
            versionId: payload.versionId,
            callbackQueryId: update.callbackQueryId,
          },
          identity,
          deps.actions,
        );
      } else {
        // Un `callback_data` que no se puede leer no llegó de un botón
        // nuestro. Se responde para que no quede girando y se ignora.
        await deps.sender.answerCallback(update.callbackQueryId);
      }
    }

    // Un mensaje suelto de un cliente puede ser la molestia que el check-in
    // está esperando. Solo se lee así si hay uno abierto: si no, es alguien
    // escribiéndole al bot, y eso no se reinterpreta.
    if (update.kind === 'text' && identity.role === 'client') {
      checkin = await handleCheckinText(update.text, identity, deps.checkins);
    }

    // Aprobar deja la versión lista; entregarla es SPEC-005 (regla 14). Sin
    // este enlace, el entrenador pulsa Aprobar y al cliente no le llega nada.
    const delivery =
      action?.kind === 'approved'
        ? await deliverVersion(action.versionId, deps.delivery)
        : undefined;

    await deps.repo.markProcessed(externalId);

    return {
      kind: 'handled',
      updateId: update.updateId,
      profileId: identity.profileId,
      role: identity.role,
      updateKind: update.kind,
      ...(action === undefined ? {} : { action }),
      ...(delivery === undefined ? {} : { delivery }),
      ...(checkin === undefined ? {} : { checkin }),
    };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    };
  }
}
