/**
 * SPEC-005 — Vincular al cliente y entregarle su rutina.
 *
 * ┌─ LA ENTREGA ES DIFERIDA ───────────────────────────────────────────────┐
 * │ Si el entrenador aprueba antes de que el cliente abra su enlace, la    │
 * │ versión se queda en APPROVED y sale sola cuando se vincula. Nadie      │
 * │ tiene que acordarse de nada, y ninguna rutina se queda sin entregar    │
 * │ por un problema de orden.                                              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ `APPROVED → SENT` SOLO DESPUÉS DE MANDAR ─────────────────────────────┐
 * │ Al revés, un fallo de red dejaría una rutina marcada como enviada que  │
 * │ nadie recibió, y el sistema no tendría forma de saberlo: SENT es       │
 * │ terminal.                                                              │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { nextState } from '../domain/state-machine.ts';
import type { VersionState } from '../domain/version.ts';
import type {
  DeliveryRepo,
  TelegramUser,
  VersionForDelivery,
} from '../ports/delivery-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { formatForClient } from './client-format.ts';
import { buildKeyboard, CLIENT_ACTIONS } from './keyboard.ts';

export interface DeliveryDeps {
  readonly repo: DeliveryRepo;
  readonly sender: TelegramSender;
}

export type LinkOutcome =
  | { readonly kind: 'linked'; readonly clientId: string; readonly delivered: boolean }
  | { readonly kind: 'already_linked_elsewhere' }
  /** Ya tiene perfil, y no es de cliente: un entrenador no canjea tokens. */
  | { readonly kind: 'not_a_client' }
  /** El canje llegó desde un grupo. Ahí no se entrega nada. */
  | { readonly kind: 'not_private' }
  /** El token valía, pero el enlace no se pudo guardar. */
  | { readonly kind: 'link_failed' }
  | { readonly kind: 'invalid_token' };

