/**
 * SPEC-022 — La rutina entera en un mensaje.
 *
 * Lo que se prueba aquí es sobre todo TOLERANCIA: el entrenador escribe desde
 * el móvil, y el parser tiene que aguantar cómo escribe una persona. Lo que
 * no se tolera es un renglón que no se entiende — y ahí el mensaje dice
 * CUÁL, porque «no entendí la rutina» no le sirve a nadie.
 */
import { describe, expect, it } from 'vitest';
import { parseWorkoutText } from './bulk.ts';

/** Los días de un parseo que tiene que salir bien. */
function dias(text: string) {
  const result = parseWorkoutText(text);
  if (!result.ok) throw new Error(`No parseó: ${result.error}`);
  return result.days;
}

/** El error de un parseo que tiene que fallar. */
function error(text: string): string {
  const result = parseWorkoutText(text);
  if (result.ok) throw new Error('Parseó, y no debía');
  return result.error;
}

// ---------------------------------------------------------------------------

describe('una rutina dictada de corrido', () => {
  const RUTINA = `Día 1: Empuje
Press banca 4x8 90
Press militar 3x10 60

Día 2: Tirón
Dominadas 4x6 120
Remo con barra 4x8`;

  it('sale con sus días y sus ejercicios', () => {
    const resultado = dias(RUTINA);

    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toMatchObject({ dayNumber: 1, focus: 'Empuje' });
    expect(resultado[1]).toMatchObject({ dayNumber: 2, focus: 'Tirón' });
    expect(resultado[0]?.exercises).toHaveLength(2);
    expect(resultado[1]?.exercises).toHaveLength(2);
  });

  it('cada ejercicio trae lo suyo', () => {
    expect(dias(RUTINA)[0]?.exercises[0]).toEqual({
      name: 'Press banca',
      sets: 4,
      reps: '8',
      restSeconds: 90,
      notes: null,
    });
  });

  it('sin descanso escrito, usa el de por defecto', () => {
    expect(dias(RUTINA)[1]?.exercises[1]?.restSeconds).toBe(90);
  });

  it('un nombre de varias palabras no se parte', () => {
    expect(dias(RUTINA)[1]?.exercises[1]?.name).toBe('Remo con barra');
  });
});

