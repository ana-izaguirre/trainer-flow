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
import type { DeliveryRepo, VersionForDelivery } from '../ports/delivery-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { formatForClient } from './client-format.ts';

export interface DeliveryDeps {
  readonly repo: DeliveryRepo;
  readonly sender: TelegramSender;
}

export interface ClientIdentity {
  readonly profileId: string;
  readonly chatId: number;
}

export type LinkOutcome =
  | { readonly kind: 'linked'; readonly clientId: string; readonly delivered: boolean }
  | { readonly kind: 'already_linked_elsewhere' }
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

export async function linkClient(
  token: string,
  identity: ClientIdentity,
  deps: DeliveryDeps,
): Promise<LinkOutcome> {
  const client = await deps.repo.findClientByToken(token);

  if (client === null) {
    await deps.sender.sendMessage(identity.chatId, RESPUESTA_NEUTRA);
    return { kind: 'invalid_token' };
  }

  // Ya vinculado, pero a OTRO perfil. Puede ser un enlace reenviado por error
  // o algo peor: al cliente se le responde neutro, al entrenador se le cuenta.
  if (client.linkedProfileId !== null && client.linkedProfileId !== identity.profileId) {
    await deps.sender.sendMessage(identity.chatId, RESPUESTA_NEUTRA);
    await deps.sender.sendMessage(
      client.trainerChatId,
      `⚠️ Alguien intentó usar el enlace de ${client.fullName}, que ya estaba vinculado\\.`,
    );
    return { kind: 'already_linked_elsewhere' };
  }

  await deps.repo.linkClient(client.clientId, identity.profileId, identity.chatId);
  await deps.sender.sendMessage(
    identity.chatId,
    `👋 Hola ${client.fullName}, ya estás conectado con tu entrenador\\.`,
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

  // ── 1. Mandar PRIMERO ──────────────────────────────────────────────────
  try {
    await deps.sender.sendMessage(
      version.clientChatId,
      formatForClient(version.content, {
        clientName: version.clientName,
        goal: version.goal,
        daysPerWeek: version.daysPerWeek,
        sessionMinutes: version.sessionMinutes,
      }),
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

  // Regla 6: el entrenador sabe que llegó.
  await deps.sender.sendMessage(
    version.trainerChatId,
    `✅ ${version.clientName} recibió su rutina\\.`,
  );

  return { kind: 'delivered', versionId: version.versionId };
}
