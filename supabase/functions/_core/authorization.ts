/**
 * SPEC-009 — Reglas de acceso.
 *
 * Funciones PURAS: reciben los datos ya cargados y devuelven una decisión.
 * No consultan nada, no hacen I/O, no dependen de ningún runtime.
 *
 * ┌─ POR QUÉ ESTE MÓDULO IMPORTA ───────────────────────────────────────────┐
 * │ Con Telegram como única interfaz, todas las operaciones pasan por Edge  │
 * │ Functions con `service_role`, que salta RLS. Este archivo es LO ÚNICO   │
 * │ que separa a un cliente de los datos de otro (ADR-010).                │
 * │ Su cobertura es del 100%, casos denegados incluidos.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Qué responde este módulo:  ¿quién eres y de quién es este recurso?
 * Qué NO responde:           ¿es legal esta transición? → state-machine.ts
 */
import type { Identity } from './domain/identity.ts';
import type { ClientRef, VersionRef } from './domain/version.ts';

export type AuthzDenial =
  /** Quien actúa no es entrenador. */
  | 'NOT_TRAINER'
  /** Quien actúa no es cliente. */
  | 'NOT_CLIENT'
  /** El cliente existe, pero no pertenece a quien actúa. */
  | 'NOT_YOUR_CLIENT'
  /** La versión existe, pero no pertenece a quien actúa. */
  | 'NOT_YOUR_VERSION'
  /** Le pertenece, pero todavía no es visible para él: solo ve `SENT`. */
  | 'VERSION_NOT_VISIBLE';

export type AuthzResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: AuthzDenial };

const ALLOW: AuthzResult = { allowed: true };

function deny(reason: AuthzDenial): AuthzResult {
  return { allowed: false, reason };
}

/** ¿Es el entrenador dueño de este cliente? */
function isOwningTrainer(actor: Identity, client: ClientRef): boolean {
  return actor.role === 'trainer' && actor.profileId === client.trainerId;
}

/**
 * ¿Es este cliente, en persona?
 *
 * Un cliente sin vincular tiene `profileId` en NULL. La comprobación explícita
 * impide que un NULL coincida con nada y abra acceso por accidente.
 */
function isTheClient(actor: Identity, client: ClientRef): boolean {
  return (
    actor.role === 'client' &&
    client.profileId !== null &&
    actor.profileId === client.profileId
  );
}

/** Ver la ficha de un cliente: su entrenador, o él mismo. */
export function canViewClient(actor: Identity, client: ClientRef): AuthzResult {
  if (isOwningTrainer(actor, client) || isTheClient(actor, client)) return ALLOW;
  return deny('NOT_YOUR_CLIENT');
}

/** Modificar un cliente: solo su entrenador. */
export function canManageClient(actor: Identity, client: ClientRef): AuthzResult {
  if (actor.role !== 'trainer') return deny('NOT_TRAINER');
  if (actor.profileId !== client.trainerId) return deny('NOT_YOUR_CLIENT');
  return ALLOW;
}

/**
 * Ver una versión.
 *
 * Es la única regla de este módulo que mira el estado, porque para un cliente
 * *qué puede ver* depende de si la rutina se le envió. Regla 7 de SPEC-009:
 * **el cliente nunca ve un borrador sin aprobar.**
 */
export function canViewVersion(actor: Identity, version: VersionRef): AuthzResult {
  const { client } = version;

  if (isOwningTrainer(actor, client)) return ALLOW;

  if (isTheClient(actor, client)) {
    return version.state === 'SENT' ? ALLOW : deny('VERSION_NOT_VISIBLE');
  }

  return deny('NOT_YOUR_VERSION');
}

/**
 * Editar, aprobar o rechazar una versión: solo su entrenador.
 *
 * Una sola función para las tres acciones porque las tres responden a la misma
 * pregunta. Qué transición es legal desde el estado actual lo decide la máquina
 * de estados, no esto.
 */
export function canModifyVersion(actor: Identity, version: VersionRef): AuthzResult {
  if (actor.role !== 'trainer') return deny('NOT_TRAINER');
  if (actor.profileId !== version.client.trainerId) return deny('NOT_YOUR_VERSION');
  return ALLOW;
}

/**
 * Pedir un cambio: solo el cliente, y solo sobre una rutina que ya recibió.
 *
 * El cliente nunca modifica la rutina (§8): inserta una solicitud y el
 * entrenador decide.
 */
export function canRequestChange(actor: Identity, version: VersionRef): AuthzResult {
  if (actor.role !== 'client') return deny('NOT_CLIENT');
  if (!isTheClient(actor, version.client)) return deny('NOT_YOUR_VERSION');
  if (version.state !== 'SENT') return deny('VERSION_NOT_VISIBLE');
  return ALLOW;
}
