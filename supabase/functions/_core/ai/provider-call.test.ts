/**
 * SPEC-002 regla 8, compartida con SPEC-004 — un intento, y uno más solo si
 * el fallo puede salir distinto.
 */
import { describe, expect, it } from 'vitest';
import type { AIProvider, AIRequest, AIResult } from '../ports/ai-provider.ts';
import { callWithRetry } from './provider-call.ts';

const REQUEST: AIRequest = {
  goal: 'Fuerza',
  level: 'intermediate',
  gender: null,
  age: null,
  weightKg: null,
  heightCm: null,
  quitReasons: null,
  menopauseStage: null,
  lastWeighed: null,
  chronicConditions: null,
  medications: null,
  equipmentDetail: null,
  lifestyle: null,
  notes: null,
  daysPerWeek: 3,
  sessionMinutes: 60,
  equipment: 'Barra',
  limitations: null,
  instruction: null,
};

const EXITO: AIResult = {
  ok: true,
  draft: { source: 'ai', raw: { summary: 'x', days: [], warnings: [] } },
  usage: { tokensIn: 1, tokensOut: 1 },
};

const fallo = (reason: AIResult extends { ok: false } ? never : string): AIResult =>
  ({ ok: false, reason, detail: 'x' }) as AIResult;

describe('callWithRetry', () => {
  it('éxito al primer intento: no reintenta', async () => {
    let llamadas = 0;
    const provider: AIProvider = {
      name: 'x',
      model: 'x',
      generate: () => {
        llamadas += 1;
        return Promise.resolve(EXITO);
      },
    };

    const resultado = await callWithRetry(provider, REQUEST, () => new AbortController().signal);

    expect(resultado).toEqual(EXITO);
    expect(llamadas).toBe(1);
  });

  it('un 429 (RATE_LIMITED) NUNCA se reintenta', async () => {
    let llamadas = 0;
    const provider: AIProvider = {
      name: 'x',
      model: 'x',
      generate: () => {
        llamadas += 1;
        return Promise.resolve(fallo('RATE_LIMITED'));
      },
    };

    await callWithRetry(provider, REQUEST, () => new AbortController().signal);

    expect(llamadas).toBe(1);
  });

  it('INVALID_OUTPUT NUNCA se reintenta: la misma petición da la misma basura', async () => {
    let llamadas = 0;
    const provider: AIProvider = {
      name: 'x',
      model: 'x',
      generate: () => {
        llamadas += 1;
        return Promise.resolve(fallo('INVALID_OUTPUT'));
      },
    };

    await callWithRetry(provider, REQUEST, () => new AbortController().signal);

    expect(llamadas).toBe(1);
  });

  it('API_ERROR se reintenta UNA vez y puede recuperarse', async () => {
    let llamadas = 0;
    const provider: AIProvider = {
      name: 'x',
      model: 'x',
      generate: () => {
        llamadas += 1;
        return Promise.resolve(llamadas === 1 ? fallo('API_ERROR') : EXITO);
      },
    };

    const resultado = await callWithRetry(provider, REQUEST, () => new AbortController().signal);

    expect(resultado).toEqual(EXITO);
    expect(llamadas).toBe(2);
  });

  it('TIMEOUT se reintenta UNA vez y, si vuelve a fallar, se rinde', async () => {
    let llamadas = 0;
    const provider: AIProvider = {
      name: 'x',
      model: 'x',
      generate: () => {
        llamadas += 1;
        return Promise.resolve(fallo('TIMEOUT'));
      },
    };

    const resultado = await callWithRetry(provider, REQUEST, () => new AbortController().signal);

    expect(resultado).toEqual(fallo('TIMEOUT'));
    expect(llamadas).toBe(2);
  });

  it('cada intento recibe su propia señal de timeout', async () => {
    const señales: AbortSignal[] = [];
    let llamadas = 0;
    const provider: AIProvider = {
      name: 'x',
      model: 'x',
      generate: (_req, signal) => {
        llamadas += 1;
        señales.push(signal);
        return Promise.resolve(llamadas === 1 ? fallo('TIMEOUT') : EXITO);
      },
    };

    await callWithRetry(provider, REQUEST, () => new AbortController().signal);

    expect(señales).toHaveLength(2);
    expect(señales[0]).not.toBe(señales[1]);
  });
});
