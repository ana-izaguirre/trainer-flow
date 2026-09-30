/**
 * SPEC-030 regla 13 — sweepUnopenedLinks.
 */
import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import type { AwaitingLinkReminder, LinkReminderRepo } from '../ports/link-reminder-ports.ts';
import { sweepUnopenedLinks, type LinkReminderDeps } from './sweep-unopened-links.ts';

function candidata(extra: Partial<AwaitingLinkReminder> = {}): AwaitingLinkReminder {
  return {
    versionId: 'v-1',
    trainerChatId: 900,
    clientName: 'Ana-María Ruiz',
    ...extra,
  };
}

function espia(
  opciones: {
    candidatas?: readonly AwaitingLinkReminder[];
    /** Por `chatId`: qué envío debe fallar. */
    fallaEnvioA?: readonly number[];
  } = {},
) {
  const mensajes: { chatId: number; text: string; keyboard?: unknown }[] = [];
  const marcados: string[] = [];

  const repo: LinkReminderRepo = {
    awaitingReminder: () => Promise.resolve(opciones.candidatas ?? [candidata()]),
    markReminded: (versionId) => {
      marcados.push(versionId);
      return Promise.resolve();
    },
  };

  const deps: LinkReminderDeps = {
    repo,
    sender: {
      sendMessage: (chatId, text, keyboard) => {
        if (opciones.fallaEnvioA?.includes(chatId) === true) {
          return Promise.reject(new Error('sin red'));
        }
        mensajes.push({ chatId, text, ...(keyboard === undefined ? {} : { keyboard }) });
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
    minHours: 48,
  };

  return { deps, mensajes, marcados };
}

describe('sweepUnopenedLinks', () => {
  it('sin candidatas, no hace nada', async () => {
    const { deps, mensajes, marcados } = espia({ candidatas: [] });

    const resultado = await sweepUnopenedLinks(deps);

    expect(resultado).toEqual({ checked: 0, reminded: 0, failed: 0 });
    expect(mensajes).toEqual([]);
    expect(marcados).toEqual([]);
  });

  it('una candidata: avisa al entrenador con el botón de reenviar y marca', async () => {
    const { deps, mensajes, marcados } = espia();

    const resultado = await sweepUnopenedLinks(deps);

    expect(resultado).toEqual({ checked: 1, reminded: 1, failed: 0 });
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]?.chatId).toBe(900);
    expect(mensajes[0]?.text).toContain('Ana');
    expect(mensajes[0]?.keyboard).toBeDefined();
    expect(marcados).toEqual(['v-1']);
  });

  it('varias candidatas, cada una a su propio entrenador', async () => {
    const { deps, mensajes, marcados } = espia({
      candidatas: [
        candidata({ versionId: 'v-1', trainerChatId: 900, clientName: 'Ana' }),
        candidata({ versionId: 'v-2', trainerChatId: 901, clientName: 'Luis' }),
      ],
    });

    const resultado = await sweepUnopenedLinks(deps);

    expect(resultado).toEqual({ checked: 2, reminded: 2, failed: 0 });
    expect(mensajes.map((m) => m.chatId)).toEqual([900, 901]);
    expect(marcados).toEqual(['v-1', 'v-2']);
  });

  it('un envío que falla no marca esa versión, pero sigue con las demás', async () => {
    const { deps, mensajes, marcados } = espia({
      candidatas: [
        candidata({ versionId: 'v-1', trainerChatId: 900 }),
        candidata({ versionId: 'v-2', trainerChatId: 901 }),
      ],
      fallaEnvioA: [900],
    });

    const resultado = await sweepUnopenedLinks(deps);

    expect(resultado).toEqual({ checked: 2, reminded: 1, failed: 1 });
    expect(mensajes.map((m) => m.chatId)).toEqual([901]);
    expect(marcados).toEqual(['v-2']);
  });

  it('el aviso no lleva ningún carácter de MarkdownV2 sin escapar', async () => {
    const { deps, mensajes } = espia({ candidatas: [candidata({ clientName: 'Ana-María Ruiz' })] });

    await sweepUnopenedLinks(deps);

    expect(tieneCaracterSinEscapar(mensajes[0]!.text)).toBe(false);
    expect(mensajes[0]!.text).toContain('Ana\\-María Ruiz');
  });
});
