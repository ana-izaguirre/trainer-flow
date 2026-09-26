/**
 * SPEC-027 — Pedir la actualización de datos: el cliente con `/actualizar`,
 * o el entrenador con 📝 desde la ficha.
 */
import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import type { Identity } from '../domain/identity.ts';
import type { ClientForResend } from '../ports/link-ports.ts';
import {
  requestClientUpdate,
  requestOwnUpdate,
  type UpdateRequestDeps,
} from './update-request.ts';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const FORM = 'https://tally.so/r/abc123';
const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

const TRAINER: Identity = {
  profileId: 'perfil-entrenador',
  role: 'trainer',
  telegramUserId: 10,
  telegramChatId: 10,
};
const OTRO_ENTRENADOR: Identity = { ...TRAINER, profileId: 'otro-perfil' };
const CLIENTE: Identity = {
  profileId: 'perfil-cliente',
  role: 'client',
  telegramUserId: 500,
  telegramChatId: 500,
};

function cliente(extra: Partial<ClientForResend> = {}): ClientForResend {
  return {
    client: { clientId: 'c1', trainerId: 'perfil-entrenador', profileId: 'perfil-cliente' },
    // Con guion: si no se escapa, Telegram rechaza el mensaje entero.
    fullName: 'Ana-María Ruiz',
    linked: true,
    linkToken: 'no-se-usa-aqui-0000000000',
    ...extra,
  };
}

function espia(
  opciones: {
    cliente?: ClientForResend | null;
    chatDelCliente?: number | null;
    clienteDelPerfil?: string | null;
    formUrl?: string | null;
  } = {},
) {
  const pasos: string[] = [];
  const mensajes: { chatId: number; text: string }[] = [];

  const deps: UpdateRequestDeps = {
    repo: {
      issueForProfile: (profileId, token) => {
        pasos.push(`issueForProfile:${profileId}:${token}`);
        return Promise.resolve(
          opciones.clienteDelPerfil === undefined ? 'c1' : opciones.clienteDelPerfil,
        );
      },
      issueForClient: (clientId, token) => {
        pasos.push(`issueForClient:${clientId}:${token}`);
        return Promise.resolve(opciones.chatDelCliente === undefined ? 500 : opciones.chatDelCliente);
      },
    },
    clients: {
      findClientForVersion: () => {
        pasos.push('findClientForVersion');
        return Promise.resolve(opciones.cliente === undefined ? cliente() : opciones.cliente);
      },
    },
    sender: {
      sendMessage: (chatId, text) => {
        if (tieneCaracterSinEscapar(text)) throw new Error(`sin escapar: ${text}`);
        mensajes.push({ chatId, text });
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
    newToken: () => TOKEN,
    formUrl: opciones.formUrl === undefined ? FORM : opciones.formUrl,
  };

  return { deps, pasos, mensajes };
}

const enlace = `${FORM}?update=${TOKEN}`;
/** El enlace tal como queda escapado para MarkdownV2. */
const enlaceEscapado = enlace.replace(/[_.\-=]/g, (c) => `\\${c}`);

describe('/actualizar — el cliente pide el suyo', () => {
  it('CA-1 · emite el token con SU perfil y le manda el enlace', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await requestOwnUpdate(CLIENTE, deps);

    expect(outcome).toEqual({ kind: 'sent', clientId: 'c1' });
    expect(pasos).toEqual([`issueForProfile:perfil-cliente:${TOKEN}`]);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]!.chatId).toBe(500);
    expect(mensajes[0]!.text).toContain(enlaceEscapado);
    expect(mensajes[0]!.text).toContain('7 días');
    // Regla 5: que sepa que su rutina no cambia sola.
    expect(mensajes[0]!.text).toContain('Tu rutina actual no cambia');
  });

  it('un perfil sin ficha de cliente: no hay enlace', async () => {
    const { deps, mensajes } = espia({ clienteDelPerfil: null });

    expect(await requestOwnUpdate(CLIENTE, deps)).toEqual({ kind: 'no_client' });
    expect(mensajes[0]!.text).not.toContain('tally');
  });

  it('sin el enlace del formulario configurado, no emite nada', async () => {
    const { deps, pasos, mensajes } = espia({ formUrl: null });

    expect(await requestOwnUpdate(CLIENTE, deps)).toEqual({ kind: 'not_configured' });
    expect(pasos).toEqual([]);
    expect(mensajes[0]!.text).toContain('entrenador');
  });

  it('🔴 un entrenador no emite por este camino', async () => {
    const { deps, pasos } = espia();

    expect(await requestOwnUpdate(TRAINER, deps)).toEqual({ kind: 'rejected' });
    expect(pasos).toEqual([]);
  });
});

