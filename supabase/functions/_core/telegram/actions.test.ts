/**
 * SPEC-004 — Qué pasa al pulsar un botón.
 *
 * ┌─ AQUÍ ES DONDE EL PRINCIPIO SE HACE CUMPLIR ───────────────────────────┐
 * │ «La IA propone, el entrenador decide» no es una frase del README: es   │
 * │ esta comprobación de autorización y esta máquina de estados. Si        │
 * │ cualquiera de las dos cede, el principio deja de existir.              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUÉ `espia()` REVIENTA EN CUALQUIER MENSAJE SIN ESCAPAR ──────────┐
 * │ Este archivo pasó meses en producción mandando `Rutina aprobada para   │
 * │ Carlos.` con el punto sin escapar — MarkdownV2 rechaza el mensaje      │
 * │ ENTERO, así que aprobar y rechazar no decían nada, aunque la           │
 * │ transición de estado sí se aplicaba. Cada test de este archivo ya      │
 * │ ejercitaba esos caminos; ninguno miraba la forma del texto. Ahora sí.  │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
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

function version(
  state: VersionState = 'DRAFT',
  overrides: Partial<VersionForAction> = {},
): VersionForAction {
  return {
    versionId: 'v1',
    state,
    client: { clientId: 'c1', trainerId: 'perfil-entrenador', profileId: null },
    // Con guion: si `clientName` se interpola sin `escapeMarkdownV2`, un
    // nombre real de Tally (compuestos, apellidos con guion) rompe el
    // mensaje entero. Un nombre "limpio" como «Carlos» no lo habría pillado.
    clientName: 'Ana-María Ruiz',
    versionNumber: 1,
    content: RUTINA,
    // La rutina de prueba tiene un día; los criterios encajan para que los
    // tests de aprobar midan la autorización, no la validación.
    constraints: { daysPerWeek: 1, hasLimitations: false },
    plan: { goal: 'Fuerza', daysPerWeek: 1, sessionMinutes: 60 },
    editCount: 0,
    ...overrides,
  };
}

interface Espia {
  readonly deps: ActionDeps;
  readonly pasos: string[];
  readonly mensajes: string[];
  /** El `callback_data` de cada botón, por mensaje. */
  readonly botones: string[][];
}

