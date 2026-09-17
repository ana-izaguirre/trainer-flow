/**
 * SPEC-005 regla 5 — Lo que el cliente recibe, y lo que NO.
 *
 * ┌─ EL TEST QUE IMPORTA DE ESTE ARCHIVO ──────────────────────────────────┐
 * │ `warnings` NO llega al cliente. Esos avisos describen su limitación y  │
 * │ existen para que el ENTRENADOR vea qué se tuvo en cuenta.              │
 * │                                                                        │
 * │ El cliente ya sabe lo que tiene: no necesita que su rutina se lo       │
 * │ recuerde por escrito en un chat que puede leer cualquiera que le coja  │
 * │ el móvil. Recibe los ejercicios YA adaptados.                          │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { Workout } from '../domain/workout.ts';
import { formatForClient } from './client-format.ts';

const RUTINA: Workout = {
  summary: 'Cuatro días de fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [
        { name: 'Press banca', sets: 4, reps: '8', restSeconds: 120, notes: 'Baja controlado' },
        { name: 'Fondos', sets: 3, reps: '10', restSeconds: 90, notes: null },
      ],
    },
    {
      dayNumber: 2,
      focus: 'Tirón',
      exercises: [{ name: 'Remo', sets: 4, reps: '8', restSeconds: 120, notes: null }],
    },
  ],
  warnings: ['Se evitó press militar por la molestia de hombro derecho'],
};

const PLAN = { goal: 'Ganancia muscular', daysPerWeek: 4, sessionMinutes: 60 };
const CONTEXTO = { clientName: 'Carlos', plan: PLAN };

// ---------------------------------------------------------------------------

describe('lo que NO llega al cliente', () => {
  it('los `warnings` se omiten', () => {
    // Describen su limitación. El cliente ya sabe lo que tiene.
    const texto = formatForClient(RUTINA, CONTEXTO);

    expect(texto).not.toContain('hombro');
    expect(texto).not.toContain('molestia');
    expect(texto).not.toContain('evitó');
  });

  it('ni siquiera queda el símbolo de aviso', () => {
    // Un ⚠️ solo ya invita a preguntar «¿aviso de qué?».
    expect(formatForClient(RUTINA, CONTEXTO)).not.toContain('⚠️');
  });

  it('una rutina con varios warnings no filtra ninguno', () => {
    const texto = formatForClient(
      { ...RUTINA, warnings: ['Hernia L4-L5', 'Rodilla derecha', 'Cirugía de hombro'] },
      CONTEXTO,
    );

    for (const filtrado of ['Hernia', 'L4', 'Rodilla', 'Cirugía']) {
      expect(texto).not.toContain(filtrado);
    }
  });
});

describe('lo que sí llega', () => {
  it('saluda por su nombre', () => {
    expect(formatForClient(RUTINA, CONTEXTO)).toContain('Carlos');
  });

  it('trae lo que pidió: objetivo, días y minutos', () => {
    const texto = formatForClient(RUTINA, CONTEXTO);

    expect(texto).toContain('Ganancia muscular');
    expect(texto).toContain('4');
    expect(texto).toContain('60');
  });

  it('trae todos los días con sus ejercicios', () => {
    const texto = formatForClient(RUTINA, CONTEXTO);

    expect(texto).toContain('Press banca');
    expect(texto).toContain('Fondos');
    expect(texto).toContain('Remo');
    expect(texto).toContain('Empuje');
    expect(texto).toContain('Tirón');
  });

  it('las notas del ejercicio sí: son la adaptación, no el diagnóstico', () => {
    // «Baja controlado» es entrenamiento. Quitarlo dejaría al cliente con una
    // rutina peor sin protegerlo de nada.
    expect(formatForClient(RUTINA, CONTEXTO)).toContain('Baja controlado');
  });

  it('series, repeticiones y descanso', () => {
    const texto = formatForClient(RUTINA, CONTEXTO);
    expect(texto).toMatch(/4x8/);
    expect(texto).toContain('120');
  });

  it('le dice a quién preguntar', () => {
    expect(formatForClient(RUTINA, CONTEXTO).toLowerCase()).toContain('entrenador');
  });
});

describe('el formato no se rompe', () => {
  it('escapa lo que MarkdownV2 se tomaría a mal', () => {
    const texto = formatForClient(
      { ...RUTINA, summary: 'Rutina (dura) para +fuerza' },
      { ...CONTEXTO, clientName: 'Ana-María' },
    );

    expect(texto).toContain('\\(');
    expect(texto).toContain('\\-');
  });

  it('una rutina sin ejercicios en un día no deja el día colgado', () => {
    const texto = formatForClient(
      { ...RUTINA, days: [{ dayNumber: 1, focus: 'Descanso', exercises: [] }] },
      CONTEXTO,
    );

    expect(texto).toContain('Descanso');
  });
});

describe('una rutina sin evaluación detrás', () => {
  it('omite la línea de objetivo en vez de inventarla', () => {
    // Regla 13: una rutina manual o de plantilla no tiene formulario de Tally.
    const texto = formatForClient(RUTINA, { clientName: 'Carlos', plan: null });

    expect(texto).toContain('Hola Carlos');
    expect(texto).not.toContain('🎯');
    // Y los ejercicios siguen ahí: es una rutina completa.
    expect(texto).toContain('Remo');
  });
});