describe('tolera cómo escribe una persona', () => {
  it('con tilde, sin tilde y en mayúsculas', () => {
    for (const cabecera of ['Día 1: Empuje', 'Dia 1: Empuje', 'DÍA 1: Empuje']) {
      expect(dias(`${cabecera}\nPress banca 4x8`)[0]?.focus).toBe('Empuje');
    }
  });

  it('el separador da igual: dos puntos, guion, punto o nada', () => {
    for (const cabecera of ['Día 1: Empuje', 'Día 1 - Empuje', 'Día 1. Empuje', 'Día 1 Empuje']) {
      expect(dias(`${cabecera}\nPress banca 4x8`)[0]?.focus).toBe('Empuje');
    }
  });

  it('espacios de más y renglones en blanco no molestan', () => {
    const resultado = dias('\n\n   Día 1:   Empuje   \n\n   Press banca   4x8   90  \n\n');

    expect(resultado[0]?.focus).toBe('Empuje');
    expect(resultado[0]?.exercises[0]?.name).toBe('Press banca');
  });

  it('la X de las series puede ser mayúscula, y las reps un rango', () => {
    const ejercicio = dias('Día 1: A\nPress banca 4X8-10')[0]?.exercises[0];
    expect(ejercicio).toMatchObject({ sets: 4, reps: '8-10' });
  });

  it('el descanso admite la s de segundos', () => {
    expect(dias('Día 1: A\nPress banca 4x8 90s')[0]?.exercises[0]?.restSeconds).toBe(90);
  });

  it('un día sin foco se llama por su número', () => {
    // Obligar a inventarle nombre a un día que el entrenador ya tiene claro
    // es fricción por nada.
    expect(dias('Día 3\nPress banca 4x8')[0]?.focus).toBe('Día 3');
  });

  it('dictar los días en desorden los devuelve ordenados', () => {
    const resultado = dias('Día 2: B\nRemo 4x8\n\nDía 1: A\nPress 4x8');
    expect(resultado.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(resultado[0]?.focus).toBe('A');
  });
});

describe('cuando algo no se entiende, dice qué renglón', () => {
  it('un ejercicio antes del primer día', () => {
    const mensaje = error('Press banca 4x8\nDía 1: Empuje');
    expect(mensaje).toContain('Renglón 1');
    expect(mensaje).toContain('Press banca 4x8');
    expect(mensaje).toContain('Día 1');
  });

  it('un renglón sin series ni repeticiones', () => {
    const mensaje = error('Día 1: Empuje\nPress banca\nRemo 4x8');
    expect(mensaje).toContain('Renglón 2');
    expect(mensaje).toContain('Press banca');
  });

  it('cuenta los renglones en blanco, para que el número cuadre con la pantalla', () => {
    // Si no los contara, el entrenador buscaría el error en otro sitio.
    expect(error('Día 1: A\n\n\nPress banca')).toContain('Renglón 4');
  });

  it('solo las series y reps, sin nombre', () => {
    expect(error('Día 1: Empuje\n4x8 90')).toContain('falta el nombre');
  });

  it('series fuera de rango', () => {
    const mensaje = error('Día 1: Empuje\nPress banca 99x8');
    expect(mensaje).toContain('Renglón 2');
    expect(mensaje).toContain('series');
  });

  it('repeticiones demasiado largas', () => {
    expect(error(`Día 1: A\nPress 4x${'8'.repeat(30)}`)).toContain('demasiado largas');
  });

  it('un descanso que no es número', () => {
    expect(error('Día 1: A\nPress banca 4x8 mucho')).toContain('segundos');
  });

  it('un descanso fuera de rango', () => {
    const mensaje = error('Día 1: A\nPress banca 4x8 9999');
    expect(mensaje).toContain('Renglón 2');
    expect(mensaje).toContain('descanso');
  });

  it('un día fuera de rango', () => {
    expect(error('Día 0: A\nPress 4x8')).toContain('el día debe estar entre');
    expect(error('Día 9: A\nPress 4x8')).toContain('el día debe estar entre');
  });

  it('el mismo día dos veces', () => {
    const mensaje = error('Día 1: A\nPress 4x8\n\nDía 1: B\nRemo 4x8');
    expect(mensaje).toContain('Renglón 4');
    expect(mensaje).toContain('ya estaba');
  });

  it('demasiados ejercicios en un día', () => {
    const muchos = Array.from({ length: 16 }, (_, i) => `Ejercicio${i} 3x10`).join('\n');
    expect(error(`Día 1: A\n${muchos}`)).toContain('máximo');
  });

  it('un mensaje sin ningún día dice que van en el MISMO mensaje (SPEC-022 M1)', () => {
    // «No encontré ningún día. Empieza por uno» se leía como si pidiera una
    // rutina de un día. Lo que falta de verdad es escribirlos debajo.
    expect(error('')).toContain('MISMO mensaje');
    expect(error('   \n  \n ')).toContain('MISMO mensaje');
  });
});

describe('los límites del dominio se respetan', () => {
  it('un nombre larguísimo se recorta, no se rechaza', () => {
    // Recortar es mejor que rechazar: el entrenador ve el resultado y lo
    // corrige si le molesta.
    const largo = 'A'.repeat(300);
    expect(dias(`Día 1: X\n${largo} 4x8`)[0]?.exercises[0]?.name.length).toBe(120);
  });

  it('un foco larguísimo también', () => {
    expect(dias(`Día 1: ${'B'.repeat(200)}\nPress 4x8`)[0]?.focus.length).toBe(80);
  });

  it('un día puede quedarse sin ejercicios', () => {
    // La rutina no se aprueba así, pero dictarla a medias tiene que poderse:
    // la puerta de validateDraft está en aprobar, no aquí.
    const resultado = dias('Día 1: Empuje\nPress 4x8\n\nDía 2: Tirón');
    expect(resultado[1]?.exercises).toEqual([]);
  });
});
