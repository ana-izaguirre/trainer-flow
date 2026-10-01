/**
 * SPEC-004 — La edición conversacional: el entrenador escribe qué cambiar,
 * la IA modifica el borrador in-place.
 *
 * Mismas garantías que `generate-version.ts` (SPEC-002): la versión nunca
 * queda en un estado peor que el que tenía, y toda llamada queda registrada.
 * La diferencia es que aquí un fallo no «mata» hacia NEW: la versión YA
 * tenía contenido, y ese contenido se conserva tal cual.
 */
import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import type { AIProvider, AIResult } from '../ports/ai-provider.ts';
import type { EditRepo, VersionForEdit } from '../ports/edit-ports.ts';
import type { GenerationOutcome } from '../ports/generation-ports.ts';
import { applyEditInstruction, type EditDeps } from './edit-version.ts';

const RUTINA_VALIDA = {
  summary: 'Rutina de fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press banca', sets: 4, reps: '8', restSeconds: 120, notes: null }],
    },
  ],
  warnings: [],
};

function versionPendiente(overrides: Partial<VersionForEdit> = {}): VersionForEdit {
  return {
    versionId: 'v1',
    editCount: 1,
    clientName: 'Carlos',
    versionNumber: 1,
    request: {
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
      daysPerWeek: 1,
      sessionMinutes: 60,
      equipment: 'Barra',
      limitations: null,
      instruction: null,
    },
    constraints: { daysPerWeek: 1, hasLimitations: false },
    trainerChatId: 99,
    ...overrides,
  };
}

interface Espia {
  readonly deps: EditDeps;
  readonly pasos: string[];
  readonly cierres: GenerationOutcome[];
  readonly mensajes: string[];
  readonly guardado: unknown[];
}

function espia(
  opciones: {
    pendiente?: VersionForEdit | null;
    generaciones?: readonly Date[];
    respuestas?: readonly AIResult[];
    guardadoFalla?: boolean;
  } = {},
): Espia {
  const pasos: string[] = [];
  const cierres: GenerationOutcome[] = [];
  const mensajes: string[] = [];
  const guardado: unknown[] = [];

  let intento = 0;
  const respuestas = opciones.respuestas ?? [
    { ok: true, draft: { source: 'ai', raw: RUTINA_VALIDA }, usage: { tokensIn: 1, tokensOut: 2 } },
  ];

  const provider: AIProvider = {
    name: 'proveedor-falso',
    model: 'modelo-falso',
    generate: (request) => {
      pasos.push(`generate#${intento + 1}:${request.instruction ?? 'null'}`);
      const r = respuestas[Math.min(intento, respuestas.length - 1)]!;
      intento += 1;
      return Promise.resolve(r);
    },
  };

  const repo: EditRepo = {
    findAwaitingEdit: () => {
      pasos.push('findAwaitingEdit');
      return Promise.resolve(opciones.pendiente === undefined ? versionPendiente() : opciones.pendiente);
    },
    cancelEditWait: () => {
      pasos.push('cancelEditWait');
      return Promise.resolve();
    },
    cancelAnyEditWait: () => {
      pasos.push('cancelAnyEditWait');
      return Promise.resolve();
    },
    recentGenerations: () => {
      pasos.push('recentGenerations');
      return Promise.resolve(opciones.generaciones ?? []);
    },
    startGeneration: (record) => {
      pasos.push(`startGeneration:${record.operation}`);
      return Promise.resolve(7);
    },
    finishGeneration: (_id, outcome) => {
      pasos.push(`finishGeneration:${outcome.status}`);
      cierres.push(outcome);
      return Promise.resolve();
    },
    saveEditedContent: (_v, workout) => {
      pasos.push('saveEditedContent');
      guardado.push(workout);
      return Promise.resolve(!(opciones.guardadoFalla ?? false));
    },
  };

  return {
    deps: {
      repo,
      provider,
      sender: {
        sendMessage: (chatId, text, keyboard) => {
          if (tieneCaracterSinEscapar(text)) {
            throw new Error(`mensaje sin escapar para MarkdownV2: ${text}`);
          }
          mensajes.push(`${chatId}:${text}${keyboard ? ':con-teclado' : ''}`);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
      rateLimit: { maxCalls: 5, windowMinutes: 60 },
      newTimeoutSignal: () => new AbortController().signal,
      now: () => new Date('2026-09-30T12:00:00Z'),
    },
    pasos,
    cierres,
    mensajes,
    guardado,
  };
}

const fallo = (reason: AIResult extends { ok: false } ? never : string): AIResult =>
  ({ ok: false, reason, detail: 'x' }) as AIResult;

// ---------------------------------------------------------------------------

describe('nada esperando', () => {
  it('sin versión esperando instrucción, no se llama a nada más', async () => {
    const { deps, pasos } = espia({ pendiente: null });

    const outcome = await applyEditInstruction('trainer-1', 'quita sentadilla', deps);

    expect(outcome).toEqual({ kind: 'nothing_pending' });
    expect(pasos).toEqual(['findAwaitingEdit']);
  });
});

describe('instrucción inválida: la espera sigue abierta', () => {
  it('vacía (tras trim): se vuelve a preguntar, no se llama al proveedor', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await applyEditInstruction('trainer-1', '   ', deps);

    expect(outcome).toEqual({ kind: 'empty_instruction' });
    expect(pasos).toEqual(['findAwaitingEdit']);
    expect(mensajes[0]).toContain('Carlos');
    expect(mensajes.some((m) => m.includes(':con-teclado'))).toBe(false);
  });

  it('más de 500 caracteres: se pide que la resuma, la espera sigue', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await applyEditInstruction('trainer-1', 'x'.repeat(501), deps);

    expect(outcome).toEqual({ kind: 'instruction_too_long' });
    expect(pasos).toEqual(['findAwaitingEdit']);
    expect(mensajes[0]?.toLowerCase()).toContain('500 caracteres');
  });

  it('exactamente 500 caracteres SÍ es válida', async () => {
    const { deps, pasos } = espia();

    const outcome = await applyEditInstruction('trainer-1', 'x'.repeat(500), deps);

    expect(outcome.kind).not.toBe('instruction_too_long');
    expect(pasos).toContain('recentGenerations');
  });
});

