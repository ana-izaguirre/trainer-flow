/**
 * SPEC-014 §3 — resendLink.
 */
import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import type { Identity } from '../domain/identity.ts';
import type { ClientForResend, LinkResendRepo } from '../ports/link-ports.ts';
import { resendLink, type ResendLinkDeps } from './resend-link.ts';

const TRAINER: Identity = {
  profileId: 'perfil-entrenador',
  role: 'trainer',
  telegramUserId: 10,
  telegramChatId: 10,
};

const OTRO_ENTRENADOR: Identity = { ...TRAINER, profileId: 'otro-perfil' };
const CLIENTE: Identity = { ...TRAINER, profileId: 'perfil-cliente', role: 'client' };

function cliente(extra: Partial<ClientForResend> = {}): ClientForResend {
  return {
    client: { clientId: 'c1', trainerId: 'perfil-entrenador', profileId: null },
    // Con guion: la misma lección de actions.test.ts — un nombre "limpio"
    // como «Carlos» no habría atrapado un escapado que faltara.
    fullName: 'Ana-María Ruiz',
    linked: false,
    linkToken: 'un-token-cualquiera-de-32-bytes',
    ...extra,
  };
}

function espia(opciones: { cliente?: ClientForResend | null } = {}) {
  const pasos: string[] = [];
  const mensajes: string[] = [];

  const repo: LinkResendRepo = {
    findClientForVersion: () => {
      pasos.push('findClientForVersion');
      return Promise.resolve(opciones.cliente === undefined ? cliente() : opciones.cliente);
    },
  };

  const deps: ResendLinkDeps = {
    repo,
    botUsername: 'mibot',
    sender: {
      sendMessage: (chatId, text) => {
        // Si esto revienta, Telegram habría hecho lo mismo con el real.
        if (tieneCaracterSinEscapar(text)) {
          throw new Error(`mensaje sin escapar para MarkdownV2: ${text}`);
        }
        mensajes.push(`${chatId}:${text}`);
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, pasos, mensajes };
}

// ---------------------------------------------------------------------------

describe('un cliente sin vincular', () => {
  it('manda el enlace, con instrucciones de qué hacer con él', async () => {
    const { deps, mensajes } = espia();

    const outcome = await resendLink('v1', TRAINER, deps);

    expect(outcome).toEqual({ kind: 'sent', clientId: 'c1' });
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toContain('Mándale este enlace');
    expect(mensajes[0]).toContain('https://t\\.me/mibot?start\\=un\\-token\\-cualquiera\\-de\\-32\\-bytes');
  });

  it('el enlace se escapa: un token con guion o barra baja no rompe el mensaje', async () => {
    // El propio helper de la espía ya reventaría si no, pero lo hacemos
    // explícito: es exactamente lo que rompió SPEC-014 la primera vez.
    const { deps, mensajes } = espia({ cliente: cliente({ linkToken: 'abc-def_ghi' }) });

    await resendLink('v1', TRAINER, deps);

    expect(mensajes[0]).toContain('abc\\-def\\_ghi');
  });
});

describe('un cliente ya vinculado', () => {
  it('lo dice, y no manda el token de nuevo', async () => {
    const { deps, mensajes } = espia({ cliente: cliente({ linked: true }) });

    const outcome = await resendLink('v1', TRAINER, deps);

    expect(outcome).toEqual({ kind: 'already_linked', clientId: 'c1' });
    expect(mensajes[0]).toContain('ya está vinculado');
    expect(mensajes[0]).not.toContain('un-token-cualquiera-de-32-bytes');
  });
});

describe('pertenencia', () => {
  it('una versión que no existe da la respuesta neutra', async () => {
    const { deps, mensajes } = espia({ cliente: null });

    const outcome = await resendLink('v1', TRAINER, deps);

    expect(outcome).toEqual({ kind: 'rejected' });
    expect(mensajes[0]).toContain('No puedo hacer eso');
  });

  it('el cliente de OTRO entrenador da la misma respuesta neutra que uno inexistente', async () => {
    // No existe y no es suya suenan igual (SPEC-013 regla 2): si sonaran
    // distinto, probar IDs diría cuáles son reales.
    const { deps: depsAjeno, mensajes: mensajesAjeno } = espia();
    const { deps: depsInexistente, mensajes: mensajesInexistente } = espia({ cliente: null });

    const ajeno = await resendLink('v1', OTRO_ENTRENADOR, depsAjeno);
    const inexistente = await resendLink('v1', TRAINER, depsInexistente);

    expect(ajeno).toEqual({ kind: 'rejected' });
    expect(ajeno).toEqual(inexistente);
    expect(mensajesAjeno[0]).toContain('No puedo hacer eso');
    expect(mensajesInexistente[0]).toContain('No puedo hacer eso');
  });

  it('un cliente (no entrenador) nunca puede reenviar un enlace', async () => {
    const { deps, mensajes, pasos } = espia();

    const outcome = await resendLink('v1', CLIENTE, deps);

    expect(outcome).toEqual({ kind: 'rejected' });
    // Se consultó igual (la pertenencia se decide con el dato ya cargado,
    // no antes): lo que importa es que no se le manda el enlace a nadie.
    expect(pasos).toContain('findClientForVersion');
    expect(mensajes[0]).toContain('No puedo hacer eso');
  });
});
