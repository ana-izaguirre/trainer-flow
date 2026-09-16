/**
 * SPEC-008 — el editor por comandos de Telegram.
 *
 * El entrenador edita desde el móvil, así que la sintaxis tiene que tolerar
 * cómo escribe una persona: espacios de más, mayúsculas, unidades sueltas.
 */
import { describe, expect, it } from 'vitest';
import type { Workout } from '../domain/workout.ts';
import { WORKOUT_LIMITS } from '../domain/workout.ts';
import { applyEditorCommand, parseEditorCommand } from './commands.ts';

function rutina(): Workout {
  return {
    summary: 'Rutina de prueba',
    warnings: [],
    days: [
      {
        dayNumber: 1,
        focus: 'Empuje',
        exercises: [
          { name: 'Press banca', sets: 4, reps: '8-10', restSeconds: 90, notes: null },
          { name: 'Press militar', sets: 3, reps: '12', restSeconds: 60, notes: null },
        ],
      },
    ],
  };
}

/** Atajo: parsea y aplica, devolviendo el resultado final. */
function ejecutar(workout: Workout, command: string, args: string) {
  const parsed = parseEditorCommand(command, args);
  if (!parsed.ok) return parsed;
  return applyEditorCommand(workout, parsed.command);
}

// ---------------------------------------------------------------------------

describe('/add — añadir un ejercicio', () => {
  it('acepta la forma natural: día, nombre, series x reps, descanso', () => {
    const result = ejecutar(rutina(), 'add', '1 Sentadilla 4x8 120');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nuevo = result.workout.days[0]?.exercises[2];
    expect(nuevo).toEqual({
      name: 'Sentadilla',
      sets: 4,
      reps: '8',
      restSeconds: 120,
      notes: null,
    });
  });

  it('admite un nombre de varias palabras', () => {
    const result = ejecutar(rutina(), 'add', '1 Peso muerto rumano 3x10 90');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workout.days[0]?.exercises[2]?.name).toBe('Peso muerto rumano');
  });

  it('admite rangos de repeticiones', () => {
    const result = ejecutar(rutina(), 'add', '1 Remo 4x10-12 90');
    if (result.ok) expect(result.workout.days[0]?.exercises[2]?.reps).toBe('10-12');
  });

  it('tolera la s de segundos en el descanso', () => {
    const result = ejecutar(rutina(), 'add', '1 Remo 4x10 90s');
    if (result.ok) expect(result.workout.days[0]?.exercises[2]?.restSeconds).toBe(90);
  });

  it('usa 90 segundos por defecto si no se indica descanso', () => {
    const result = ejecutar(rutina(), 'add', '1 Remo 4x10');
    if (result.ok) expect(result.workout.days[0]?.exercises[2]?.restSeconds).toBe(90);
  });

  it('tolera espacios de más', () => {
    const result = ejecutar(rutina(), 'add', '  1   Remo   4x10   90  ');
    expect(result.ok).toBe(true);
  });

  it('acepta la X mayúscula', () => {
    const result = ejecutar(rutina(), 'add', '1 Remo 4X10 90');
    expect(result.ok).toBe(true);
  });

  it('crea el día si no existía', () => {
    const result = ejecutar(rutina(), 'add', '3 Sentadilla 4x8 120');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days).toHaveLength(2);
      expect(result.workout.days[1]?.dayNumber).toBe(3);
    }
  });

  it.each([
    ['sin argumentos', ''],
    ['sin series x reps', '1 Sentadilla'],
    ['sin nombre', '1 4x8 90'],
    ['día fuera de rango', '9 Sentadilla 4x8 90'],
    ['día que no es número', 'lunes Sentadilla 4x8 90'],
    ['series fuera de rango', '1 Sentadilla 99x8 90'],
    ['series a cero', '1 Sentadilla 0x8 90'],
    ['descanso negativo', '1 Sentadilla 4x8 -5'],
    ['descanso absurdo', '1 Sentadilla 4x8 9999'],
  ])('rechaza %s', (_nombre, args) => {
    const result = ejecutar(rutina(), 'add', args);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it('el mensaje de error explica la sintaxis esperada', () => {
    const result = parseEditorCommand('add', 'cualquier cosa');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('/add');
  });
});

