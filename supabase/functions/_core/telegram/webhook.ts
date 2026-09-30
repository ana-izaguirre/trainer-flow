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
import { parseChangeCallback, REASON_LABELS } from '../domain/change-request.ts';
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
import { handleQuickCreate, type QuickCreateOutcome } from '../creation/quick-create.ts';
import {
  handleCommand,
  showClient,
  type CommandDeps,
  type CommandOutcome,
} from '../commands/router.ts';
import { SIN_PREGUNTA_PENDIENTE, SIN_RUTINA_TODAVIA } from '../commands/format.ts';
import {
  handleCheckinAnswer,
  handleCheckinText,
  type ReplyDeps,
  type ReplyOutcome,
} from '../checkin/reply.ts';
import { handleAction, type ActionOutcome, type ActionDeps } from './actions.ts';
import { handleNavigation, type NavOutcome } from './navigation.ts';
import { showIntake, type IntakeOutcome, type IntakeDeps } from '../assessment/intake.ts';
import {
  requestClientUpdate,
  requestOwnUpdate,
  type UpdateRequestDeps,
  type UpdateRequestOutcome,
} from '../assessment/update-request.ts';
import { resendLink, type ResendLinkOutcome, type ResendLinkDeps } from './resend-link.ts';
import { parseCallbackData, parseNavCallback } from './callback-data.ts';
import { parseClientCallback } from './client-callback.ts';
import {
  deliverVersion,
  linkClient,
  type DeliverOutcome,
  type DeliveryDeps,
  type LinkOutcome,
} from './delivery.ts';
import { escapeMarkdownV2 } from './format.ts';
import { parseStartToken } from './start.ts';
import { parseTemplateCallback } from './template-callback.ts';
import { parseUpdate } from './update.ts';
import { constantTimeEquals } from '../security/constant-time.ts';