export type DeliverOutcome =
  | { readonly kind: 'delivered'; readonly versionId: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_deliverable'; readonly state: VersionState }
  | { readonly kind: 'already_sent' }
  /** Se mandó y falló. La versión sigue en APPROVED, esperando. */
  | { readonly kind: 'undelivered' };

/**
 * Un token inexistente y uno ya usado dan la misma respuesta AL CLIENTE.
 *
 * Si se distinguieran, un enlace filtrado diría si es válido.
 */
const RESPUESTA_NEUTRA =
  'Ese enlace no sirve\\. Pídele uno nuevo a tu entrenador\\.';

/**
 * Canjear el `link_token`: el único camino a un perfil de cliente.
 *
 * Recibe al usuario de Telegram, no una identidad ya resuelta, porque la
 * primera vez **no existe todavía**: es esta función la que la crea
 * (SPEC-009 §3).
 */
export async function linkClient(
  token: string,
  user: TelegramUser,
  deps: DeliveryDeps,
): Promise<LinkOutcome> {
  // ── Solo en privado ────────────────────────────────────────────────────
  // En un chat privado `chat.id` y `from.id` coinciden; en un grupo no. Sin
  // esta guarda, un `/start` escrito en un grupo publicaría ahí la rutina y
  // todos los avisos siguientes (regla 12).
  //
  // Se calla: responder en el grupo confirmaría que el token existe.
  if (user.chatId !== user.telegramUserId) return { kind: 'not_private' };

  const client = await deps.repo.findClientByToken(token);

  if (client === null) {
    await deps.sender.sendMessage(user.chatId, RESPUESTA_NEUTRA);
    return { kind: 'invalid_token' };
  }

  // Ya canjeado por OTRA persona. Puede ser un enlace reenviado por error o
  // algo peor: al que lo intenta se le responde neutro, al entrenador se le
  // cuenta.
  //
  // Se comprueba ANTES de resolver el perfil, y por eso `ClientForLink` trae
  // el `telegram_user_id` de quien lo canjeó: así un intento con un token
  // ajeno no llega a crear nada.
  if (client.linkedProfileId !== null && client.linkedTelegramUserId !== user.telegramUserId) {
    await deps.sender.sendMessage(user.chatId, RESPUESTA_NEUTRA);
    await deps.sender.sendMessage(
      client.trainerChatId,
      `⚠️ Alguien intentó usar el enlace de ${client.fullName}, que ya estaba vinculado\\.`,
    );
    return { kind: 'already_linked_elsewhere' };
  }

  // El nombre sale de la ficha del cliente, NUNCA del update: el `first_name`
  // lo elige quien escribe (SPEC-009 regla 1b).
  const profile = await deps.repo.ensureClientProfile(
    user.telegramUserId,
    user.chatId,
    client.fullName,
  );

  // Ya es entrenador. No se le cambia el rol por haber pulsado un enlace.
  if (profile === null) {
    await deps.sender.sendMessage(user.chatId, RESPUESTA_NEUTRA);
    return { kind: 'not_a_client' };
  }

  // El `UNIQUE` de `clients.profile_id` es lo que impide que una persona se
  // vincule a dos fichas. Si dice que no, NO se da la bienvenida: decirle «ya
  // estás conectado» a quien no lo está lo deja esperando una rutina que no
  // va a llegar (regla 11).
  if (!(await deps.repo.linkClient(client.clientId, profile.profileId))) {
    await deps.sender.sendMessage(user.chatId, RESPUESTA_NEUTRA);
    return { kind: 'link_failed' };
  }

  // ┌─ DECIRLE QUÉ SIGUE, NO SOLO QUE SE CONECTÓ ─────────────────────────┐
  // │ «Ya estás conectado» y nada más dejaba al cliente mirando un chat    │
  // │ vacío, sin saber si tenía que hacer algo. Probaba comandos a ciegas. │
  // └──────────────────────────────────────────────────────────────────────┘
  await deps.sender.sendMessage(
    user.chatId,
    [
      `👋 Hola ${client.fullName}, ya estás conectado con tu entrenador\\.`,
      '',
      'Aquí vas a recibir tu rutina y un check\\-in corto cada lunes\\.',
      'Escribe /ayuda cuando quieras ver qué puedes hacer\\.',
    ].join('\n'),
  );

  // ── La entrega diferida ────────────────────────────────────────────────
  const esperando = await deps.repo.findApprovedVersion(client.clientId);
  if (esperando === null) return { kind: 'linked', clientId: client.clientId, delivered: false };

  const entrega = await enviar(esperando, deps);
  return { kind: 'linked', clientId: client.clientId, delivered: entrega.kind === 'delivered' };
}

export async function deliverVersion(
  versionId: string,
  deps: DeliveryDeps,
): Promise<DeliverOutcome> {
  const version = await deps.repo.findVersion(versionId);
  if (version === null) return { kind: 'not_found' };

  // `SENT → SENT` no existe en la máquina: no se duplica una entrega (CA-8).
  if (nextState(version.state, 'SEND') === null) {
    return { kind: 'not_deliverable', state: version.state };
  }

  return enviar(version, deps);
}

/** El envío en sí. Compartido por la entrega directa y la diferida. */
async function enviar(
  version: VersionForDelivery,
  deps: DeliveryDeps,
): Promise<DeliverOutcome> {
  const destino = nextState(version.state, 'SEND');
  if (destino === null) return { kind: 'not_deliverable', state: version.state };

  // Aprobada, pero el cliente aún no abrió su enlace. La rutina NO se marca
  // enviada: espera en APPROVED y saldrá sola al vincularse (CA-3).
  if (version.clientChatId === null) {
    await deps.sender.sendMessage(
      version.trainerChatId,
      `⏳ ${version.clientName} todavía no abrió su enlace\\. La rutina le llegará en cuanto lo haga\\.`,
    );
    return { kind: 'undelivered' };
  }

  // ── 1. Mandar PRIMERO ──────────────────────────────────────────────────
  try {
    await deps.sender.sendMessage(
      version.clientChatId,
      formatForClient(version.content, {
        clientName: version.clientName,
        plan: version.plan,
      }),
      // SPEC-010 regla 10: sin estos dos botones, «pedir un cambio» sería una
      // función que el cliente nunca ve.
      buildKeyboard(CLIENT_ACTIONS, version.versionId),
    );
  } catch {
    // El cliente bloqueó el bot, o Telegram falló. La rutina NO se pierde:
    // sigue en APPROVED esperando, y el entrenador se entera.
    await deps.sender.sendMessage(
      version.trainerChatId,
      `⚠️ No pude entregarle la rutina a ${version.clientName}\\. Sigue pendiente\\.`,
    );
    return { kind: 'undelivered' };
  }

  // ── 2. Y SOLO ENTONCES marcar SENT ─────────────────────────────────────
  if (!(await deps.repo.transition(version.versionId, version.state, destino))) {
    return { kind: 'already_sent' };
  }

  // SPEC-010 regla 12: la v2 que sale responde a lo que el cliente pidió.
  // Va DESPUÉS de marcar SENT: si se resolviera antes y el envío fallara, la
  // queja quedaría cerrada sin que llegara nada.
  const resueltas = await deps.repo.resolveRequests(version.versionId);

  // Regla 6: el entrenador sabe que llegó.
  await deps.sender.sendMessage(
    version.trainerChatId,
    resueltas > 0
      ? `✅ ${version.clientName} recibió su rutina nueva\\.`
      : `✅ ${version.clientName} recibió su rutina\\.`,
  );

  return { kind: 'delivered', versionId: version.versionId };
}
