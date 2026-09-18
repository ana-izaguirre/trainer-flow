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
import type { Identity, UserRole } from '../domain/identity.ts';
import type { TelegramRepo, TelegramSender } from '../ports/telegram-ports.ts';
import { parseCheckinCallback } from '../checkin/answers.ts';
import {
  acceptVersion,
  addComment,
  askReason,
  requestChange,
  startRevision,
  type ChangeOutcome,
  type ChangeRequestDeps,
} from '../change-request/flows.ts';
import { parseChangeCallback } from '../domain/change-request.ts';
import {
  listTemplates,
  loadTemplate,
  startManual,
  type CreationDeps,
  type CreationOutcome,
} from '../creation/flows.ts';
import {
  handleEditorCommand,
  isEditorCommand,
  type EditorDeps,
  type EditorOutcome,
} from '../creation/editor-session.ts';
import {
  handleCommand,
  type CommandDeps,
  type CommandOutcome,
} from '../commands/router.ts';
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
import { parseTemplateCallback } from './template-callback.ts';
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
      /** Qué pasó con el comando, cuando el update era uno. */
      readonly command?: CommandOutcome;
      /** Qué pasó al elegir plantilla o empezar a mano. */
      readonly creation?: CreationOutcome;
      /** Qué pasó con un comando del editor. */
      readonly editor?: EditorOutcome;
      /** Qué pasó con una solicitud de cambio. */
      readonly change?: ChangeOutcome;
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
  readonly commands: CommandDeps;
  /** Plantillas, creación manual y el editor: el camino que no usa la IA. */
  readonly creation: CreationDeps & EditorDeps;
  /** Lo que el cliente puede pedir sobre su rutina (SPEC-010). */
  readonly changes: ChangeRequestDeps;
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
    // comprobación de pertenencia que hace CADA flujo al que se enruta.
    // Los tres de creación no la hacían, y por eso un cliente podía escribir
    // en la rutina de otro (SPEC-013 §2).
    let action: ActionOutcome | undefined;
    let checkin: ReplyOutcome | undefined;
    let command: CommandOutcome | undefined;
    let creation: CreationOutcome | undefined;
    let editor: EditorOutcome | undefined;
    let change: ChangeOutcome | undefined;

    // Un comando ya con identidad resuelta. `/start <token>` no llega aquí:
    // se atendió en el paso 4, antes de que hubiera identidad.
    if (update.kind === 'command') {
      // Los del editor van primero: son del entrenador y actúan sobre el
      // borrador en curso, no sobre la cartera.
      editor = isEditorCommand(update.command)
        ? await editarSiEsEntrenador(update.command, update.args, identity, deps)
        : undefined;

      if (editor === undefined) {
        command = await handleCommand(update.command, update.args, identity, deps.commands);
      }
    }

    if (update.kind === 'callback') {
      // Los dos prefijos viajan por el mismo canal, así que se prueban en
      // orden. `chk:` no puede confundirse con `act:`: son literales.
      const respuesta = parseCheckinCallback(update.data);
      const plantilla = respuesta === null ? parseTemplateCallback(update.data) : null;
      const motivo =
        respuesta === null && plantilla === null ? parseChangeCallback(update.data) : null;
      const payload =
        respuesta === null && plantilla === null && motivo === null
          ? parseCallbackData(update.data)
          : null;

      if (motivo !== null) {
        // El cliente eligió por qué quiere el cambio.
        change = await requestChange(motivo.reason, motivo.versionId, identity, deps.changes);
      } else if (plantilla !== null) {
        // La segunda pulsación de 📋: ya se sabe CUÁL cargar.
        creation = await loadTemplate(
          plantilla.templateId,
          plantilla.versionId,
          identity,
          deps.creation,
        );
      } else if (respuesta !== null) {
        checkin = await handleCheckinAnswer(
          respuesta.checkinId,
          { field: respuesta.field, value: respuesta.value },
          identity,
          deps.checkins,
        );
      } else if (
        payload !== null &&
        (payload.action === 'accept' || payload.action === 'change' || payload.action === 'revise')
      ) {
        // Los botones de SPEC-010. `accept` y `change` los pulsa el CLIENTE;
        // `revise`, el entrenador. Cada flujo comprueba su pertenencia.
        change = await enrutarSolicitud(payload.action, payload.versionId, identity, deps);
      } else if (payload !== null && (payload.action === 'template' || payload.action === 'manual')) {
        // Los dos caminos sin IA. Van aparte de `handleAction` porque no son
        // una transición sobre la versión: una lista plantillas y la otra
        // escribe contenido.
        // `identity` entera, no solo su `chatId`: estos tres flujos comprueban
        // pertenencia desde SPEC-013. Pasar el chat suelto era justo lo que
        // permitía que un cliente tocara la versión de otro.
        creation =
          payload.action === 'template'
            ? await listTemplates(payload.versionId, identity, deps.creation)
            : await startManual(payload.versionId, identity, deps.creation);
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
      // Dos cosas pueden estar esperando texto: el comentario de una solicitud
      // y la molestia de un check-in. Gana la más reciente, que es a la que
      // cualquiera contestaría (SPEC-010 §3).
      const solicitud = await deps.changes.repo.openForClient(identity.profileId);
      const esperandoComentario =
        solicitud !== null && !solicitud.hasComment ? solicitud : null;

      checkin = await handleCheckinText(
        update.text,
        identity,
        deps.checkins,
        esperandoComentario?.askedAt ?? null,
      );

      // El check-in no lo quiso: entonces es para la solicitud.
      if (checkin.kind === 'no_open_checkin' && esperandoComentario !== null) {
        change = await addComment(
          esperandoComentario.requestId,
          esperandoComentario.clientId,
          update.text,
          identity,
          deps.changes,
        );
      }
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
      ...(command === undefined ? {} : { command }),
      ...(creation === undefined ? {} : { creation }),
      ...(editor === undefined ? {} : { editor }),
      ...(change === undefined ? {} : { change }),
    };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    };
  }
}


/**
 * Un comando del editor solo lo atiende el entrenador.
 *
 * Devuelve `undefined` si no es suyo, para que el update siga su camino y
 * acabe en la respuesta genérica de SPEC-007 en vez de en un silencio.
 */
function editarSiEsEntrenador(
  command: string,
  args: string,
  identity: { profileId: string; role: UserRole; telegramChatId: number },
  deps: WebhookDeps,
): Promise<EditorOutcome | undefined> {
  if (identity.role !== 'trainer') return Promise.resolve(undefined);

  return handleEditorCommand(
    command,
    args,
    identity.profileId,
    identity.telegramChatId,
    deps.creation,
  );
}


/** Los tres botones de SPEC-010, cada uno a su flujo. */
function enrutarSolicitud(
  action: 'accept' | 'change' | 'revise',
  versionId: string,
  identity: Identity,
  deps: WebhookDeps,
): Promise<ChangeOutcome> {
  if (action === 'accept') return acceptVersion(versionId, identity, deps.changes);
  if (action === 'change') return askReason(versionId, identity, deps.changes);

  return startRevision(versionId, identity, deps.changes);
}