/** Lo mismo para un desconocido que para un token inválido: no se filtra nada. */
export const NEUTRAL_REPLY = 'No te tengo registrado\\. Habla con tu entrenador\\.';

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
      readonly intake?: IntakeOutcome;
      /** Qué pasó al pedir reenviar el enlace de vinculación (SPEC-014 §3). */
      readonly link?: ResendLinkOutcome;
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
      /** SPEC-031: qué pasó con `/crear_rutina <cliente>` de un mensaje. */
      readonly quickCreate?: QuickCreateOutcome;
      /** Qué pasó con una solicitud de cambio. */
      readonly change?: ChangeOutcome;
      /** SPEC-031: qué vista de la rutina se mostró al navegar. */
      readonly navigation?: NavOutcome;
      /** SPEC-027: qué pasó al pedir la actualización de datos. Sin el token. */
      readonly update?: UpdateRequestOutcome;
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
  readonly intake: IntakeDeps;
  /** SPEC-014 §3: reenviar el enlace de vinculación desde la ficha. */
  readonly link: ResendLinkDeps;
  readonly delivery: DeliveryDeps;
  readonly checkins: ReplyDeps;
  readonly commands: CommandDeps;
  /** Plantillas, creación manual y el editor: el camino que no usa la IA. */
  readonly creation: CreationDeps & EditorDeps;
  /** Lo que el cliente puede pedir sobre su rutina (SPEC-010). */
  readonly changes: ChangeRequestDeps;
  /** SPEC-027: `/actualizar_datos` del cliente y 📝 de la ficha. */
  readonly updates: UpdateRequestDeps;
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

  // SPEC-030 regla 9 — la ÚNICA excepción a «se responde antes del trabajo»:
  // su acuse lleva el texto de lo que se guardó, que solo se sabe después de
  // procesarlo (más abajo, en el paso 6). Para cualquier otro botón, el
  // orden de siempre no cambia ni un paso.
  const esRespuestaDeCheckin =
    update.kind === 'callback' && parseCheckinCallback(update.data) !== null;

  try {
    // Telegram deja el botón girando si se tarda, así que se responde antes
    // del trabajo (SPEC-004 regla 2).
    if (update.kind === 'callback' && !esRespuestaDeCheckin) {
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
      // El acuse del check-in quedó diferido arriba: sin esto, un botón de
      // alguien sin identidad se queda girando — nunca llega al paso 6, que
      // es donde normalmente se respondería con el texto del acuse.
      if (esRespuestaDeCheckin) await deps.sender.answerCallback(update.callbackQueryId);
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
    let quickCreate: QuickCreateOutcome | undefined;
    let change: ChangeOutcome | undefined;
    let navigation: NavOutcome | undefined;
    let intake: IntakeOutcome | undefined;
    let link: ResendLinkOutcome | undefined;
    let updateRequest: UpdateRequestOutcome | undefined;

    // Un comando ya con identidad resuelta. `/start <token>` no llega aquí:
    // se atendió en el paso 4, antes de que hubiera identidad.
    if (update.kind === 'command') {
      // SPEC-031: solo `/crear_rutina` puede nombrar a alguien EN el mismo
      // mensaje. Va antes del resto del editor: si el patrón no encaja
      // (`not_applicable`), sigue exactamente el camino de siempre.
      quickCreate = await intentarCrearRutinaRapida(update.command, update.args, identity, deps);

      // Los del editor van primero: son del entrenador y actúan sobre el
      // borrador en curso, no sobre la cartera.
      editor =
        quickCreate === undefined && isEditorCommand(update.command)
          ? await editarSiEsEntrenador(update.command, update.args, identity, deps)
          : undefined;

      // SPEC-027: `/actualizar_datos` es del CLIENTE y escribe (emite un token), así
      // que no va por el router de consultas, que es de solo lectura.
      if (update.command === 'actualizar_datos' && identity.role === 'client') {
        updateRequest = await requestOwnUpdate(identity, deps.updates);
      } else if (update.command === 'cambio_rutina' && identity.role === 'client') {
        // SPEC-030 regla 6: el mismo camino que el botón «Pedir un cambio»,
        // sobre la versión vigente del cliente. También escribe (puede tocar
        // `asked_at`), así que tampoco va por el router de solo lectura.
        change = await pedirCambioPorComando(identity, deps);
      } else if (editor === undefined && quickCreate === undefined) {
        // SPEC-030 regla 7: si tiene un cambio pedido, se lo recuerda ANTES
        // de mandarle la rutina — que sigue siendo la vigente, sin ocultarse.
        if (update.command === 'rutina' && identity.role === 'client') {
          await avisarSiHayCambioPendiente(identity, deps);
        }
        command = await handleCommand(update.command, update.args, identity, deps.commands);
      }
    }

    if (update.kind === 'callback') {
      // Los prefijos viajan por el mismo canal, así que se prueban en orden.
      // `chk:`, `tpl:`, `chg:`, `cli:`, `nav:` y `act:` no pueden confundirse:
      // son literales distintos.
      const respuesta = parseCheckinCallback(update.data);
      const plantilla = respuesta === null ? parseTemplateCallback(update.data) : null;
      const motivo =
        respuesta === null && plantilla === null ? parseChangeCallback(update.data) : null;
      const ficha =
        respuesta === null && plantilla === null && motivo === null
          ? parseClientCallback(update.data)
          : null;
      const navegacion =
        respuesta === null && plantilla === null && motivo === null && ficha === null
          ? parseNavCallback(update.data)
          : null;
      const payload =
        respuesta === null &&
        plantilla === null &&
        motivo === null &&
        ficha === null &&
        navegacion === null
          ? parseCallbackData(update.data)
          : null;

      if (ficha !== null) {
        // SPEC-022 M4: uno de los botones de «Hay varios que encajan». Es
        // una lectura, como `/cliente`, y `showClient` comprueba que el id
        // esté en SU cartera: el `callback_data` se puede fabricar.
        command = await showClient(ficha.clientId, identity, deps.commands);
      } else if (navegacion !== null) {
        // SPEC-031. De solo lectura, igual que `intake`: nunca transiciona
        // la versión, solo decide qué vista mandar de vuelta.
        navigation = await handleNavigation(
          {
            view: navegacion.view,
            versionId: navegacion.versionId,
            callbackQueryId: update.callbackQueryId,
          },
          identity,
          // El mismo `sender` de `deps.actions`, no `deps.sender`: son el
          // mismo objeto en producción, pero declarar la dependencia desde
          // `ActionDeps` es el patrón que ya sigue `handleAction`.
          { repo: deps.actions.repo, sender: deps.actions.sender },
        );
      } else if (motivo !== null) {
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
        const resultado = await handleCheckinAnswer(
          respuesta.checkinId,
          { field: respuesta.field, value: respuesta.value },
          identity,
          deps.checkins,
        );
        checkin = resultado;
        // Regla 9: aquí, y no arriba, porque recién ahora se sabe qué decir.
        // Un botón SIEMPRE tiene `ack` (string, no opcional): `ButtonReplyOutcome`.
        await deps.sender.answerCallback(
          update.callbackQueryId,
          resultado.kind === 'saved' ? resultado.ack : undefined,
        );
      } else if (
        payload !== null &&
        (payload.action === 'accept' || payload.action === 'change' || payload.action === 'revise')
      ) {
        // Los botones de SPEC-010. `accept` y `change` los pulsa el CLIENTE;
        // `revise`, el entrenador. Cada flujo comprueba su pertenencia.
        change = await enrutarSolicitud(payload.action, payload.versionId, identity, deps);
      } else if (payload !== null && payload.action === 'intake') {
        // SPEC-015. Va aparte de `handleAction` porque no es una transición:
        // es la única lectura del sistema, y no escribe nada.
        intake = await showIntake(payload.versionId, identity, deps.intake);
      } else if (payload !== null && payload.action === 'reassess') {
        // SPEC-027 regla 3. Emite un token: comprueba la pertenencia antes.
        updateRequest = await requestClientUpdate(payload.versionId, identity, deps.updates);
      } else if (payload !== null && payload.action === 'link') {
        // SPEC-014 §3. Tampoco transiciona nada: reenvía un dato que ya
        // existía, igual que 'intake'.
        link = await resendLink(payload.versionId, identity, deps.link);
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
      //
      // SPEC-030 regla 4: YA NO exige que la solicitud esté sin comentario —
      // un segundo mensaje se AÑADE, no se pierde.
      const solicitud = await deps.changes.repo.openForClient(identity.profileId);

      checkin = await handleCheckinText(
        update.text,
        identity,
        deps.checkins,
        solicitud?.askedAt ?? null,
      );

      // El check-in no lo quiso: entonces es para la solicitud, si la hay.
      if (checkin.kind === 'no_open_checkin') {
        if (solicitud !== null) {
          change = await addComment(
            solicitud.requestId,
            solicitud.clientId,
            update.text,
            identity,
            deps.changes,
          );
        } else {
          // SPEC-030 regla 8: ningún mensaje del cliente se queda sin
          // respuesta, ni siquiera uno que no era para nadie en particular.
          await deps.sender.sendMessage(identity.telegramChatId, SIN_PREGUNTA_PENDIENTE);
        }
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
      ...(intake === undefined ? {} : { intake }),
      ...(link === undefined ? {} : { link }),
      ...(delivery === undefined ? {} : { delivery }),
      ...(checkin === undefined ? {} : { checkin }),
      ...(command === undefined ? {} : { command }),
      ...(creation === undefined ? {} : { creation }),
      ...(editor === undefined ? {} : { editor }),
      ...(quickCreate === undefined ? {} : { quickCreate }),
      ...(change === undefined ? {} : { change }),
      ...(navigation === undefined ? {} : { navigation }),
      ...(updateRequest === undefined ? {} : { update: updateRequest }),
    };
  } catch (error) {
    return {
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Error desconocido.',
    };
  }
}


/**
 * SPEC-031 — `/crear_rutina <cliente>`, antes de que el editor lo trate
 * como una edición sobre `currentDraft`.
 *
 * `undefined` es «esto no era mío»: ni el comando correcto, ni el
 * entrenador, ni un patrón de nombre reconocible. En ese caso el update
 * sigue exactamente el camino de siempre.
 */
async function intentarCrearRutinaRapida(
  command: string,
  args: string,
  identity: { profileId: string; role: UserRole; telegramChatId: number },
  deps: WebhookDeps,
): Promise<QuickCreateOutcome | undefined> {
  if (command !== 'crear_rutina' || identity.role !== 'trainer') return undefined;

  const intento = await handleQuickCreate(args, identity.profileId, identity.telegramChatId, {
    clients: deps.commands.repo,
    creation: deps.creation.repo,
    changes: deps.changes.repo,
    sender: deps.sender,
  });

  return intento.kind === 'not_applicable' ? undefined : intento;
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


/**
 * SPEC-030 regla 7 — antes de mandarle `/rutina`, se le recuerda si tiene un
 * cambio pedido. La rutina vigente se manda igual: el cliente sigue
 * entrenando con ella mientras el entrenador prepara la siguiente.
 */
async function avisarSiHayCambioPendiente(identity: Identity, deps: WebhookDeps): Promise<void> {
  const abierta = await deps.changes.repo.openForClient(identity.profileId);
  if (abierta === null) return;

  const dias = Math.max(
    0,
    Math.floor((deps.changes.now().getTime() - abierta.createdAt.getTime()) / 86_400_000),
  );
  const cuando = dias === 0 ? 'hoy' : `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;

  await deps.sender.sendMessage(
    identity.telegramChatId,
    `🛠 Pediste un cambio ${cuando} \\(${escapeMarkdownV2(REASON_LABELS[abierta.reason])}\\)\\. ` +
      'Tu entrenador lo está preparando; mientras, esta sigue siendo tu rutina\\.',
  );
}

/**
 * SPEC-030 regla 6 — `/cambio_rutina`, escrito en vez de pulsado.
 *
 * Sin rutina enviada, no hay sobre qué pedir nada (mismo mensaje de
 * `/rutina`, SPEC-023). Con una, es exactamente `askReason`: si ya tiene una
 * solicitud abierta, enseña su estado (regla 1); si no, el menú de motivos.
 */
async function pedirCambioPorComando(identity: Identity, deps: WebhookDeps): Promise<ChangeOutcome> {
  const rutina = await deps.commands.repo.clientRoutine(identity.profileId);

  if (rutina === null) {
    await deps.sender.sendMessage(identity.telegramChatId, SIN_RUTINA_TODAVIA);
    return { kind: 'denied' };
  }

  return askReason(rutina.versionId, identity, deps.changes);
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