describe('📝 Pedir actualización — el entrenador, desde la ficha', () => {
  it('CA-1 · emite el token y le manda el enlace AL CLIENTE, no al entrenador', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await requestClientUpdate(VERSION, TRAINER, deps);

    expect(outcome).toEqual({ kind: 'sent', clientId: 'c1' });
    expect(pasos).toContain(`issueForClient:c1:${TOKEN}`);
    const alCliente = mensajes.find((m) => m.chatId === 500);
    expect(alCliente?.text).toContain(enlaceEscapado);
    // Y al entrenador, que ya se lo mandó, sin el token.
    const alEntrenador = mensajes.find((m) => m.chatId === 10);
    expect(alEntrenador?.text).toContain('Ana\\-María Ruiz');
    expect(alEntrenador?.text).not.toContain(TOKEN.slice(0, 10));
  });

  it('🔴 CA-9 · un cliente de OTRO entrenador: nada se emite ni se manda', async () => {
    const { deps, pasos, mensajes } = espia();

    expect(await requestClientUpdate(VERSION, OTRO_ENTRENADOR, deps)).toEqual({ kind: 'rejected' });
    expect(pasos.some((p) => p.startsWith('issue'))).toBe(false);
    expect(mensajes.map((m) => m.chatId)).toEqual([10]);
  });

  it('🔴 un cliente que fabrica el botón tampoco', async () => {
    const { deps, pasos } = espia();

    expect(await requestClientUpdate(VERSION, CLIENTE, deps)).toEqual({ kind: 'rejected' });
    expect(pasos.some((p) => p.startsWith('issue'))).toBe(false);
  });

  it('una versión que no existe suena igual que una ajena', async () => {
    const inexistente = espia({ cliente: null });
    const ajena = espia();

    await requestClientUpdate(VERSION, TRAINER, inexistente.deps);
    await requestClientUpdate(VERSION, OTRO_ENTRENADOR, ajena.deps);

    expect(inexistente.mensajes.map((m) => m.text)).toEqual(ajena.mensajes.map((m) => m.text));
  });

  it('sin vincular: se le dice al entrenador y no se emite nada', async () => {
    const { deps, pasos, mensajes } = espia({ cliente: cliente({ linked: false }) });

    expect(await requestClientUpdate(VERSION, TRAINER, deps)).toEqual({
      kind: 'not_linked',
      clientId: 'c1',
    });
    expect(pasos.some((p) => p.startsWith('issue'))).toBe(false);
    expect(mensajes[0]!.text).toContain('todavía no está vinculad');
  });

  it('si se desvincula entre medias, la base no emite y se dice igual', async () => {
    const { deps, mensajes } = espia({ chatDelCliente: null });

    expect(await requestClientUpdate(VERSION, TRAINER, deps)).toEqual({
      kind: 'not_linked',
      clientId: 'c1',
    });
    expect(mensajes.map((m) => m.chatId)).toEqual([10]);
  });

  it('sin el enlace del formulario configurado, se le dice qué falta', async () => {
    const { deps, pasos, mensajes } = espia({ formUrl: null });

    expect(await requestClientUpdate(VERSION, TRAINER, deps)).toEqual({ kind: 'not_configured' });
    expect(pasos.some((p) => p.startsWith('issue'))).toBe(false);
    expect(mensajes[0]!.text).toContain('TALLY\\_FORM\\_URL');
  });
});