describe('sin margen de cuota', () => {
  const llena = [1, 2, 3, 4, 5].map((m) => new Date(Date.UTC(2026, 8, 30, 11, 60 - m)));

  it('NO se llama al proveedor, y la espera se cancela', async () => {
    const { deps, pasos, mensajes } = espia({ generaciones: llena });

    const outcome = await applyEditInstruction('trainer-1', 'quita sentadilla', deps);

    expect(outcome.kind).toBe('rate_limited');
    expect(pasos).toEqual(['findAwaitingEdit', 'recentGenerations', 'cancelEditWait']);
    expect(mensajes[0]?.toLowerCase()).toContain('cuota');
    // Mismo trato que cualquier otro fallo de edición (buildEditFailed): sin
    // esto, el entrenador se queda sin los botones para seguir.
    expect(mensajes[0]).toContain(':con-teclado');
  });

  it('no se toca el contenido', async () => {
    const { deps, guardado } = espia({ generaciones: llena });

    await applyEditInstruction('trainer-1', 'quita sentadilla', deps);

    expect(guardado).toEqual([]);
  });
});

describe('camino feliz', () => {
  it('llama al proveedor con la instrucción, valida, guarda y avisa con teclado', async () => {
    const { deps, pasos, mensajes, guardado } = espia();

    const outcome = await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

    expect(outcome).toEqual({ kind: 'edited', versionId: 'v1' });
    expect(pasos).toEqual([
      'findAwaitingEdit',
      'recentGenerations',
      'startGeneration:edit',
      'generate#1:Quita sentadilla',
      'saveEditedContent',
      'finishGeneration:SUCCEEDED',
    ]);
    expect(guardado[0]).toMatchObject({ summary: 'Rutina de fuerza' });
    expect(mensajes[0]).toContain(':con-teclado');
  });

  it('registra tokens y latencia como operación edit', async () => {
    const { deps, cierres } = espia();

    await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

    // `now()` es fijo en este espía: la resta da exactamente 0. Si se sumara
    // en vez de restarse, daría un número enorme y distinto de 0.
    expect(cierres[0]).toMatchObject({
      status: 'SUCCEEDED',
      usage: { tokensIn: 1, tokensOut: 2 },
      latencyMs: 0,
    });
  });
});

