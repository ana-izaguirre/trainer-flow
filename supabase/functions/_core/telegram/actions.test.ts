/**
 * SPEC-004 — Qué pasa al pulsar un botón.
 *
 * ┌─ AQUÍ ES DONDE EL PRINCIPIO SE HACE CUMPLIR ───────────────────────────┐
 * │ «La IA propone, el entrenador decide» no es una frase del README: es   │
 * │ esta comprobación de autorización y esta máquina de estados. Si        │
 * │ cualquiera de las dos cede, el principio deja de existir.              │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import type { VersionState } from '../domain/version.ts';
import type { ActionRepo, VersionForAction } from '../ports/action-ports.ts';
import { handleAction, type ActionDeps } from './actions.ts';

const TRAINER: Identity = {
  profileId: 'perfil-entrenador',
  role: 'trainer',
  telegramUserId: 10,
  telegramChatId: 10,
};

const OTRO_ENTRENADOR: Identity = { ...TRAINER, profileId: 'otro-perfil' };
const CLIENTE: Identity = { ...TRAINER, profileId: 'perfil-cliente', role: 'client' };

const RUTINA = {
  summary: 'Fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press', sets: 4, reps: '8', restSeconds: 120, notes: null }],
    },
  ],
  warnings: [],
};

function version(state: VersionState = 'DRAFT'): VersionForAction {
  return {
    versionId: 'v1',
    state,
    client: { clientId: 'c1', trainerId: 'perfil-entrenador', profileId: null },
    clientName: 'Carlos',
    versionNumber: 1,
    content: RUTINA,
  };
}

interface Espia {
  readonly deps: ActionDeps;
  readonly pasos: string[];
  readonly mensajes: string[];
}

function espia(
  opciones: {
    version?: VersionForAction | null;
    transicionFalla?: boolean;
    disparoFalla?: boolean;
  } = {},
): Espia {
  const pasos: string[] = [];
  const mensajes: string[] = [];

  const repo: ActionRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(opciones.version === undefined ? version() : opciones.version);
    },
    transition: (_v, from, to) => {
      pasos.push(`transition:${from}->${to}`);
      return Promise.resolve(!(opciones.transicionFalla ?? false));
    },
  };

  const generation = {
    trigger: (versionId: string) => {
      pasos.push(`trigger:${versionId}`);
      return opciones.disparoFalla === true
        ? Promise.reject(new Error('la función no responde'))
        : Promise.resolve();
    },
  };

  return {
    deps: {
      repo,
      generation,
      requestId: 'req-1',
      sender: {
        sendMessage: (chatId, text) => {
          mensajes.push(`${chatId}:${text}`);
          return Promise.resolve();
        },
        answerCallback: (id) => {
          pasos.push(`answerCallback:${id}`);
          return Promise.resolve();
        },
      },
    },
    pasos,
    mensajes,
  };
}

const pulsar = (accion: 'approve' | 'reject' | 'edit' | 'template' | 'manual') => ({
  action: accion,
  versionId: 'v1',
  callbackQueryId: 'cb-1',
});

// ---------------------------------------------------------------------------

describe('el botón se responde SIEMPRE, y lo primero', () => {
  it.each(['approve', 'reject', 'edit'] as const)(
    'con %s, `answerCallback` es el primer paso',
    async (accion) => {
      // CA-5. Telegram deja el botón girando si se tarda más de unos segundos,
      // y el entrenador vuelve a pulsar.
      const { deps, pasos } = espia();

      await handleAction(pulsar(accion), TRAINER, deps);

      expect(pasos[0]).toBe('answerCallback:cb-1');
    },
  );

  it('también cuando la acción se rechaza', async () => {
    const { deps, pasos } = espia();

    await handleAction(pulsar('approve'), CLIENTE, deps);

    expect(pasos[0]).toBe('answerCallback:cb-1');
  });
});

describe('solo el entrenador dueño', () => {
  it('un cliente no puede aprobar', async () => {
    // CA-4. Aquí es donde el principio del producto se hace cumplir.
    const { deps, pasos } = espia();

    const outcome = await handleAction(pulsar('approve'), CLIENTE, deps);

    expect(outcome.kind).toBe('unauthorized');
    expect(pasos.some((p) => p.startsWith('transition'))).toBe(false);
  });

  it('otro entrenador tampoco', async () => {
    const { deps, pasos } = espia();

    const outcome = await handleAction(pulsar('approve'), OTRO_ENTRENADOR, deps);

    expect(outcome.kind).toBe('unauthorized');
    expect(pasos.some((p) => p.startsWith('transition'))).toBe(false);
  });

  it('el rechazo no dice si la versión existe', async () => {
    // Denegado y no-existe dan la misma respuesta: no se pueden enumerar
    // versiones ajenas probando IDs.
    const { deps, mensajes } = espia();
    const conVersion = await handleAction(pulsar('approve'), CLIENTE, deps);

    const sinVersion = espia({ version: null });
    const outcome2 = await handleAction(pulsar('approve'), CLIENTE, sinVersion.deps);

    expect(conVersion.kind).toBe('unauthorized');
    expect(outcome2.kind).toBe('unauthorized');
    expect(mensajes[0]).toBe(sinVersion.mensajes[0]);
  });
});

describe('aprobar', () => {
  it('DRAFT → APPROVED', async () => {
    // CA-1.
    const { deps, pasos } = espia();

    const outcome = await handleAction(pulsar('approve'), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'approved', versionId: 'v1' });
    expect(pasos).toContain('transition:DRAFT->APPROVED');
  });

  it('el entrenador ve que quedó aprobada', async () => {
    const { deps, mensajes } = espia();

    await handleAction(pulsar('approve'), TRAINER, deps);

    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]?.toLowerCase()).toContain('aprobada');
  });
});

describe('rechazar', () => {
  it('DRAFT → REJECTED', async () => {
    const { deps, pasos } = espia();

    const outcome = await handleAction(pulsar('reject'), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'rejected', versionId: 'v1' });
    expect(pasos).toContain('transition:DRAFT->REJECTED');
  });
});

describe('la máquina de estados manda', () => {
  it.each([
    ['APPROVED', 'approve'],
    ['SENT', 'approve'],
    ['REJECTED', 'approve'],
    ['REJECTED', 'reject'],
    ['NEW', 'approve'],
  ] as const)('desde %s no se puede %s', async (state, accion) => {
    // CA-7 y CA-8. Lo que decide qué es legal es `nextState`, no una lista
    // de `if` escrita aquí que pueda divergir de ella.
    const { deps, pasos } = espia({ version: version(state) });

    const outcome = await handleAction(pulsar(accion), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'invalid_action', state, action: accion });
    expect(pasos.some((p) => p.startsWith('transition'))).toBe(false);
  });

  it('el mensaje dice en qué estado está, no solo que no se puede', async () => {
    const { deps, mensajes } = espia({ version: version('SENT') });

    await handleAction(pulsar('approve'), TRAINER, deps);

    expect(mensajes[0]?.toLowerCase()).toMatch(/enviada|sent/);
  });
});

describe('la doble pulsación', () => {
  it('la segunda no cambia nada', async () => {
    // CA-2. La transición falla porque el estado ya no es el esperado: esa es
    // la guarda, no una comprobación previa que dos peticiones simultáneas
    // pasarían las dos.
    const { deps, mensajes } = espia({ transicionFalla: true });

    const outcome = await handleAction(pulsar('approve'), TRAINER, deps);

    expect(outcome.kind).toBe('already_processed');
    expect(mensajes[0]?.toLowerCase()).toContain('ya');
  });
});

describe('lo que todavía no está', () => {
  it.each(['edit', 'template', 'manual'] as const)('%s se responde sin fingir', async (accion) => {
    // Un botón que no hace nada y no lo dice es peor que uno que no existe.
    const { deps, mensajes } = espia();

    const outcome = await handleAction(pulsar(accion), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'not_implemented', action: accion });
    expect(mensajes).toHaveLength(1);
  });
});

describe('una versión que no existe', () => {
  it('no revienta', async () => {
    const { deps } = espia({ version: null });

    const outcome = await handleAction(pulsar('approve'), TRAINER, deps);

    expect(outcome.kind).toBe('unauthorized');
  });
});


// ---------------------------------------------------------------------------

describe('🤖 el botón de generar', () => {
  it('dispara la generación y avisa al entrenador', async () => {
    const { deps, pasos, mensajes } = espia({ version: version('NEW') });

    const outcome = await handleAction(
      { action: 'generate', versionId: 'v1', callbackQueryId: 'cb-1' },
      TRAINER,
      deps,
    );

    expect(outcome).toEqual({ kind: 'generating', versionId: 'v1' });
    expect(pasos).toContain('trigger:v1');
    expect(mensajes.some((m) => m.includes('Generando'))).toBe(true);
  });

  it('🔴 NO transiciona: eso lo hace `generate-version`', async () => {
    // Si transicionara aquí, la propia función se encontraría GENERATING y se
    // negaría a trabajar. El botón no haría nada.
    const { deps, pasos } = espia({ version: version('NEW') });

    await handleAction(
      { action: 'generate', versionId: 'v1', callbackQueryId: 'cb-1' },
      TRAINER,
      deps,
    );

    expect(pasos.some((p) => p.startsWith('transition'))).toBe(false);
  });

  it('avisa ANTES de disparar', async () => {
    // Generar tarda; un botón que no responde invita a volver a pulsarlo.
    const { deps, pasos, mensajes } = espia({ version: version('NEW') });

    await handleAction(
      { action: 'generate', versionId: 'v1', callbackQueryId: 'cb-1' },
      TRAINER,
      deps,
    );

    expect(mensajes[0]).toContain('Generando');
    expect(pasos.indexOf('trigger:v1')).toBeGreaterThan(-1);
  });

  it.each(['GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED'] as const)(
    'desde %s no se genera, y se dice por qué',
    async (state) => {
      const { deps, pasos, mensajes } = espia({ version: version(state) });

      const outcome = await handleAction(
        { action: 'generate', versionId: 'v1', callbackQueryId: 'cb-1' },
        TRAINER,
        deps,
      );

      expect(outcome).toMatchObject({ kind: 'invalid_action', state, action: 'generate' });
      expect(pasos).not.toContain('trigger:v1');
      // No un «no puedo» a secas: dice en qué estado está.
      expect(mensajes.at(-1)?.length).toBeGreaterThan(20);
    },
  );

  it('si el disparo falla, la versión sigue en NEW y se ofrece salida', async () => {
    const { deps, mensajes } = espia({ version: version('NEW'), disparoFalla: true });

    const outcome = await handleAction(
      { action: 'generate', versionId: 'v1', callbackQueryId: 'cb-1' },
      TRAINER,
      deps,
    );

    expect(outcome).toMatchObject({ kind: 'invalid_action' });
    expect(mensajes.at(-1)).toContain('plantilla');
  });

  it('una versión ajena no se genera', async () => {
    // El `callback_data` lo fabrica cualquiera: lo que lo detiene es la
    // pertenencia, igual que para aprobar.
    const { deps, pasos } = espia({ version: version('NEW') });

    const outcome = await handleAction(
      { action: 'generate', versionId: 'v1', callbackQueryId: 'cb-1' },
      OTRO_ENTRENADOR,
      deps,
    );

    expect(outcome).toEqual({ kind: 'unauthorized' });
    expect(pasos).not.toContain('trigger:v1');
  });
});
