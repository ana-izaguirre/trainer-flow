/**
 * SPEC-014 §3 — Reenviar el enlace de vinculación, a pedido.
 *
 * ┌─ POR QUÉ EXISTE, Y POR QUÉ NO DESDE EL PRINCIPIO ──────────────────────┐
 * │ El enlace ya llega una vez, en el aviso de nueva evaluación            │
 * │ (SPEC-014). Esta spec dejó ESTO fuera a propósito: «el mensaje sigue   │
 * │ en el historial, se puede buscar hacia atrás. Si resulta incómodo en   │
 * │ uso real, se añade entonces.» Pasó: sin esto, la única forma de        │
 * │ recuperar un `link_token` era SQL directo contra la base.              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Mismo trato que SPEC-015 (`assessment/intake.ts`): leer no transiciona, y
 * la pertenencia se comprueba antes de enseñar nada, porque llega desde un
 * `callback_data` que fabrica cualquiera (SPEC-013 regla 1).
 */
import { canManageClient } from '../authorization.ts';
import type { Identity } from '../domain/identity.ts';
import type { LinkResendRepo } from '../ports/link-ports.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import { buildDeepLink } from './start.ts';
import { escapeMarkdownV2 } from './format.ts';

export interface ResendLinkDeps {
  readonly repo: LinkResendRepo;
  readonly sender: TelegramSender;
  /** Sin `@`. Igual que en SPEC-014: arma `t.me/<usuario>?start=<token>`. */
  readonly botUsername: string;
}

export type ResendLinkOutcome =
  | { readonly kind: 'sent'; readonly clientId: string }
  | { readonly kind: 'already_linked'; readonly clientId: string }
  /** No existe, o no es suya. Las dos suenan igual (SPEC-013 regla 2). */
  | { readonly kind: 'rejected' };

const RESPUESTA_NEUTRA = 'No puedo hacer eso con esta rutina\\.';

export async function resendLink(
  versionId: string,
  actor: Identity,
  deps: ResendLinkDeps,
): Promise<ResendLinkOutcome> {
  const cliente = await deps.repo.findClientForVersion(versionId);

  if (cliente === null || !canManageClient(actor, cliente.client).allowed) {
    await deps.sender.sendMessage(actor.telegramChatId, RESPUESTA_NEUTRA);
    return { kind: 'rejected' };
  }

  if (cliente.linked) {
    // Ya no hace falta: mandarlo igual no rompe nada, pero decir que ya está
    // vinculado evita que el entrenador lo reenvíe sin necesidad.
    await deps.sender.sendMessage(
      actor.telegramChatId,
      `${escapeMarkdownV2(cliente.fullName)} ya está vinculado\\.`,
    );
    return { kind: 'already_linked', clientId: cliente.client.clientId };
  }

  await deps.sender.sendMessage(
    actor.telegramChatId,
    // El mismo texto que en el aviso original (SPEC-014 regla 5): dice qué
    // hacer con el enlace, no lo deja suelto.
    `🔗 Mándale este enlace a ${escapeMarkdownV2(cliente.fullName)} para que reciba su rutina:\n` +
      escapeMarkdownV2(buildDeepLink(deps.botUsername, cliente.linkToken)),
  );
  return { kind: 'sent', clientId: cliente.client.clientId };
}
