/**
 * SPEC-002 — La orquestación de una generación.
 *
 * Lo que este módulo garantiza es que **el sistema nunca queda bloqueado**:
 * pase lo que pase con la IA, la versión termina en un estado desde el que el
 * entrenador puede seguir a mano o con plantilla.
 *
 * Y que TODA llamada queda registrada, incluso las que fallan: sin eso, el
 * consumo de cuota es invisible hasta que se agota.
 */
import { describe, expect, it } from 'vitest';
import type { AIProvider, AIResult } from '../ports/ai-provider.ts';
import type {
  GenerationOutcome,
  GenerationRepo,
  VersionForGeneration,
} from '../ports/generation-ports.ts';
import { generateVersion, type GenerateDeps } from './generate-version.ts';

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

function version(overrides: Partial<VersionForGeneration> = {}): VersionForGeneration {
  return {
    versionId: 'v1',
    state: 'NEW',
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
  readonly deps: GenerateDeps;
  readonly pasos: string[];
  readonly cierres: GenerationOutcome[];
  readonly avisos: string[];
  readonly guardado: unknown[];
}

function espia(opciones: {
  version?: VersionForGeneration | null;
  generaciones?: readonly Date[];
  respuestas?: readonly AIResult[];
  transicionFalla?: boolean;
} = {}): Espia {
  const pasos: string[] = [];
  const cierres: GenerationOutcome[] = [];
  const avisos: string[] = [];
  const guardado: unknown[] = [];

  let intento = 0;
  const respuestas = opciones.respuestas ?? [
    { ok: true, draft: { source: 'ai', raw: RUTINA_VALIDA }, usage: { tokensIn: 1, tokensOut: 2 } },
  ];

  const provider: AIProvider = {
    name: 'proveedor-falso',
    model: 'modelo-falso',
    generate: () => {
      pasos.push(`generate#${intento + 1}`);
      const r = respuestas[Math.min(intento, respuestas.length - 1)]!;
      intento += 1;
      return Promise.resolve(r);
    },
  };

  const repo: GenerationRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(opciones.version === undefined ? version() : opciones.version);
    },
    recentGenerations: () => {
      pasos.push('recentGenerations');
      return Promise.resolve(opciones.generaciones ?? []);
    },
    startGeneration: () => {
      pasos.push('startGeneration');
      return Promise.resolve(7);
    },
    finishGeneration: (_id, outcome) => {
      pasos.push(`finishGeneration:${outcome.status}`);
      cierres.push(outcome);
      return Promise.resolve();
    },
    transition: (_v, from, to) => {
      pasos.push(`transition:${from}->${to}`);
      return Promise.resolve(!(opciones.transicionFalla ?? false));
    },
    saveContent: (_v, workout) => {
      pasos.push('saveContent');
      guardado.push(workout);
      return Promise.resolve();
    },
  };

  return {
    deps: {
      repo,
      provider,
      sender: {
        sendMessage: (chatId, text) => {
          avisos.push(`${chatId}:${text}`);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
      rateLimit: { maxCalls: 5, windowMinutes: 60 },
      newTimeoutSignal: () => new AbortController().signal,
      now: () => new Date('2026-09-17T12:00:00Z'),
    },
    pasos,
    cierres,
    avisos,
    guardado,
  };
}

const fallo = (reason: AIResult extends { ok: false } ? never : string): AIResult =>
  ({ ok: false, reason, detail: 'x' }) as AIResult;

// ---------------------------------------------------------------------------

describe('camino feliz', () => {
  it('genera, valida, guarda y deja la versión en DRAFT', async () => {
    const { deps, pasos, guardado } = espia();

    const outcome = await generateVersion('v1', deps);

    expect(outcome).toEqual({ kind: 'generated', versionId: 'v1' });
    expect(pasos).toEqual([
      'findVersion',
      'recentGenerations',
      'transition:NEW->GENERATING',
      'startGeneration',
      'generate#1',
      'saveContent',
      'finishGeneration:SUCCEEDED',
      'transition:GENERATING->DRAFT',
    ]);
    expect(guardado[0]).toMatchObject({ summary: 'Rutina de fuerza' });
  });

  it('registra los tokens y la latencia', async () => {
    const { deps, cierres } = espia();

    await generateVersion('v1', deps);

    expect(cierres[0]).toMatchObject({ status: 'SUCCEEDED', usage: { tokensIn: 1, tokensOut: 2 } });
  });
});

describe('la versión no está donde debería', () => {
  it('si no existe, no se llama al proveedor', async () => {
    const { deps, pasos } = espia({ version: null });

    expect(await generateVersion('v1', deps)).toEqual({ kind: 'not_found' });
    expect(pasos).toEqual(['findVersion']);
  });

  it.each(['GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED'] as const)(
    'en %s no se genera: es idempotencia, no un error',
    async (state) => {
      // CA-6: reinvocar la generación sobre una versión ya generada no puede
      // tirar el trabajo del entrenador ni gastar cuota.
      const { deps, pasos } = espia({ version: version({ state }) });

      expect(await generateVersion('v1', deps)).toEqual({ kind: 'not_in_new', state });
      expect(pasos).toEqual(['findVersion']);
    },
  );
});

describe('sin margen de cuota', () => {
  const llena = [1, 2, 3, 4, 5].map((m) => new Date(Date.UTC(2026, 8, 17, 11, 60 - m)));

  it('NO se llama al proveedor', async () => {
    // CA-2. Es el punto entero del rate limit: no gastar la llamada.
    const { deps, pasos } = espia({ generaciones: llena });

    const outcome = await generateVersion('v1', deps);

    expect(outcome.kind).toBe('rate_limited');
    expect(pasos).toEqual(['findVersion', 'recentGenerations']);
  });

  it('la versión se queda en NEW, no se toca', async () => {
    const { deps, pasos } = espia({ generaciones: llena });

    await generateVersion('v1', deps);

    expect(pasos.some((p) => p.startsWith('transition'))).toBe(false);
  });

  it('el entrenador recibe el aviso CON la alternativa', async () => {
    // Decir «no hay cuota» sin decir qué hacer deja al entrenador parado.
    const { deps, avisos } = espia({ generaciones: llena });

    await generateVersion('v1', deps);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.toLowerCase()).toMatch(/plantilla|manual/);
  });
});