function espia(
  opciones: {
    version?: VersionForAction | null;
    transicionFalla?: boolean;
    disparoFalla?: boolean;
    startEditWaitFalla?: boolean;
  } = {},
): Espia {
  const pasos: string[] = [];
  const mensajes: string[] = [];
  const botones: string[][] = [];

  const repo: ActionRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(opciones.version === undefined ? version() : opciones.version);
    },
    transition: (_v, from, to) => {
      pasos.push(`transition:${from}->${to}`);
      return Promise.resolve(!(opciones.transicionFalla ?? false));
    },
    startEditWait: () => {
      pasos.push('startEditWait');
      return Promise.resolve(!(opciones.startEditWaitFalla ?? false));
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
        sendMessage: (chatId, text, keyboard) => {
          botones.push(keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? []);
          // Si esto revienta, Telegram habría hecho lo mismo con el mensaje
          // real: rechazarlo entero y dejar al entrenador sin respuesta.
          if (tieneCaracterSinEscapar(text)) {
            throw new Error(`mensaje sin escapar para MarkdownV2: ${text}`);
          }
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
    botones,
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

  // SPEC-022 M3. «Puedes empezar otra» no decía cómo, y volver a escribir
  // /crear_rutina tampoco servía: la rechazada ya no es un borrador.
  it('CA-M3 · el mensaje lleva ✏️ Crear v2 sobre la versión rechazada', async () => {
    const { deps, mensajes, botones } = espia();

    await handleAction(pulsar('reject'), TRAINER, deps);

    expect(botones.at(-1)).toEqual(['act:revise:v1']);
    expect(mensajes.at(-1)).toContain('Crear v2');
    // El nombre con guion: el espía ya revienta si no va escapado (CA-M6).
    expect(mensajes.at(-1)).toContain('Ana\\-María Ruiz');
  });

  it('aprobar NO lleva ese botón: la versión sigue su camino', async () => {
    const { deps, botones } = espia();

    await handleAction(pulsar('approve'), TRAINER, deps);

    expect(botones.flat()).not.toContain('act:revise:v1');
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
  it.each(['template', 'manual'] as const)('%s se responde sin fingir', async (accion) => {
    // Un botón que no hace nada y no lo dice es peor que uno que no existe.
    // (En producción, `template`/`manual` los enruta el webhook a otro
    // flujo antes de llegar aquí — esto es la red de seguridad si algún día
    // dejaran de hacerlo.)
    const { deps, mensajes } = espia();

    const outcome = await handleAction(pulsar(accion), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'not_implemented', action: accion });
    expect(mensajes).toHaveLength(1);
  });
});

describe('«✏️ Editar» — SPEC-004', () => {
  it('sobre un DRAFT con margen, prende la espera y pregunta qué cambiar', async () => {
    const { deps, pasos, mensajes } = espia({ version: version('DRAFT') });

    const outcome = await handleAction(pulsar('edit'), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'editing', versionId: 'v1' });
    expect(pasos).toContain('startEditWait');
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toContain('María Ruiz');
    expect(mensajes[0]).not.toContain('/ver');
  });

  it('sin evaluación de Tally (plantilla o manual), sigue mandando al editor de siempre', async () => {
    const { deps, pasos, mensajes } = espia({
      version: version('DRAFT', { constraints: null }),
    });

    const outcome = await handleAction(pulsar('edit'), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'not_implemented', action: 'edit' });
    expect(pasos).not.toContain('startEditWait');
    expect(mensajes[0]).toContain('/ver');
  });

  it('con 5 ediciones ya hechas, NO prende la espera: sugiere rechazar y regenerar', async () => {
    const { deps, pasos, mensajes } = espia({
      version: version('DRAFT', { editCount: 5 }),
    });

    const outcome = await handleAction(pulsar('edit'), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'invalid_action', state: 'DRAFT', action: 'edit' });
    expect(pasos).not.toContain('startEditWait');
    expect(mensajes[0]?.toLowerCase()).toMatch(/rech/);
  });

  it.each(['NEW', 'GENERATING', 'APPROVED', 'SENT', 'REJECTED'] as const)(
    'sobre un botón viejo — la rutina ya está en %s — dice en qué está, no prende nada',
    async (estado) => {
      const { deps, pasos, mensajes } = espia({ version: version(estado) });

      const outcome = await handleAction(pulsar('edit'), TRAINER, deps);

      expect(outcome).toEqual({ kind: 'invalid_action', state: estado, action: 'edit' });
      expect(pasos).not.toContain('startEditWait');
      expect(mensajes[0]).not.toContain('/ver');
    },
  );

  it('si alguien se adelantó (ya no está en DRAFT al prender la espera), no finge que preguntó', async () => {
    const { deps, mensajes } = espia({
      version: version('DRAFT'),
      startEditWaitFalla: true,
    });

    const outcome = await handleAction(pulsar('edit'), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'already_processed' });
    expect(mensajes[0]).toContain('ya fue procesada');
  });

  it('no transiciona nada: seguir en DRAFT tras "editar" no es un evento de la máquina', async () => {
    const { deps, pasos } = espia({ version: version('DRAFT') });

    await handleAction(pulsar('edit'), TRAINER, deps);

    expect(pasos.some((p) => p.startsWith('transition:'))).toBe(false);
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


// ---------------------------------------------------------------------------

describe('🔴 aprobar valida: la última puerta antes de que salga', () => {
  const VACIA = { summary: 'En preparación', days: [], warnings: [] };

  it('CA-16 · una rutina vacía NO se aprueba', async () => {
    // Antes sí se podía: solo `generate-version` llamaba a `validateDraft`,
    // así que una hecha a mano llegaba al cliente sin pasar nunca por ahí.
    const { deps, pasos, mensajes } = espia({
      version: { ...version('DRAFT'), content: VACIA },
    });

    const outcome = await handleAction(pulsar('approve'), TRAINER, deps);

    expect(outcome).toMatchObject({ kind: 'invalid_action', action: 'approve' });
    expect(pasos.some((p) => p.includes('->APPROVED'))).toBe(false);
    expect(mensajes.at(-1)).toContain('No puedo aprobarla');
  });

  it('un día sin ejercicios tampoco', async () => {
    const { deps, pasos } = espia({
      version: {
        ...version('DRAFT'),
        content: { summary: 'x', days: [{ dayNumber: 1, focus: 'Empuje', exercises: [] }], warnings: [] },
      },
    });

    await handleAction(pulsar('approve'), TRAINER, deps);

    expect(pasos.some((p) => p.includes('->APPROVED'))).toBe(false);
  });

  it('una versión sin contenido tampoco', async () => {
    const { deps, pasos } = espia({ version: { ...version('DRAFT'), content: null } });

    await handleAction(pulsar('approve'), TRAINER, deps);

    expect(pasos.some((p) => p.includes('->APPROVED'))).toBe(false);
  });

  it('si no cuadra con los días que pidió el cliente, no se aprueba', async () => {
    const { deps, pasos, mensajes } = espia({
      version: {
        ...version('DRAFT'),
        constraints: { daysPerWeek: 4, hasLimitations: false },
      },
    });

    await handleAction(pulsar('approve'), TRAINER, deps);

    expect(pasos.some((p) => p.includes('->APPROVED'))).toBe(false);
    // Dice QUÉ falla, no «no puedo» a secas.
    expect(mensajes.at(-1)).toContain('4');
  });

  it('sin evaluación se valida la forma, y una rutina buena SÍ se aprueba', async () => {
    // Una manual no tiene formulario detrás: no hay criterios contra los que
    // comparar, pero la forma se exige igual.
    const { deps, pasos } = espia({ version: { ...version('DRAFT'), constraints: null } });

    const outcome = await handleAction(pulsar('approve'), TRAINER, deps);

    expect(outcome).toMatchObject({ kind: 'approved' });
    expect(pasos).toContain('transition:DRAFT->APPROVED');
  });

  it('rechazar NO valida: se rechaza justamente lo que no vale', async () => {
    const { deps, pasos } = espia({ version: { ...version('DRAFT'), content: VACIA } });

    const outcome = await handleAction(pulsar('reject'), TRAINER, deps);

    expect(outcome).toMatchObject({ kind: 'rejected' });
    expect(pasos).toContain('transition:DRAFT->REJECTED');
  });
});
