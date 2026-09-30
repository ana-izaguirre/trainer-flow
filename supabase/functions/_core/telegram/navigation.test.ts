/**
 * SPEC-031 — navegación de la rutina: índice, por día, completa.
 *
 * ┌─ EL TEST QUE IMPORTA DE ESTE ARCHIVO ──────────────────────────────────┐
 * │ Ninguna llamada, en ningún caso, invoca `transition`. Navegar es de    │
 * │ solo lectura (regla 6): si algún día este archivo transiciona algo, es │
 * │ el bug más caro que puede tener — el mismo tipo que CLAUDE.md prohíbe  │
 * │ para `DRAFT → SENT`.                                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import type { VersionState } from '../domain/version.ts';
import type { ActionRepo, VersionForAction } from '../ports/action-ports.ts';
import { handleNavigation, type NavDeps, type NavRequest } from './navigation.ts';

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
const OTRO_CLIENTE: Identity = { ...CLIENTE, profileId: 'otro-cliente' };

const RUTINA = {
  summary: 'Fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press banca', sets: 4, reps: '8', restSeconds: 90, notes: null }],
    },
    {
      dayNumber: 2,
      focus: 'Tirón',
      exercises: [{ name: 'Remo', sets: 4, reps: '8', restSeconds: 90, notes: null }],
    },
  ],
  warnings: ['Se evitó press militar por la molestia de hombro'],
};

function version(state: VersionState, overrides: Partial<VersionForAction> = {}): VersionForAction {
  return {
    versionId: 'v1',
    state,
    client: { clientId: 'c1', trainerId: 'perfil-entrenador', profileId: 'perfil-cliente' },
    clientName: 'Ana-María Ruiz',
    versionNumber: 2,
    content: RUTINA,
    constraints: { daysPerWeek: 2, hasLimitations: false },
    plan: { goal: 'Fuerza', daysPerWeek: 2, sessionMinutes: 60 },
    ...overrides,
  };
}

interface Espia {
  readonly deps: NavDeps;
  readonly pasos: string[];
  readonly mensajes: string[];
  readonly teclados: (readonly (readonly { text: string; callback_data: string }[])[] | null)[];
}

function espia(opciones: { version?: VersionForAction | null } = {}): Espia {
  const pasos: string[] = [];
  const mensajes: string[] = [];
  const teclados: Espia['teclados'] = [];

  const repo: ActionRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(opciones.version === undefined ? version('SENT') : opciones.version);
    },
    // Nunca debería llamarse — ver el recuadro de arriba.
    transition: () => {
      pasos.push('transition');
      return Promise.resolve(true);
    },
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (_chatId, text, keyboard) => {
          pasos.push('sendMessage');
          mensajes.push(text);
          teclados.push(keyboard?.inline_keyboard ?? null);
          return Promise.resolve();
        },
        answerCallback: () => {
          pasos.push('answerCallback');
          return Promise.resolve();
        },
      },
    },
    pasos,
    mensajes,
    teclados,
  };
}

function req(view: NavRequest['view']): NavRequest {
  return { view, versionId: 'v1', callbackQueryId: 'cb-1' };
}

// ---------------------------------------------------------------------------

describe('en TODOS los casos, nunca se transiciona nada', () => {
  it.each<[string, Identity, NavRequest['view'], VersionForAction | null]>([
    ['índice, entrenador', TRAINER, { kind: 'index' }, version('SENT')],
    ['un día, cliente', CLIENTE, { kind: 'day', dayNumber: 1 }, version('SENT')],
    ['completa, cliente', CLIENTE, { kind: 'full' }, version('SENT')],
    ['no autorizado', OTRO_CLIENTE, { kind: 'index' }, version('SENT')],
    ['versión inexistente', TRAINER, { kind: 'index' }, null],
    ['sin contenido', TRAINER, { kind: 'index' }, version('NEW', { content: null })],
    ['día fuera de rango', TRAINER, { kind: 'day', dayNumber: 99 }, version('SENT')],
  ])('%s', async (_nombre, actor, view, versionFixture) => {
    const { deps, pasos } = espia({ version: versionFixture });
    await handleNavigation(req(view), actor, deps);
    expect(pasos).not.toContain('transition');
  });
});

describe('el botón se responde primero', () => {
  it('siempre, incluso si luego se deniega', async () => {
    const { deps, pasos } = espia({ version: null });
    await handleNavigation(req({ kind: 'index' }), CLIENTE, deps);
    expect(pasos[0]).toBe('answerCallback');
  });
});

describe('autorización — canViewVersion, no canModifyVersion', () => {
  it('una versión inexistente da la respuesta neutra', async () => {
    const { deps, mensajes, pasos } = espia({ version: null });

    const outcome = await handleNavigation(req({ kind: 'index' }), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'unauthorized' });
    expect(mensajes[0]).toContain('No puedo mostrarte eso');
    expect(pasos).not.toContain('transition');
  });

  it('un entrenador AJENO no puede navegarla', async () => {
    const { deps } = espia({ version: version('DRAFT') });
    const outcome = await handleNavigation(req({ kind: 'index' }), OTRO_ENTRENADOR, deps);
    expect(outcome).toEqual({ kind: 'unauthorized' });
  });

  it('el entrenador dueño puede navegarla en CUALQUIER estado', async () => {
    for (const state of ['NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED'] as const) {
      const { deps } = espia({ version: version(state, { content: state === 'NEW' ? null : RUTINA }) });
      const outcome = await handleNavigation(req({ kind: 'index' }), TRAINER, deps);
      if (state === 'NEW') {
        expect(outcome, state).toEqual({ kind: 'no_content' });
      } else {
        expect(outcome, state).toEqual({ kind: 'shown', view: { kind: 'index' } });
      }
    }
  });

  it('el cliente SOLO puede navegar su versión en SENT', async () => {
    for (const state of ['NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED'] as const) {
      const { deps } = espia({ version: version(state) });
      const outcome = await handleNavigation(req({ kind: 'index' }), CLIENTE, deps);
      if (state === 'SENT') {
        expect(outcome, state).toEqual({ kind: 'shown', view: { kind: 'index' } });
      } else {
        expect(outcome, state).toEqual({ kind: 'unauthorized' });
      }
    }
  });

  it('un cliente ajeno no ve la versión de otro, aunque esté SENT', async () => {
    const { deps } = espia({ version: version('SENT') });
    const outcome = await handleNavigation(req({ kind: 'index' }), OTRO_CLIENTE, deps);
    expect(outcome).toEqual({ kind: 'unauthorized' });
  });
});

describe('sin contenido', () => {
  it('una versión NEW no tiene nada que mostrar', async () => {
    const { deps, mensajes } = espia({ version: version('NEW', { content: null }) });

    const outcome = await handleNavigation(req({ kind: 'index' }), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'no_content' });
    expect(mensajes[0]).toContain('todavía no tiene contenido');
  });
});

describe('la vista de índice', () => {
  it('el entrenador ve título, resumen y días — sin ejercicios', async () => {
    const { deps, mensajes } = espia();

    await handleNavigation(req({ kind: 'index' }), TRAINER, deps);

    expect(mensajes[0]).toContain('Ana\\-María Ruiz');
    expect(mensajes[0]).toContain('📅 *Día 1 · Empuje*');
    expect(mensajes[0]).not.toContain('Press banca');
  });

  it('el cliente ve su saludo y los días — sin ejercicios ni warnings', async () => {
    const { deps, mensajes } = espia();

    await handleNavigation(req({ kind: 'index' }), CLIENTE, deps);

    expect(mensajes[0]).toContain('Hola');
    expect(mensajes[0]).toContain('📅 *Día 1 · Empuje*');
    expect(mensajes[0]).not.toContain('Press banca');
    expect(mensajes[0]).not.toContain('⚠️');
  });

  it('los botones de navegación son «Ver todo» y «Día 1»', async () => {
    const { deps, teclados } = espia();
    await handleNavigation(req({ kind: 'index' }), CLIENTE, deps);
    expect(teclados[0]![0]!.map((b) => b.text)).toEqual(['📖 Ver todo', '▶️ Día 1']);
  });
});

describe('la vista de un día', () => {
  it('trae SOLO ese día, igual para entrenador y cliente', async () => {
    const entrenador = espia();
    const cliente = espia();

    await handleNavigation(req({ kind: 'day', dayNumber: 2 }), TRAINER, entrenador.deps);
    await handleNavigation(req({ kind: 'day', dayNumber: 2 }), CLIENTE, cliente.deps);

    for (const { mensajes } of [entrenador, cliente]) {
      expect(mensajes[0]).toContain('📅 *Día 2 · Tirón*');
      expect(mensajes[0]).toContain('1\\. Remo');
      expect(mensajes[0]).not.toContain('Empuje');
      expect(mensajes[0]).not.toContain('Press banca');
    }
  });

  it('un día fuera de rango cae al índice, sin error', async () => {
    const { deps, mensajes } = espia();

    const outcome = await handleNavigation(req({ kind: 'day', dayNumber: 99 }), TRAINER, deps);

    expect(outcome).toEqual({ kind: 'shown', view: { kind: 'index' } });
    expect(mensajes[0]).toContain('📅 *Día 1 · Empuje*');
    expect(mensajes[0]).toContain('📅 *Día 2 · Tirón*');
  });

  it('el primer día no ofrece «anterior»; el último no ofrece «siguiente»', async () => {
    const primero = espia();
    const ultimo = espia();

    await handleNavigation(req({ kind: 'day', dayNumber: 1 }), CLIENTE, primero.deps);
    await handleNavigation(req({ kind: 'day', dayNumber: 2 }), CLIENTE, ultimo.deps);

    expect(primero.teclados[0]![0]!.map((b) => b.text)).toEqual(['📋 Índice', 'Día 2 ▶️']);
    expect(ultimo.teclados[0]![0]!.map((b) => b.text)).toEqual(['◀️ Día 1', '📋 Índice']);
  });
});

describe('la vista completa', () => {
  it('el entrenador ve las advertencias', async () => {
    const { deps, mensajes } = espia();
    await handleNavigation(req({ kind: 'full' }), TRAINER, deps);
    expect(mensajes[0]).toContain('⚠️ *Tenido en cuenta*');
    expect(mensajes[0]).toContain('hombro');
  });

  it('el cliente NUNCA ve las advertencias', async () => {
    const { deps, mensajes } = espia();
    await handleNavigation(req({ kind: 'full' }), CLIENTE, deps);
    expect(mensajes[0]).not.toContain('⚠️');
    expect(mensajes[0]).not.toContain('hombro');
  });

  it('trae todos los días con sus ejercicios', async () => {
    const { deps, mensajes } = espia();
    await handleNavigation(req({ kind: 'full' }), CLIENTE, deps);
    expect(mensajes[0]).toContain('Press banca');
    expect(mensajes[0]).toContain('Remo');
  });

  it('el botón de navegación es solo «Índice»', async () => {
    const { deps, teclados } = espia();
    await handleNavigation(req({ kind: 'full' }), CLIENTE, deps);
    expect(teclados[0]![0]!.map((b) => b.text)).toEqual(['📋 Índice']);
  });
});

describe('la fila de decisión, según rol y estado', () => {
  it('el cliente siempre ve «Me sirve» y «Pedir un cambio»', async () => {
    const { deps, teclados } = espia();
    await handleNavigation(req({ kind: 'index' }), CLIENTE, deps);
    expect(teclados[0]![1]!.map((b) => b.text)).toEqual(['👍 Me sirve', '✏️ Pedir un cambio']);
  });

  it('el entrenador ve las acciones que le tocan según el ESTADO (DRAFT)', async () => {
    const { deps, teclados } = espia({ version: version('DRAFT') });
    await handleNavigation(req({ kind: 'index' }), TRAINER, deps);
    // Mismo orden que `actionsForState('DRAFT')`: aprobar, rechazar, ver
    // evaluación — «editar» no está en NINGÚN estado (docs/STATE-MACHINE.md,
    // «Por qué ningún estado ofrece “Editar”»).
    expect(teclados[0]![1]!.map((b) => b.text)).toEqual(['✅ Aprobar', '❌ Rechazar', '📄 Ver evaluación']);
  });

  it('la fila de decisión va en las TRES vistas, no solo en una', async () => {
    const index = espia();
    const dia = espia();
    const completa = espia();

    await handleNavigation(req({ kind: 'index' }), CLIENTE, index.deps);
    await handleNavigation(req({ kind: 'day', dayNumber: 1 }), CLIENTE, dia.deps);
    await handleNavigation(req({ kind: 'full' }), CLIENTE, completa.deps);

    for (const { teclados } of [index, dia, completa]) {
      expect(teclados[0]).toHaveLength(2);
      expect(teclados[0]![1]!.map((b) => b.text)).toEqual(['👍 Me sirve', '✏️ Pedir un cambio']);
    }
  });
});

describe('SPEC-031 — un nombre con guion sale ESCAPADO, no suelto', () => {
  // Aserción puntual, no un guardián genérico: estos mensajes llevan
  // `*negrita*` a propósito (títulos, nombres de ejercicio), y un detector
  // que revienta en cualquier carácter especial da falsos positivos ahí —
  // ya le pasó a `delivery.test.ts` (ver su propio comentario de cabecera).
  it('el índice del entrenador escapa el nombre del cliente', async () => {
    const { deps, mensajes } = espia();
    await handleNavigation(req({ kind: 'index' }), TRAINER, deps);
    expect(mensajes[0]).toContain('Ana\\-María Ruiz');
    expect(mensajes[0]).not.toContain('Ana-María Ruiz');
  });

  it('la vista completa del entrenador también', async () => {
    const { deps, mensajes } = espia();
    await handleNavigation(req({ kind: 'full' }), TRAINER, deps);
    expect(mensajes[0]).toContain('Ana\\-María Ruiz');
    expect(mensajes[0]).not.toContain('Ana-María Ruiz');
  });
});