// ---------------------------------------------------------------------------

describe('/quitar — eliminar un ejercicio', () => {
  it('quita por el número que se muestra en el mensaje', () => {
    const result = ejecutar(rutina(), 'quitar', '1 1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days[0]?.exercises).toHaveLength(1);
      expect(result.workout.days[0]?.exercises[0]?.name).toBe('Press militar');
    }
  });

  it('quita el último y deja el día sin ejercicios', () => {
    const uno = rutina();
    const conUno: Workout = {
      ...uno,
      days: [{ ...uno.days[0]!, exercises: [uno.days[0]!.exercises[0]!] }],
    };

    const result = ejecutar(conUno, 'quitar', '1 1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workout.days[0]?.exercises).toHaveLength(0);
  });

  it.each([
    ['índice que no existe', '1 9'],
    ['índice cero, porque se cuenta desde 1', '1 0'],
    ['día que no existe', '5 1'],
    ['sin índice', '1'],
    ['argumentos no numéricos', 'uno dos'],
  ])('rechaza %s', (_nombre, args) => {
    expect(ejecutar(rutina(), 'quitar', args).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('/dia — añadir o renombrar un día', () => {
  it('renombra el foco de un día existente', () => {
    const result = ejecutar(rutina(), 'dia', '1 Pecho y tríceps');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days[0]?.focus).toBe('Pecho y tríceps');
      expect(result.workout.days[0]?.exercises).toHaveLength(2);
    }
  });

  it('crea un día nuevo, vacío, en su posición', () => {
    const result = ejecutar(rutina(), 'dia', '2 Pierna');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days).toHaveLength(2);
      expect(result.workout.days[1]).toMatchObject({ dayNumber: 2, focus: 'Pierna' });
    }
  });

  it('mantiene los días ordenados aunque se creen desordenados', () => {
    const paso1 = ejecutar(rutina(), 'dia', '5 Quinto');
    expect(paso1.ok).toBe(true);
    if (!paso1.ok) return;

    const paso2 = ejecutar(paso1.workout, 'dia', '3 Tercero');
    expect(paso2.ok).toBe(true);
    if (paso2.ok) {
      expect(paso2.workout.days.map((d) => d.dayNumber)).toEqual([1, 3, 5]);
    }
  });

  it.each([
    ['sin foco', '1'],
    ['día fuera de rango', '8 Algo'],
    ['foco en blanco', '1    '],
  ])('rechaza %s', (_nombre, args) => {
    expect(ejecutar(rutina(), 'dia', args).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('/nota — editar la nota de un ejercicio', () => {
  it('pone una nota', () => {
    const result = ejecutar(rutina(), 'nota', '1 1 Bajar despacio');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workout.days[0]?.exercises[0]?.notes).toBe('Bajar despacio');
  });

  it('borra la nota si el texto va vacío', () => {
    const conNota = ejecutar(rutina(), 'nota', '1 1 Algo');
    expect(conNota.ok).toBe(true);
    if (!conNota.ok) return;

    const borrada = ejecutar(conNota.workout, 'nota', '1 1');
    expect(borrada.ok).toBe(true);
    if (borrada.ok) expect(borrada.workout.days[0]?.exercises[0]?.notes).toBeNull();
  });

  it('rechaza un ejercicio que no existe', () => {
    expect(ejecutar(rutina(), 'nota', '1 9 Algo').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('comandos desconocidos', () => {
  it.each(['borrar', 'delete', 'xyz', ''])('rechaza /%s', (command) => {
    expect(parseEditorCommand(command, '1 2').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('inmutabilidad', () => {
  it('ninguna operación muta la rutina original', () => {
    const original = rutina();
    const copia = structuredClone(original);

    ejecutar(original, 'add', '1 Sentadilla 4x8 120');
    ejecutar(original, 'quitar', '1 1');
    ejecutar(original, 'dia', '2 Pierna');
    ejecutar(original, 'nota', '1 1 Algo');

    expect(original).toEqual(copia);
  });
});

// ---------------------------------------------------------------------------

describe('el resultado sigue siendo un Workout válido', () => {
  it('el texto libre se acota, no se acepta sin más', () => {
    const result = ejecutar(rutina(), 'add', `1 ${'x'.repeat(500)} 4x8 90`);

    // O lo rechaza, o lo trunca: lo que no puede es guardarlo entero.
    if (result.ok) {
      expect(result.workout.days[0]?.exercises[2]?.name.length).toBeLessThanOrEqual(120);
    } else {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

function dosDias(): Workout {
  return {
    summary: 'Dos días',
    warnings: [],
    days: [
      {
        dayNumber: 1,
        focus: 'Empuje',
        exercises: [
          { name: 'Press banca', sets: 4, reps: '8', restSeconds: 90, notes: null },
          { name: 'Press militar', sets: 3, reps: '12', restSeconds: 60, notes: null },
        ],
      },
      {
        dayNumber: 2,
        focus: 'Tirón',
        exercises: [{ name: 'Remo', sets: 4, reps: '10', restSeconds: 90, notes: 'Original' }],
      },
    ],
  };
}

describe('editar un día no toca los demás', () => {
  it('/add al día 1 deja el día 2 intacto', () => {
    const result = ejecutar(dosDias(), 'add', '1 Fondos 3x10 60');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days[0]?.exercises).toHaveLength(3);
      expect(result.workout.days[1]).toEqual(dosDias().days[1]);
    }
  });

  it('/quitar en el día 2 deja el día 1 intacto', () => {
    const result = ejecutar(dosDias(), 'quitar', '2 1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days[0]).toEqual(dosDias().days[0]);
      expect(result.workout.days[1]?.exercises).toHaveLength(0);
    }
  });

  it('/nota en el día 1 deja la nota del día 2 intacta', () => {
    const result = ejecutar(dosDias(), 'nota', '1 1 Nueva nota');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days[0]?.exercises[0]?.notes).toBe('Nueva nota');
      expect(result.workout.days[0]?.exercises[1]?.notes).toBeNull();
      expect(result.workout.days[1]?.exercises[0]?.notes).toBe('Original');
    }
  });

  it('/dia renombra uno sin tocar el otro', () => {
    const result = ejecutar(dosDias(), 'dia', '2 Espalda');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.days[0]?.focus).toBe('Empuje');
      expect(result.workout.days[1]?.focus).toBe('Espalda');
      // Renombrar no borra los ejercicios.
      expect(result.workout.days[1]?.exercises).toHaveLength(1);
    }
  });
});

describe('límite de ejercicios por día', () => {
  it('rechaza el ejercicio que supera el máximo', () => {
    const uno = { name: 'X', sets: 3, reps: '10', restSeconds: 60, notes: null };
    const lleno: Workout = {
      summary: 'Día lleno',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Todo',
          exercises: Array.from({ length: WORKOUT_LIMITS.exercisesPerDay.max }, () => uno),
        },
      ],
    };

    const result = ejecutar(lleno, 'add', '1 Uno más 3x10 60');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(WORKOUT_LIMITS.exercisesPerDay.max));
  });
});

describe('validaciones que quedaban sin probar', () => {
  it('rechaza repeticiones absurdamente largas', () => {
    const result = ejecutar(rutina(), 'add', `1 Remo 4x${'9'.repeat(30)} 90`);
    expect(result.ok).toBe(false);
  });

  it('rechaza un descanso que no es número', () => {
    const result = ejecutar(rutina(), 'add', '1 Remo 4x10 pronto');
    expect(result.ok).toBe(false);
  });

  it.each([
    ['día fuera de rango', '9 1 Algo'],
    ['índice cero', '1 0 Algo'],
    ['índice que no es número', '1 dos Algo'],
    ['sin argumentos', ''],
    ['solo el día, sin índice', '1'],
  ])('/nota rechaza %s', (_nombre, args) => {
    expect(ejecutar(rutina(), 'nota', args).ok).toBe(false);
  });

  it('/nota rechaza un día que no existe en la rutina', () => {
    const result = ejecutar(rutina(), 'nota', '4 1 Algo');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('4');
  });
});
