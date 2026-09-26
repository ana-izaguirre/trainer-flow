/**
 * SPEC-027 — Pedir la actualización de datos.
 *
 * Dos caminos, un mismo mensaje al cliente:
 *
 *   /actualizar             lo escribe el CLIENTE: sabe cuándo le cambió algo
 *   📝 Pedir actualización  lo pulsa el ENTRENADOR, desde la ficha (regla 3)
 *
 * ┌─ LO QUE ESTO NO HACE ──────────────────────────────────────────────────┐
 * │ No cambia ninguna rutina ni genera ninguna. Emite un enlace. Lo que    │
 * │ llegue por él avisa al entrenador, y es él quien decide si hace falta  │
 * │ una v2 (principio 1).                                                  │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { canManageClient } from '../authorization.ts';
import type { Identity } from '../domain/identity.ts';
import type { LinkResendRepo } from '../ports/link-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import type { UpdateTokenRepo } from '../ports/update-ports.ts';
import { escapeMarkdownV2 } from '../telegram/format.ts';
import { buildUpdateUrl } from './update-token.ts';

export interface UpdateRequestDeps {
  readonly repo: UpdateTokenRepo;
  /** Para resolver el cliente desde el `versionId` del botón de la ficha. */
  readonly clients: LinkResendRepo;
  readonly sender: TelegramSender;
  /** 32 bytes de CSPRNG en base64url. Lo genera `_shared`: `_core` no tiene crypto. */
  readonly newToken: () => string;
  /**
   * El enlace público del formulario (`TALLY_FORM_URL`). `null` si no está
   * configurado: entonces no se emite nada, porque no habría dónde usarlo.
   */
  readonly formUrl: string | null;
}

export type UpdateRequestOutcome =
  | { readonly kind: 'sent'; readonly clientId: string }
  | { readonly kind: 'not_linked'; readonly clientId: string }
  | { readonly kind: 'not_configured' }
  /** El perfil que escribió `/actualizar` no es de ningún cliente. */
  | { readonly kind: 'no_client' }
  /** No existe, o no es suyo. Las dos suenan igual (SPEC-013 regla 2). */
  | { readonly kind: 'rejected' };

const RESPUESTA_NEUTRA = 'No puedo hacer eso con esta rutina\\.';

/** El mismo texto por los dos caminos. `outcome` nunca lleva el token. */
function mensajeAlCliente(formUrl: string, token: string): string {
  return [
    '📝 Para actualizar tus datos, llena de nuevo tu evaluación con este enlace:',
    // Como el deep link de SPEC-014: texto escapado, que Telegram convierte
    // en enlace solo. Un `[texto](url)` pediría escapar distinto la URL.
    escapeMarkdownV2(buildUpdateUrl(formUrl, token)),
    '',
    'Es solo tuyo y vence en 7 días\\. Tu rutina actual no cambia hasta que tu entrenador la revise\\.',
  ].join('\n');
}

/** `/actualizar`, escrito por el propio cliente (regla 1). */
export async function requestOwnUpdate(
  actor: Identity,
  deps: UpdateRequestDeps,
): Promise<UpdateRequestOutcome> {
  // El webhook solo enruta aquí a clientes. Se comprueba igual: esto emite
  // una credencial, y no puede depender de un `if` que vive en otro archivo.
  if (actor.role !== 'client') {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'rejected' };
  }

  if (deps.formUrl === null) {
    await deps.sender.sendMessage(
      actor.telegramChatId,
      'Todavía no puedo darte ese enlace\\. Escríbele a tu entrenador\\.',
    );
    return { kind: 'not_configured' };
  }

  const token = deps.newToken();
  const clientId = await deps.repo.issueForProfile(actor.profileId, token);

  if (clientId === null) {
    await deps.sender.sendMessage(
      actor.telegramChatId,
      'No encontré tu ficha\\. Escríbele a tu entrenador\\.',
    );
    return { kind: 'no_client' };
  }

  await deps.sender.sendMessage(actor.telegramChatId, mensajeAlCliente(deps.formUrl, token));
  return { kind: 'sent', clientId };
}

/** 📝 Pedir actualización, desde la ficha del entrenador (regla 3). */
export async function requestClientUpdate(
  versionId: string,
  actor: Identity,
  deps: UpdateRequestDeps,
): Promise<UpdateRequestOutcome> {
  // El `versionId` llega de un `callback_data`, que fabrica cualquiera: la
  // pertenencia se comprueba antes de emitir nada (SPEC-013 regla 1).
  const cliente = await deps.clients.findClientForVersion(versionId);

  if (cliente === null || !canManageClient(actor, cliente.client).allowed) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'rejected' };
  }

  const nombre = escapeMarkdownV2(cliente.fullName);
  const sinVincular = async () => {
    await deps.sender.sendMessage(
      actor.telegramChatId,
      `${nombre} todavía no está vinculado al bot\\. Mándale primero su enlace \\(🔗\\)\\.`,
    );
    return { kind: 'not_linked', clientId: cliente.client.clientId } as const;
  };

  if (!cliente.linked) return sinVincular();

  if (deps.formUrl === null) {
    await deps.sender.sendMessage(
      actor.telegramChatId,
      'Falta configurar el enlace del formulario \\(TALLY\\_FORM\\_URL\\)\\. Está explicado en docs/DEPLOY\\.md\\.',
    );
    return { kind: 'not_configured' };
  }

  const token = deps.newToken();
  const chatDelCliente = await deps.repo.issueForClient(cliente.client.clientId, token);

  // Se desvinculó entre la consulta y la emisión: la base no emitió nada.
  if (chatDelCliente === null) return sinVincular();

  await deps.sender.sendMessage(chatDelCliente, mensajeAlCliente(deps.formUrl, token));
  await deps.sender.sendMessage(
    actor.telegramChatId,
    `📝 Le mandé a ${nombre} el enlace para actualizar sus datos\\. Te aviso cuando lo llene\\.`,
  );
  return { kind: 'sent', clientId: cliente.client.clientId };
}
