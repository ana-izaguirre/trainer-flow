/**
 * SPEC-003 reglas 4 y 5 — formateo de mensajes para Telegram.
 *
 * Dos límites que Telegram no perdona: 4096 caracteres por mensaje, y
 * MarkdownV2 rompe el mensaje entero si un carácter especial va sin escapar.
 */
import { describe, expect, it } from 'vitest';
import type { Workout } from '../domain/workout.ts';
import { TELEGRAM_MAX_MESSAGE, escapeMarkdownV2, formatWorkout, splitMessage } from './format.ts';

// ---------------------------------------------------------------------------

describe('escapeMarkdownV2', () => {
  // La lista exacta de la documentación de Telegram.
  const ESPECIALES = '_*[]()~`>#+-=|{}.!';

  it.each([...ESPECIALES])('escapa %s', (char) => {
    expect(escapeMarkdownV2(char)).toBe(`\\${char}`);
  });

  it('escapa todos los especiales de una frase', () => {
    expect(escapeMarkdownV2('Ana_Pérez [test] (1-2)')).toBe(
      'Ana\\_Pérez \\[test\\] \\(1\\-2\\)',
    );
  });

  it('deja intacto el texto normal, acentos incluidos', () => {
    expect(escapeMarkdownV2('Press banca con mancuernas, día 1')).toBe(
      'Press banca con mancuernas, día 1',
    );
  });

  it('no escapa dos veces una barra ya presente', () => {
    // La barra invertida también es especial y se escapa una sola vez.
    expect(escapeMarkdownV2('a\\b')).toBe('a\\\\b');
  });

  it('maneja la cadena vacía', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });

  // El nombre del cliente viene de Tally: es texto que escribe un desconocido.
  it('neutraliza un nombre hostil sin perder el contenido', () => {
    const escapado = escapeMarkdownV2('*Ana* [click](http://malo.com)');

    expect(escapado).not.toMatch(/(?<!\\)\*/);
    expect(escapado).not.toMatch(/(?<!\\)\[/);
    expect(escapado).toContain('Ana');
  });
});

// ---------------------------------------------------------------------------

describe('splitMessage', () => {
  it('deja intacto un mensaje corto', () => {
    expect(splitMessage('hola')).toEqual(['hola']);
  });

  it('nunca produce un trozo mayor que el límite', () => {
    const largo = Array.from({ length: 500 }, (_, i) => `línea ${i}`).join('\n');

    for (const chunk of splitMessage(largo)) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
    }
  });

  it('corta por líneas, no a mitad de una', () => {
    const lineas = Array.from({ length: 400 }, (_, i) => `línea ${i} con texto de relleno`);
    const chunks = splitMessage(lineas.join('\n'));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const linea of chunk.split('\n')) {
        // Ninguna línea quedó partida por la mitad.
        expect(linea === '' || lineas.includes(linea)).toBe(true);
      }
    }
  });

  it('no pierde ni una línea al dividir', () => {
    const lineas = Array.from({ length: 400 }, (_, i) => `línea ${i} con texto de relleno`);
    const recompuesto = splitMessage(lineas.join('\n')).join('\n');

    for (const linea of lineas) {
      expect(recompuesto).toContain(linea);
    }
  });

  it('parte una línea única demasiado larga, porque no hay alternativa', () => {
    const chunks = splitMessage('x'.repeat(TELEGRAM_MAX_MESSAGE * 2 + 10));

    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
    }
  });

  it('respeta un límite personalizado', () => {
    expect(splitMessage('aaa\nbbb\nccc', 7)).toEqual(['aaa\nbbb', 'ccc']);
  });

  it('devuelve una lista vacía ante texto vacío', () => {
    expect(splitMessage('')).toEqual([]);
    expect(splitMessage('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const RUTINA: Workout = {
  summary: 'Ganancia muscular, 2 días',
  warnings: ['Se evitó press tras nuca por la limitación de hombro'],
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [
        { name: 'Press banca', sets: 4, reps: '8-10', restSeconds: 90, notes: null },
        { name: 'Press militar', sets: 3, reps: '12', restSeconds: 60, notes: 'Suave' },
      ],
    },
    {
      dayNumber: 2,
      focus: 'Tirón',
      exercises: [{ name: 'Remo', sets: 4, reps: 'AMRAP', restSeconds: 90, notes: null }],
    },
  ],
};

describe('formatWorkout', () => {
  it('incluye el resumen, los días y los ejercicios', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 1 });

    expect(texto).toContain('Carlos');
    expect(texto).toContain('Ganancia muscular');
    expect(texto).toContain('Empuje');
    expect(texto).toContain('Press banca');
    expect(texto).toContain('Remo');
  });

  it('muestra series, repeticiones y descanso', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 1 });
    expect(texto).toContain('4x8\\-10');
    expect(texto).toContain('90');
  });

  it('destaca los avisos de limitaciones', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 1 });
    expect(texto).toContain('⚠️');
    expect(texto).toContain('hombro');
  });

  it('incluye el número de versión', () => {
    expect(formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 3 })).toContain('v3');
  });

  it('numera los ejercicios para poder referirlos en /quitar', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 1 });

    // El punto va escapado: en MarkdownV2 es un carácter especial.
    expect(texto).toContain('1\\. Press banca');
    expect(texto).toContain('2\\. Press militar');
  });

  it('escapa el nombre del cliente, que es texto no confiable', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Ana_*[x]', versionNumber: 1 });

    expect(texto).toContain('Ana\\_');
    expect(texto).not.toMatch(/(?<!\\)\[x\]/);
  });

  it('escapa también los nombres de ejercicio', () => {
    const conEspeciales: Workout = {
      ...RUTINA,
      days: [
        {
          dayNumber: 1,
          focus: 'Test',
          exercises: [
            { name: 'Press (inclinado) 45°', sets: 3, reps: '10', restSeconds: 60, notes: null },
          ],
        },
      ],
    };

    const texto = formatWorkout(conEspeciales, { clientName: 'C', versionNumber: 1 });
    expect(texto).toContain('\\(inclinado\\)');
  });

  it('omite la sección de avisos cuando no hay ninguno', () => {
    const sinAvisos: Workout = { ...RUTINA, warnings: [] };
    expect(formatWorkout(sinAvisos, { clientName: 'C', versionNumber: 1 })).not.toContain('⚠️');
  });

  it('el resultado dividido cabe siempre en mensajes de Telegram', () => {
    const grande: Workout = {
      summary: 'Rutina larga',
      warnings: [],
      days: Array.from({ length: 7 }, (_day, d) => ({
        dayNumber: d + 1,
        focus: `Día ${d + 1}`,
        exercises: Array.from({ length: 15 }, (_ex, e) => ({
          name: `Ejercicio número ${e + 1} con un nombre bastante largo`,
          sets: 4,
          reps: '10-12',
          restSeconds: 90,
          notes: 'Una nota razonablemente larga para inflar el mensaje',
        })),
      })),
    };

    const chunks = splitMessage(formatWorkout(grande, { clientName: 'C', versionNumber: 1 }));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
    }
  });
});