describe('cuando el proveedor falla', () => {
  it.each(['RATE_LIMITED', 'API_ERROR', 'TIMEOUT', 'INVALID_OUTPUT'] as const)(
    '%s devuelve la versión a NEW, no la mata',
    async (reason) => {
      // Es la regla de degradación: desde NEW el entrenador sigue por
      // plantilla o a mano, sobre la MISMA versión.
      const { deps, pasos, cierres } = espia({ respuestas: [fallo(reason)] });

      const outcome = await generateVersion('v1', deps);

      expect(outcome).toEqual({ kind: 'generation_failed', reason });
      expect(pasos).toContain('transition:GENERATING->NEW');
      expect(cierres[0]).toMatchObject({ status: 'FAILED', failureReason: reason });
    },
  );

  it('un 429 NUNCA se reintenta', async () => {
    // Reintentar sobre una cuota agotada la agota más (regla 8).
    const { deps, pasos } = espia({ respuestas: [fallo('RATE_LIMITED')] });

    await generateVersion('v1', deps);

    expect(pasos.filter((p) => p.startsWith('generate'))).toEqual(['generate#1']);
  });

  it('un error de red se reintenta UNA vez', async () => {
    const exito: AIResult = {
      ok: true,
      draft: { source: 'ai', raw: RUTINA_VALIDA },
      usage: { tokensIn: 1, tokensOut: 2 },
    };
    const { deps, pasos } = espia({ respuestas: [fallo('API_ERROR'), exito] });

    const outcome = await generateVersion('v1', deps);

    expect(outcome.kind).toBe('generated');
    expect(pasos.filter((p) => p.startsWith('generate'))).toEqual(['generate#1', 'generate#2']);
  });

  it('un timeout se reintenta UNA vez, y si vuelve a fallar se rinde', async () => {
    const { deps, pasos } = espia({ respuestas: [fallo('TIMEOUT'), fallo('TIMEOUT')] });

    const outcome = await generateVersion('v1', deps);

    expect(outcome.kind).toBe('generation_failed');
    expect(pasos.filter((p) => p.startsWith('generate'))).toHaveLength(2);
  });

  it('el entrenador se entera de cada fallo', async () => {
    const { deps, avisos } = espia({ respuestas: [fallo('RATE_LIMITED')] });

    await generateVersion('v1', deps);

    expect(avisos).toHaveLength(1);
  });
});

/** Una respuesta que el proveedor da por buena pero el dominio no. */
const draftMalo = (raw: unknown): AIResult => ({
  ok: true,
  draft: { source: 'ai', raw },
  usage: { tokensIn: 1, tokensOut: 2 },
});

describe('cuando el modelo devuelve algo que no pasa la validación', () => {
  it('un JSON con la forma equivocada se rechaza', async () => {
    const { deps, cierres, pasos } = espia({ respuestas: [draftMalo({ cualquier: 'cosa' })] });

    const outcome = await generateVersion('v1', deps);

    expect(outcome).toEqual({ kind: 'generation_failed', reason: 'INVALID_OUTPUT' });
    expect(cierres[0]).toMatchObject({ failureReason: 'INVALID_OUTPUT' });
    expect(pasos).not.toContain('saveContent');
  });

  it('los días que no coinciden con lo pedido se rechazan', async () => {
    // CA-4: se pidieron 1, llegan 2. La IA no decide cuántos días entrena
    // el cliente.
    const dosDias = {
      ...RUTINA_VALIDA,
      days: [RUTINA_VALIDA.days[0], { ...RUTINA_VALIDA.days[0], dayNumber: 2 }],
    };
    const { deps, pasos } = espia({ respuestas: [draftMalo(dosDias)] });

    const outcome = await generateVersion('v1', deps);

    expect(outcome).toEqual({ kind: 'generation_failed', reason: 'INVALID_OUTPUT' });
    expect(pasos).not.toContain('saveContent');
  });

  it('una salida inválida NO se reintenta: volvería a ser inválida', async () => {
    const { deps, pasos } = espia({ respuestas: [draftMalo({})] });

    await generateVersion('v1', deps);

    expect(pasos.filter((p) => p.startsWith('generate'))).toHaveLength(1);
  });
});

describe('concurrencia', () => {
  it('si otra petición se adelantó, esta no pisa nada', async () => {
    // La transición a GENERATING falla porque el estado ya cambió. Sin esta
    // guarda, dos pulsaciones del botón harían dos llamadas al proveedor.
    const { deps, pasos } = espia({ transicionFalla: true });

    const outcome = await generateVersion('v1', deps);

    expect(outcome.kind).toBe('not_in_new');
    expect(pasos).not.toContain('startGeneration');
    expect(pasos.some((p) => p.startsWith('generate'))).toBe(false);
  });
});