describe('cuando el proveedor falla', () => {
  it.each(['RATE_LIMITED', 'API_ERROR', 'TIMEOUT', 'INVALID_OUTPUT'] as const)(
    '%s: NO se guarda nada, se avisa, la espera se cancela',
    async (reason) => {
      const { deps, pasos, guardado, cierres } = espia({ respuestas: [fallo(reason)] });

      const outcome = await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

      expect(outcome).toEqual({ kind: 'edit_failed', versionId: 'v1', reason });
      expect(guardado).toEqual([]);
      expect(pasos).toContain('cancelEditWait');
      expect(pasos).not.toContain('saveEditedContent');
      expect(cierres[0]).toMatchObject({
        status: 'FAILED',
        failureReason: expect.stringContaining(reason) as unknown as string,
      });
    },
  );

  it('un 429 NUNCA se reintenta', async () => {
    const { deps, pasos } = espia({ respuestas: [fallo('RATE_LIMITED')] });

    await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

    expect(pasos.filter((p) => p.startsWith('generate'))).toHaveLength(1);
  });

  it('un error de red se reintenta UNA vez y puede recuperarse', async () => {
    const exito: AIResult = {
      ok: true,
      draft: { source: 'ai', raw: RUTINA_VALIDA },
      usage: { tokensIn: 1, tokensOut: 2 },
    };
    const { deps, pasos } = espia({ respuestas: [fallo('API_ERROR'), exito] });

    const outcome = await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

    expect(outcome.kind).toBe('edited');
    expect(pasos.filter((p) => p.startsWith('generate'))).toHaveLength(2);
  });

  it('el proveedor "tiene éxito" pero la respuesta no valida: se trata como fallo', async () => {
    const { deps, guardado, pasos, cierres } = espia({
      respuestas: [
        { ok: true, draft: { source: 'ai', raw: { summary: 'x', days: [], warnings: [] } }, usage: { tokensIn: 1, tokensOut: 1 } },
      ],
    });

    const outcome = await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

    expect(outcome).toEqual({ kind: 'edit_failed', versionId: 'v1', reason: 'INVALID_OUTPUT' });
    expect(guardado).toEqual([]);
    expect(pasos).not.toContain('saveEditedContent');
    expect(pasos).toContain('cancelEditWait');
    expect(cierres[0]?.status === 'FAILED' ? cierres[0].failureReason : '').toContain(
      'no tenía la forma esperada',
    );
  });

  it('si `saveEditedContent` devuelve false (ya no está en DRAFT), no se avisa éxito', async () => {
    // Se aprobó o rechazó mientras la IA trabajaba.
    const { deps, mensajes, cierres } = espia({ guardadoFalla: true });

    const outcome = await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

    expect(outcome).toEqual({ kind: 'edit_failed', versionId: 'v1', reason: 'INVALID_OUTPUT' });
    expect(mensajes.some((m) => m.includes('Carlos'))).toBe(true);
    expect(cierres[0]?.status === 'FAILED' ? cierres[0].failureReason : '').toContain(
      'ya no estaba en DRAFT',
    );
  });

  it('el detalle se acota a 300 caracteres, igual que al generar', async () => {
    const { deps, cierres } = espia({
      respuestas: [{ ok: false, reason: 'API_ERROR', detail: 'x'.repeat(500) } as AIResult],
    });

    await applyEditInstruction('trainer-1', 'Quita sentadilla', deps);

    const guardado = cierres[0]?.status === 'FAILED' ? cierres[0].failureReason : '';
    expect(guardado.length).toBeLessThanOrEqual(300);
  });
});
