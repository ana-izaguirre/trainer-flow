/**
 * SPEC-002 §11 — sweepStaleGenerations.
 */
import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import type { StaleGeneration, SweepRepo } from '../ports/sweep-ports.ts';
import { sweepStaleGenerations, type SweepDeps } from './sweep-stale-generations.ts';

function candidata(extra: Partial<StaleGeneration> = {}): StaleGeneration {
  return {
    versionId: 'v-1',
    trainerChatId: 900,
    clientName: 'Ana-María Ruiz',
    minutesStuck: 12,
    ...extra,
  };
}

function espia(
  opciones: {
    candidatas?: readonly StaleGeneration[];
    transitionResult?: (versionId: string) => boolean;
  } = {},
) {
  const mensajes: { chatId: number; text: string }[] = [];
  const transiciones: string[] = [];

  const repo: SweepRepo = {
    staleGenerations: () => Promise.resolve(opciones.candidatas ?? [candidata()]),
    transition: (versionId, from, to) => {
      transiciones.push(`${versionId}:${from}->${to}`);
      return Promise.resolve(opciones.transitionResult?.(versionId) ?? true);
    },
  };

  const deps: SweepDeps = {
    repo,
    sender: {
      sendMessage: (chatId, text) => {
        mensajes.push({ chatId, text });
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
    minMinutes: 5,
  };

  return { deps, mensajes, transiciones };
}

describe('sweepStaleGenerations', () => {
  it('sin candidatas, no hace nada', async () => {
    const { deps, mensajes } = espia({ candidatas: [] });

    const resultado = await sweepStaleGenerations(deps);

    expect(resultado).toEqual({ checked: 0, recovered: 0 });
    expect(mensajes).toEqual([]);
  });

  it('una candidata: vuelve a NEW y avisa al entrenador', async () => {
    const { deps, mensajes, transiciones } = espia();

    const resultado = await sweepStaleGenerations(deps);

    expect(resultado).toEqual({ checked: 1, recovered: 1 });
    expect(transiciones).toEqual(['v-1:GENERATING->NEW']);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]?.chatId).toBe(900);
    expect(mensajes[0]?.text).toContain('12 minutos');
  });

  it('la guarda de concurrencia: si ya no estaba en GENERATING, no cuenta ni avisa', async () => {
    // Terminó de verdad un instante antes de esta pasada: no hay nada que
    // arreglar, y avisar igual confundiría al entrenador con un problema
    // que no existió.
    const { deps, mensajes } = espia({ transitionResult: () => false });

    const resultado = await sweepStaleGenerations(deps);

    expect(resultado).toEqual({ checked: 1, recovered: 0 });
    expect(mensajes).toEqual([]);
  });

  it('varias candidatas, cada una a su propio entrenador', async () => {
    const { deps, mensajes } = espia({
      candidatas: [
        candidata({ versionId: 'v-1', trainerChatId: 900, clientName: 'Ana' }),
        candidata({ versionId: 'v-2', trainerChatId: 901, clientName: 'Luis' }),
      ],
    });

    const resultado = await sweepStaleGenerations(deps);

    expect(resultado).toEqual({ checked: 2, recovered: 2 });
    expect(mensajes.map((m) => m.chatId)).toEqual([900, 901]);
  });

  it('una recuperada y otra que ya no estaba: solo cuenta y avisa de la real', async () => {
    const { deps, mensajes } = espia({
      candidatas: [
        candidata({ versionId: 'v-1' }),
        candidata({ versionId: 'v-2', trainerChatId: 901 }),
      ],
      transitionResult: (versionId) => versionId === 'v-1',
    });

    const resultado = await sweepStaleGenerations(deps);

    expect(resultado).toEqual({ checked: 2, recovered: 1 });
    expect(mensajes.map((m) => m.chatId)).toEqual([900]);
  });

  it('el aviso no lleva ningún carácter de MarkdownV2 sin escapar', async () => {
    const { deps, mensajes } = espia({ candidatas: [candidata({ clientName: 'Ana-María Ruiz' })] });

    await sweepStaleGenerations(deps);

    expect(tieneCaracterSinEscapar(mensajes[0]!.text)).toBe(false);
    expect(mensajes[0]!.text).toContain('Ana\\-María Ruiz');
  });
});
