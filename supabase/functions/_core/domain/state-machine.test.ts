/**
 * Máquina de estados de una versión.
 *
 * La especificación es `docs/STATE-MACHINE.md`: estos tests copian su tabla
 * literalmente. Si la tabla y estos tests discrepan, la tabla manda.
 *
 * ┌─ POR QUÉ ESTE MÓDULO IMPORTA ───────────────────────────────────────────┐
 * │ Es lo que hace imposible que una rutina llegue al cliente sin que el    │
 * │ entrenador la apruebe. No por convención: la transición DRAFT → SENT    │
 * │ simplemente no existe. Cobertura del 100%, inválidas incluidas.        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { VersionState } from './version.ts';
import { VERSION_STATES } from './version.ts';
import type { VersionEvent } from './state-machine.ts';
import {
  VERSION_EVENTS,
  allowedEvents,
  isTerminal,
  nextState,
} from './state-machine.ts';

/** La tabla de docs/STATE-MACHINE.md, copiada tal cual. */
const TABLA_VALIDA: ReadonlyArray<readonly [VersionState, VersionEvent, VersionState]> = [
  ['NEW', 'GENERATE', 'GENERATING'],
  ['NEW', 'LOAD_TEMPLATE', 'DRAFT'],
  ['NEW', 'CREATE_MANUAL', 'DRAFT'],
  ['NEW', 'REJECT', 'REJECTED'],
  ['GENERATING', 'GENERATION_SUCCEEDED', 'DRAFT'],
  ['GENERATING', 'GENERATION_FAILED', 'NEW'],
  ['DRAFT', 'EDIT', 'DRAFT'],
  ['DRAFT', 'APPROVE', 'APPROVED'],
  ['DRAFT', 'REJECT', 'REJECTED'],
  ['APPROVED', 'SEND', 'SENT'],
  ['APPROVED', 'REJECT', 'REJECTED'],
];

describe('las 11 transiciones válidas', () => {
  it.each(TABLA_VALIDA)('%s + %s → %s', (from, event, expected) => {
    expect(nextState(from, event)).toBe(expected);
  });

  it('son exactamente 11, ni una más', () => {
    const total = VERSION_STATES.flatMap((from) =>
      VERSION_EVENTS.filter((event) => nextState(from, event) !== null),
    );

    expect(total).toHaveLength(TABLA_VALIDA.length);
  });
});

describe('todas las combinaciones inválidas se rechazan', () => {
  const validas = new Set(TABLA_VALIDA.map(([from, event]) => `${from}+${event}`));

  // 6 estados × 9 eventos = 54 combinaciones. 11 válidas, 43 inválidas.
  const invalidas = VERSION_STATES.flatMap((from) =>
    VERSION_EVENTS
      .filter((event) => !validas.has(`${from}+${event}`))
      .map((event) => [from, event] as const),
  );

  it('hay 43 combinaciones inválidas que cubrir', () => {
    expect(invalidas).toHaveLength(43);
  });

  it.each(invalidas)('%s + %s → null', (from, event) => {
    expect(nextState(from, event)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('🔴 el principio de producto, como test', () => {
  it('DRAFT → SENT NO EXISTE por ningún evento', () => {
    for (const event of VERSION_EVENTS) {
      expect(nextState('DRAFT', event), `DRAFT + ${event}`).not.toBe('SENT');
    }
  });

  it('el ÚNICO camino a SENT sale de APPROVED', () => {
    const caminos = VERSION_STATES.flatMap((from) =>
      VERSION_EVENTS
        .filter((event) => nextState(from, event) === 'SENT')
        .map((event) => [from, event]),
    );

    expect(caminos).toEqual([['APPROVED', 'SEND']]);
  });

  it('a APPROVED solo se llega desde DRAFT, con una decisión del entrenador', () => {
    const caminos = VERSION_STATES.flatMap((from) =>
      VERSION_EVENTS
        .filter((event) => nextState(from, event) === 'APPROVED')
        .map((event) => [from, event]),
    );

    expect(caminos).toEqual([['DRAFT', 'APPROVE']]);
  });

  it('la IA no puede llevar una versión más allá de DRAFT', () => {
    // GENERATION_SUCCEEDED es el único evento que dispara la IA al terminar.
    for (const from of VERSION_STATES) {
      const destino = nextState(from, 'GENERATION_SUCCEEDED');
      expect(destino === null || destino === 'DRAFT', `${from}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('estados terminales', () => {
  it('SENT y REJECTED son terminales', () => {
    expect(isTerminal('SENT')).toBe(true);
    expect(isTerminal('REJECTED')).toBe(true);
  });

  it('los demás no lo son', () => {
    for (const state of ['NEW', 'GENERATING', 'DRAFT', 'APPROVED'] as const) {
      expect(isTerminal(state), state).toBe(false);
    }
  });

  it('un estado terminal no acepta ningún evento', () => {
    for (const state of VERSION_STATES.filter(isTerminal)) {
      for (const event of VERSION_EVENTS) {
        expect(nextState(state, event), `${state} + ${event}`).toBeNull();
      }
    }
  });

  it('terminal es exactamente lo mismo que no tener eventos posibles', () => {
    for (const state of VERSION_STATES) {
      expect(isTerminal(state), state).toBe(allowedEvents(state).length === 0);
    }
  });
});

// ---------------------------------------------------------------------------

describe('allowedEvents', () => {
  it('devuelve los eventos de cada estado, según la tabla', () => {
    // Los esperados van en orden alfabético, igual que `toSorted()`.
    expect(allowedEvents('NEW').toSorted()).toEqual([
      'CREATE_MANUAL',
      'GENERATE',
      'LOAD_TEMPLATE',
      'REJECT',
    ]);
    expect(allowedEvents('GENERATING').toSorted()).toEqual([
      'GENERATION_FAILED',
      'GENERATION_SUCCEEDED',
    ]);
    expect(allowedEvents('DRAFT').toSorted()).toEqual(['APPROVE', 'EDIT', 'REJECT']);
    expect(allowedEvents('APPROVED').toSorted()).toEqual(['REJECT', 'SEND']);
    expect(allowedEvents('SENT')).toEqual([]);
    expect(allowedEvents('REJECTED')).toEqual([]);
  });

  it('coincide siempre con nextState', () => {
    for (const from of VERSION_STATES) {
      for (const event of VERSION_EVENTS) {
        expect(allowedEvents(from).includes(event), `${from} + ${event}`).toBe(
          nextState(from, event) !== null,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('la edición no mueve el estado', () => {
  it('EDIT deja la versión en DRAFT', () => {
    // Editar un borrador lo modifica in-place: no crea versión ni cambia etapa.
    expect(nextState('DRAFT', 'EDIT')).toBe('DRAFT');
  });

  it('no se puede editar nada que no sea un borrador', () => {
    for (const state of VERSION_STATES.filter((s) => s !== 'DRAFT')) {
      expect(nextState(state, 'EDIT'), state).toBeNull();
    }
  });
});

describe('el fallo de la IA devuelve la versión a NEW', () => {
  it('GENERATING + GENERATION_FAILED → NEW, no a un estado muerto', () => {
    // Así el entrenador continúa por plantilla o manual sobre la misma versión.
    expect(nextState('GENERATING', 'GENERATION_FAILED')).toBe('NEW');
  });

  it('desde NEW se puede seguir sin IA', () => {
    expect(nextState('NEW', 'LOAD_TEMPLATE')).toBe('DRAFT');
    expect(nextState('NEW', 'CREATE_MANUAL')).toBe('DRAFT');
  });
});
