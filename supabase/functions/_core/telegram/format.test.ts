/**
 * SPEC-003 reglas 4 y 5, SPEC-029 — formateo de mensajes para Telegram.
 *
 * Dos límites que Telegram no perdona: 4096 caracteres por mensaje, y
 * MarkdownV2 rompe el mensaje entero si un carácter especial va sin escapar.
 *
 * SPEC-029 además exige que se LEA bien: bloques por ejercicio, series y
 * descanso en palabras, y nada del Markdown que el modelo mete por costumbre.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Exercise, Workout, WorkoutDay } from '../domain/workout.ts';
import type { TelegramSender } from '../ports/telegram-ports.ts';
import {
  cleanFreeText,
  escapeMarkdownV2,
  formatDayHeader,
  formatDayView,
  formatExerciseBlock,
  formatIndexForTrainer,
  formatWorkout,
  packBlocks,
  sendLongMessage,
  splitMessage,
  TELEGRAM_MAX_MESSAGE,
} from './format.ts';

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
    expect(escapeMarkdownV2('a\\b')).toBe('a\\\\b');
  });

  it('maneja la cadena vacía', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });

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
// SPEC-029 — limpieza del texto libre de la IA

describe('cleanFreeText', () => {
  it('quita la negrita de Markdown sin perder el texto', () => {
    expect(cleanFreeText('Rutina de **hipertrofia** clásica')).toBe('Rutina de hipertrofia clásica');
  });

  it('quita el subrayado de Markdown', () => {
    expect(cleanFreeText('__importante__ leer esto')).toBe('importante leer esto');
  });

  it('quita comillas invertidas', () => {
    expect(cleanFreeText('usa el `rack` de sentadilla')).toBe('usa el rack de sentadilla');
  });

  it('quita viñetas al inicio de línea, de los tres estilos', () => {
    expect(cleanFreeText('- primero')).toBe('primero');
    expect(cleanFreeText('* segundo')).toBe('segundo');
    expect(cleanFreeText('• tercero')).toBe('tercero');
  });

  it('no toca un guion que no es viñeta', () => {
    expect(cleanFreeText('press inclinado 30-45 grados')).toBe('press inclinado 30-45 grados');
  });

  it('recorta espacios sobrantes en los extremos', () => {
    expect(cleanFreeText('  con espacios  ')).toBe('con espacios');
  });

  it('deja intacto un texto ya limpio', () => {
    expect(cleanFreeText('Sube el peso cada semana')).toBe('Sube el peso cada semana');
  });
});

// ---------------------------------------------------------------------------
// SPEC-029 CA-2 — el descanso, en palabras

describe('formatExerciseBlock', () => {
  const base: Exercise = { name: 'Sentadilla', sets: 4, reps: '8-10', restSeconds: 90, notes: null };

  it('el nombre va numerado y en negrita', () => {
    expect(formatExerciseBlock(base, 3)).toContain('*3\\. Sentadilla*');
  });

  it('series y reps con el signo ×, sin la x pegada', () => {
    expect(formatExerciseBlock(base, 1)).toContain('4 × 8–10');
  });

  it('el guion entre dos números de reps se vuelve un en dash', () => {
    expect(formatExerciseBlock({ ...base, reps: '8-10' }, 1)).toContain('8–10');
  });

  it('un rango que no es numérico no se toca', () => {
    expect(formatExerciseBlock({ ...base, reps: 'AMRAP' }, 1)).toContain('AMRAP');
  });

  it.each([
    [0, 'sin descanso'],
    [45, '45 s'],
    [60, '1 min'],
    [90, '1 min 30 s'],
    [120, '2 min'],
    [150, '2 min 30 s'],
  ])('restSeconds %i se lee «%s»', (segundos, esperado) => {
    expect(formatExerciseBlock({ ...base, restSeconds: segundos }, 1)).toContain(esperado);
  });

  it('la nota va con 💡 y sin cursiva', () => {
    const texto = formatExerciseBlock({ ...base, notes: 'Baja controlado' }, 1);
    expect(texto).toContain('💡 Baja controlado');
    expect(texto).not.toContain('_Baja controlado_');
  });

  it('sin nota, no deja una línea de más', () => {
    const texto = formatExerciseBlock(base, 1);
    expect(texto.split('\n')).toHaveLength(2);
  });

  it('una nota vacía o solo espacios tampoco deja línea', () => {
    expect(formatExerciseBlock({ ...base, notes: '   ' }, 1).split('\n')).toHaveLength(2);
  });

  it('limpia y escapa el nombre y la nota', () => {
    const texto = formatExerciseBlock(
      { ...base, name: '**Press** (inclinado)', notes: '- baja despacio' },
      1,
    );
    expect(texto).toContain('Press \\(inclinado\\)');
    expect(texto).not.toContain('**');
    expect(texto).toContain('💡 baja despacio');
  });
});

describe('formatDayHeader', () => {
  const day: WorkoutDay = { dayNumber: 2, focus: 'Tren superior', exercises: [] };

  it('lleva el emoji, el número y el foco, en negrita', () => {
    expect(formatDayHeader(day)).toBe('📅 *Día 2 · Tren superior*');
  });

  it('limpia y escapa el foco', () => {
    expect(formatDayHeader({ ...day, focus: '**Empuje** (pecho)' })).toBe(
      '📅 *Día 2 · Empuje \\(pecho\\)*',
    );
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

  it('muestra series, repeticiones y descanso ya en palabras', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 1 });
    expect(texto).toContain('4 × 8–10 · descanso 1 min 30 s');
  });

  it('destaca los avisos de limitaciones bajo su propio título', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 1 });
    expect(texto).toContain('⚠️ *Tenido en cuenta*');
    expect(texto).toContain('hombro');
  });

  it('incluye el número de versión', () => {
    expect(formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 3 })).toContain('v3');
  });

  it('numera los ejercicios para poder referirlos en /quitar', () => {
    const texto = formatWorkout(RUTINA, { clientName: 'Carlos', versionNumber: 1 });

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

  it('limpia el Markdown que mete la IA en el resumen y el foco', () => {
    const conMarkdown: Workout = {
      ...RUTINA,
      summary: 'Rutina de **hipertrofia**',
      days: [{ ...RUTINA.days[0]!, focus: '__Empuje__' }],
    };
    const texto = formatWorkout(conMarkdown, { clientName: 'C', versionNumber: 1 });
    expect(texto).not.toContain('**');
    expect(texto).not.toContain('__');
    expect(texto).toContain('hipertrofia');
  });

  it('sin resumen ni foco no deja dobles saltos de línea', () => {
    // No debería pasar en la práctica (el esquema lo exige), pero un
    // resumen vacío no debe dejar el mensaje con huecos raros.
    const texto = formatWorkout({ ...RUTINA, summary: '' }, { clientName: 'C', versionNumber: 1 });
    expect(texto).not.toContain('\n\n\n');
  });
});

// ---------------------------------------------------------------------------
// SPEC-031 — navegación: índice y un día a la vez

describe('formatDayView', () => {
  it('trae la cabecera y los ejercicios de ESE día, numerados desde 1', () => {
    const texto = formatDayView(RUTINA, 2)!;

    expect(texto).toContain('📅 *Día 2 · Tirón*');
    expect(texto).toContain('1\\. Remo');
    expect(texto).not.toContain('Press banca');
    expect(texto).not.toContain('Empuje');
  });

  it('un día con varios ejercicios los trae todos', () => {
    const texto = formatDayView(RUTINA, 1)!;

    expect(texto).toContain('1\\. Press banca');
    expect(texto).toContain('2\\. Press militar');
    expect(texto).not.toContain('Remo');
  });

  it('un día que no existe en la rutina da null', () => {
    expect(formatDayView(RUTINA, 3)).toBeNull();
    expect(formatDayView(RUTINA, 99)).toBeNull();
  });

  it('respeta el descanso en palabras y el escape, igual que en la vista completa', () => {
    const texto = formatDayView(RUTINA, 1)!;
    expect(texto).toContain('4 × 8–10 · descanso 1 min 30 s');
  });
});

describe('formatIndexForTrainer', () => {
  it('trae el título con el nombre y la versión', () => {
    const texto = formatIndexForTrainer(RUTINA, { clientName: 'Ana-María', versionNumber: 2 });
    expect(texto).toContain('Ana\\-María');
    expect(texto).toContain('v2');
  });

  it('trae el resumen', () => {
    expect(formatIndexForTrainer(RUTINA, { clientName: 'C', versionNumber: 1 })).toContain(
      'Ganancia muscular',
    );
  });

  it('trae un renglón por día, sin ningún ejercicio', () => {
    const texto = formatIndexForTrainer(RUTINA, { clientName: 'C', versionNumber: 1 });

    expect(texto).toContain('📅 *Día 1 · Empuje*');
    expect(texto).toContain('📅 *Día 2 · Tirón*');
    expect(texto).not.toContain('Press banca');
    expect(texto).not.toContain('Remo');
  });

  it('los renglones de día van pegados, no como bloques separados', () => {
    const texto = formatIndexForTrainer(RUTINA, { clientName: 'C', versionNumber: 1 });
    expect(texto).toContain('📅 *Día 1 · Empuje*\n📅 *Día 2 · Tirón*');
  });

  it('NUNCA trae las advertencias: son de la vista completa (regla 9 de SPEC-031)', () => {
    const texto = formatIndexForTrainer(RUTINA, { clientName: 'C', versionNumber: 1 });
    expect(texto).not.toContain('⚠️');
    expect(texto).not.toContain('hombro');
  });
});

// ---------------------------------------------------------------------------
// SPEC-029 §6 — mensajes largos

describe('packBlocks', () => {
  it('deja intacto un texto corto', () => {
    expect(packBlocks('uno\n\ndos')).toEqual(['uno\n\ndos']);
  });

  it('devuelve una lista vacía ante texto vacío', () => {
    expect(packBlocks('')).toEqual([]);
    expect(packBlocks('   ')).toEqual([]);
  });

  it('nunca parte un bloque a la mitad', () => {
    const bloques = Array.from({ length: 50 }, (_, i) => `Bloque ${i}\nsegunda línea del ${i}`);
    const chunks = packBlocks(bloques.join('\n\n'), 200);

    for (const bloque of bloques) {
      const enUnSoloChunk = chunks.some((c) => c.includes(bloque));
      expect(enUnSoloChunk).toBe(true);
    }
  });

  it('ningún chunk supera el límite', () => {
    const bloques = Array.from({ length: 50 }, (_, i) => `Bloque ${i}\nsegunda línea del ${i}`);
    const chunks = packBlocks(bloques.join('\n\n'), 200);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('no pierde ningún bloque', () => {
    const bloques = Array.from({ length: 50 }, (_, i) => `Bloque número ${i}`);
    const recompuesto = packBlocks(bloques.join('\n\n'), 200).join('\n\n');

    for (const bloque of bloques) {
      expect(recompuesto).toContain(bloque);
    }
  });

  it('un solo bloque más grande que el límite se parte por última instancia', () => {
    const chunks = packBlocks('x'.repeat(500), 200);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it('el resultado de una rutina de 7 días cabe siempre en mensajes de Telegram', () => {
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

    const chunks = packBlocks(formatWorkout(grande, { clientName: 'C', versionNumber: 1 }));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
    }
  });

  it('ningún ejercicio queda partido entre dos chunks', () => {
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

    const chunks = packBlocks(formatWorkout(grande, { clientName: 'C', versionNumber: 1 }));

    for (let d = 1; d <= 7; d++) {
      for (let e = 1; e <= 15; e++) {
        const bloque = `${e}\\. Ejercicio número ${e} con un nombre bastante largo`;
        expect(chunks.some((c) => c.includes(bloque))).toBe(true);
      }
    }
  });
});

describe('sendLongMessage', () => {
  function capturar(): { sender: TelegramSender; enviados: { chatId: number; text: string; keyboard: unknown }[] } {
    const enviados: { chatId: number; text: string; keyboard: unknown }[] = [];
    return {
      enviados,
      sender: {
        sendMessage: vi.fn((chatId: number, text: string, keyboard) => {
          enviados.push({ chatId, text, keyboard: keyboard ?? null });
          return Promise.resolve();
        }),
        answerCallback: vi.fn(() => Promise.resolve()),
      },
    };
  }

  it('un mensaje corto se manda entero, con el teclado', () => {
    const { sender, enviados } = capturar();
    return sendLongMessage(sender, 42, 'hola', { inline_keyboard: [] }).then(() => {
      expect(enviados).toEqual([{ chatId: 42, text: 'hola', keyboard: { inline_keyboard: [] } }]);
    });
  });

  it('un mensaje largo se manda en varios envíos, y el teclado va en el último', async () => {
    const { sender, enviados } = capturar();
    const bloques = Array.from({ length: 200 }, (_, i) => `Bloque ${i} con relleno para pasar el límite`).join(
      '\n\n',
    );
    const teclado = { inline_keyboard: [[{ text: 'ok', callback_data: 'x' }]] };

    await sendLongMessage(sender, 7, bloques, teclado);

    expect(enviados.length).toBeGreaterThan(1);
    for (const [i, envio] of enviados.entries()) {
      expect(envio.keyboard).toBe(i === enviados.length - 1 ? teclado : null);
    }
  });

  it('sin teclado, ningún envío lleva uno', async () => {
    const { sender, enviados } = capturar();
    await sendLongMessage(sender, 7, 'hola');
    expect(enviados[0]!.keyboard).toBeNull();
  });
});
