/**
 * `validateDraft` — la frontera entre datos no confiables y el dominio.
 *
 * SPEC-002 regla 7 y SPEC-008 regla 4. Es lo que impide que una respuesta rota
 * de la IA, o una rutina mal escrita a mano, llegue a la base de datos.
 */
import { describe, expect, it } from 'vitest';
import type {
  DraftSource,
  ValidationError,
  ValidationErrorCode,
  WorkoutConstraints,
} from './draft.ts';
import { describeErrors } from './draft.ts';
import { validateDraft } from './validate-draft.ts';
import { WORKOUT_LIMITS } from './workout.ts';

/** Una rutina válida de 2 días. Los tests la mutan para romperla. */
function rutinaValida(): Record<string, unknown> {
  return {
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
        exercises: [
          { name: 'Remo', sets: 4, reps: 'AMRAP', restSeconds: 90, notes: null },
        ],
      },
    ],
  };
}

const CONSTRAINTS: WorkoutConstraints = { daysPerWeek: 2, hasLimitations: true };

function validar(
  raw: unknown,
  constraints: WorkoutConstraints | null = CONSTRAINTS,
  source: DraftSource = 'ai',
) {
  return validateDraft({ source, raw }, constraints);
}

/** Los códigos de error de un resultado fallido. */
function codigos(result: ReturnType<typeof validar>): ValidationErrorCode[] {
  return result.ok ? [] : result.errors.map((e) => e.code);
}

/** Las rutas de un resultado fallido. */
function rutas(result: ReturnType<typeof validar>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.path);
}

// ---------------------------------------------------------------------------

describe('rutina válida', () => {
  it('acepta y devuelve el Workout tipado', () => {
    const result = validar(rutinaValida());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.workout.summary).toBe('Ganancia muscular, 2 días');
    expect(result.workout.days).toHaveLength(2);
    expect(result.workout.days[0]?.exercises[0]).toEqual({
      name: 'Press banca',
      sets: 4,
      reps: '8-10',
      restSeconds: 90,
      notes: null,
    });
  });

  it('acepta igual desde los tres orígenes', () => {
    for (const source of ['ai', 'template', 'manual'] as const) {
      expect(validar(rutinaValida(), CONSTRAINTS, source).ok, source).toBe(true);
    }
  });

  it('ignora campos desconocidos sin romperse', () => {
    const raw = { ...rutinaValida(), inventado: 'x', otroMas: { a: 1 } };
    expect(validar(raw).ok).toBe(true);
  });

  it('acepta notes ausente como null', () => {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    delete (day['exercises'] as Record<string, unknown>[])[0]!['notes'];

    const result = validar(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workout.days[0]?.exercises[0]?.notes).toBeNull();
  });

  it('acepta warnings vacío si el cliente no tiene limitaciones', () => {
    const raw = { ...rutinaValida(), warnings: [] };
    const sinLimitaciones = { daysPerWeek: 2, hasLimitations: false };

    expect(validar(raw, sinLimitaciones).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('la raíz no es una rutina', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'una rutina muy buena'],
    ['número', 42],
    ['array', [{ dayNumber: 1 }]],
    ['booleano', true],
  ])('rechaza %s', (_nombre, raw) => {
    expect(codigos(validar(raw))).toContain('NOT_AN_OBJECT');
  });

  it('el JSON roto de la IA llega como string y se rechaza', () => {
    // Si `JSON.parse` falló arriba, lo que llega aquí es el texto crudo.
    expect(validar('{"days": [').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('campos obligatorios', () => {
  it.each(['summary', 'days'])('rechaza si falta %s', (campo) => {
    const raw = rutinaValida();
    delete raw[campo];

    expect(codigos(validar(raw))).toContain('MISSING_FIELD');
    expect(rutas(validar(raw))).toContain(campo);
  });

  it.each(['name', 'sets', 'reps', 'restSeconds'])(
    'rechaza un ejercicio sin %s',
    (campo) => {
      const raw = rutinaValida();
      const day = (raw['days'] as Record<string, unknown>[])[0]!;
      delete (day['exercises'] as Record<string, unknown>[])[0]![campo];

      expect(codigos(validar(raw))).toContain('MISSING_FIELD');
      expect(rutas(validar(raw))).toContain(`days[0].exercises[0].${campo}`);
    },
  );

  it('rechaza un día sin focus', () => {
    const raw = rutinaValida();
    delete (raw['days'] as Record<string, unknown>[])[0]!['focus'];

    expect(codigos(validar(raw))).toContain('MISSING_FIELD');
  });
});

// ---------------------------------------------------------------------------

describe('tipos incorrectos', () => {
  it('rechaza sets como string', () => {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['sets'] = '4';

    expect(codigos(validar(raw))).toContain('WRONG_TYPE');
  });

  it('rechaza sets decimal', () => {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['sets'] = 3.5;

    expect(codigos(validar(raw))).toContain('WRONG_TYPE');
  });

  it('rechaza days que no es array', () => {
    expect(codigos(validar({ ...rutinaValida(), days: 'dos' }))).toContain('WRONG_TYPE');
  });

  it('rechaza warnings que no es array de strings', () => {
    expect(codigos(validar({ ...rutinaValida(), warnings: [1, 2] }))).toContain('WRONG_TYPE');
  });

  it('rechaza un día que no es objeto', () => {
    expect(codigos(validar({ ...rutinaValida(), days: ['lunes', 'martes'] }))).toContain(
      'NOT_AN_OBJECT',
    );
  });

  it('rechaza un ejercicio que no es objeto', () => {
    const raw = rutinaValida();
    (raw['days'] as Record<string, unknown>[])[0]!['exercises'] = ['press banca 4x8'];

    const result = validar(raw);
    expect(codigos(result)).toContain('NOT_AN_OBJECT');
    expect(rutas(result)).toContain('days[0].exercises[0]');
  });

  it('rechaza warnings que no es una lista', () => {
    expect(codigos(validar({ ...rutinaValida(), warnings: 'ojo con el hombro' }))).toContain(
      'WRONG_TYPE',
    );
  });
});

// ---------------------------------------------------------------------------

describe('rangos (SPEC-002 regla 7)', () => {
  function conSets(sets: unknown) {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['sets'] = sets;
    return raw;
  }

  it('acepta los extremos de sets: 1 y 10', () => {
    expect(validar(conSets(WORKOUT_LIMITS.sets.min)).ok).toBe(true);
    expect(validar(conSets(WORKOUT_LIMITS.sets.max)).ok).toBe(true);
  });

  it('rechaza sets = 0 y sets = 11', () => {
    expect(codigos(validar(conSets(0)))).toContain('OUT_OF_RANGE');
    expect(codigos(validar(conSets(11)))).toContain('OUT_OF_RANGE');
  });

  // SPEC-008 CA-6
  it('rechaza sets = 15 en una rutina MANUAL, igual que en una de IA', () => {
    const manual = validar(conSets(15), CONSTRAINTS, 'manual');
    const ia = validar(conSets(15), CONSTRAINTS, 'ai');

    expect(manual.ok).toBe(false);
    expect(codigos(manual)).toEqual(codigos(ia));
  });

  function conRest(restSeconds: unknown) {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['restSeconds'] = restSeconds;
    return raw;
  }

  it('acepta los extremos de restSeconds: 0 y 600', () => {
    expect(validar(conRest(0)).ok).toBe(true);
    expect(validar(conRest(600)).ok).toBe(true);
  });

  it('rechaza restSeconds negativo y mayor que 600', () => {
    expect(codigos(validar(conRest(-1)))).toContain('OUT_OF_RANGE');
    expect(codigos(validar(conRest(601)))).toContain('OUT_OF_RANGE');
  });

  it('rechaza dayNumber fuera de 1..7', () => {
    const raw = rutinaValida();
    (raw['days'] as Record<string, unknown>[])[0]!['dayNumber'] = 8;

    expect(codigos(validar(raw))).toContain('OUT_OF_RANGE');
  });

  it('rechaza dayNumber duplicado', () => {
    const raw = rutinaValida();
    (raw['days'] as Record<string, unknown>[])[1]!['dayNumber'] = 1;

    expect(codigos(validar(raw))).toContain('DUPLICATE_DAY');
  });
});

// ---------------------------------------------------------------------------

describe('estructura vacía', () => {
  it('rechaza un día sin ejercicios', () => {
    const raw = rutinaValida();
    (raw['days'] as Record<string, unknown>[])[0]!['exercises'] = [];

    expect(codigos(validar(raw))).toContain('EMPTY');
    expect(rutas(validar(raw))).toContain('days[0].exercises');
  });

  it('rechaza una rutina sin días', () => {
    const sinDias = { ...rutinaValida(), days: [] };
    expect(codigos(validar(sinDias, null))).toContain('EMPTY');
  });

  it('rechaza un nombre de ejercicio en blanco', () => {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['name'] = '   ';

    expect(codigos(validar(raw))).toContain('EMPTY');
  });

  it('rechaza un summary en blanco', () => {
    expect(codigos(validar({ ...rutinaValida(), summary: '' }))).toContain('EMPTY');
  });
});

// ---------------------------------------------------------------------------

describe('longitud de texto', () => {
  it('rechaza un summary demasiado largo', () => {
    const largo = 'x'.repeat(WORKOUT_LIMITS.text.summary + 1);
    expect(codigos(validar({ ...rutinaValida(), summary: largo }))).toContain('TOO_LONG');
  });

  it('acepta un summary en el límite exacto', () => {
    const justo = 'x'.repeat(WORKOUT_LIMITS.text.summary);
    expect(validar({ ...rutinaValida(), summary: justo }).ok).toBe(true);
  });

  it('rechaza un nombre de ejercicio demasiado largo', () => {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['name'] =
      'x'.repeat(WORKOUT_LIMITS.text.name + 1);

    expect(codigos(validar(raw))).toContain('TOO_LONG');
  });

  it('rechaza un warning demasiado largo', () => {
    const largo = 'x'.repeat(WORKOUT_LIMITS.text.warning + 1);
    expect(codigos(validar({ ...rutinaValida(), warnings: [largo] }))).toContain('TOO_LONG');
  });
});

// ---------------------------------------------------------------------------

describe('validaciones semánticas contra lo que pidió el cliente', () => {
  it('rechaza si los días no coinciden con los pedidos', () => {
    // El cliente pidió 4, la IA devolvió 2.
    const result = validar(rutinaValida(), { daysPerWeek: 4, hasLimitations: false });

    expect(codigos(result)).toContain('DAYS_MISMATCH');
    expect(rutas(result)).toContain('days');
  });

  it('acepta si coinciden', () => {
    expect(validar(rutinaValida(), { daysPerWeek: 2, hasLimitations: false }).ok).toBe(true);
  });

  it('rechaza si el cliente tiene limitaciones y la rutina no las menciona', () => {
    const sinWarnings = { ...rutinaValida(), warnings: [] };
    const result = validar(sinWarnings, { daysPerWeek: 2, hasLimitations: true });

    expect(codigos(result)).toContain('LIMITATIONS_NOT_ACKNOWLEDGED');
  });

  it('sin constraints no comprueba días ni limitaciones', () => {
    // Una rutina manual puede no venir de un formulario de Tally.
    const raw = { ...rutinaValida(), warnings: [] };
    expect(validar(raw, null).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('recolecta TODOS los errores, no solo el primero', () => {
  it('reporta los tres problemas de una vez', () => {
    const raw = rutinaValida();
    const day0 = (raw['days'] as Record<string, unknown>[])[0]!;
    (day0['exercises'] as Record<string, unknown>[])[0]!['sets'] = 99;
    (day0['exercises'] as Record<string, unknown>[])[1]!['restSeconds'] = -5;
    (raw['days'] as Record<string, unknown>[])[1]!['exercises'] = [];

    const result = validar(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(rutas(result)).toEqual(
      expect.arrayContaining([
        'days[0].exercises[0].sets',
        'days[0].exercises[1].restSeconds',
        'days[1].exercises',
      ]),
    );
  });

  it('cada error trae ruta, código y mensaje legible', () => {
    const result = validar({ summary: 'x', days: 'no', warnings: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    for (const error of result.errors) {
      expect(error.path).toBeTruthy();
      expect(error.code).toBeTruthy();
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe('la lista de ejercicios', () => {
  function conExercises(exercises: unknown) {
    const raw = rutinaValida();
    (raw['days'] as Record<string, unknown>[])[0]!['exercises'] = exercises;
    return raw;
  }

  it('rechaza si falta', () => {
    const raw = rutinaValida();
    delete (raw['days'] as Record<string, unknown>[])[0]!['exercises'];

    expect(codigos(validar(raw))).toContain('MISSING_FIELD');
  });

  it('rechaza si no es una lista', () => {
    expect(codigos(validar(conExercises('press banca')))).toContain('WRONG_TYPE');
  });

  it('rechaza más ejercicios de los permitidos en un día', () => {
    const uno = { name: 'Sentadilla', sets: 3, reps: '10', restSeconds: 60, notes: null };
    const demasiados = Array.from(
      { length: WORKOUT_LIMITS.exercisesPerDay.max + 1 },
      () => uno,
    );

    expect(codigos(validar(conExercises(demasiados)))).toContain('OUT_OF_RANGE');
  });

  it('acepta justo el máximo', () => {
    const uno = { name: 'Sentadilla', sets: 3, reps: '10', restSeconds: 60, notes: null };
    const justos = Array.from({ length: WORKOUT_LIMITS.exercisesPerDay.max }, () => uno);

    const raw = rutinaValida();
    (raw['days'] as Record<string, unknown>[])[0]!['exercises'] = justos;
    expect(validar(raw, { daysPerWeek: 2, hasLimitations: false }).ok).toBe(true);
  });
});

describe('campos opcionales', () => {
  function conNotes(notes: unknown) {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['notes'] = notes;
    return raw;
  }

  it('notes null explícito se acepta', () => {
    expect(validar(conNotes(null)).ok).toBe(true);
  });

  it('notes en blanco se normaliza a null', () => {
    const result = validar(conNotes('   '));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workout.days[0]?.exercises[0]?.notes).toBeNull();
  });

  it('rechaza notes que no es texto', () => {
    expect(codigos(validar(conNotes(42)))).toContain('WRONG_TYPE');
  });

  it('rechaza notes demasiado largo', () => {
    const largo = 'x'.repeat(WORKOUT_LIMITS.text.notes + 1);
    expect(codigos(validar(conNotes(largo)))).toContain('TOO_LONG');
  });

  it('warnings ausente se trata como lista vacía', () => {
    const raw = rutinaValida();
    delete raw['warnings'];

    const result = validar(raw, { daysPerWeek: 2, hasLimitations: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workout.warnings).toEqual([]);
  });

  it('warnings null se trata como lista vacía', () => {
    const raw = { ...rutinaValida(), warnings: null };
    expect(validar(raw, { daysPerWeek: 2, hasLimitations: false }).ok).toBe(true);
  });
});

describe('valores null explícitos en campos obligatorios', () => {
  it('rechaza summary null', () => {
    expect(codigos(validar({ ...rutinaValida(), summary: null }))).toContain('MISSING_FIELD');
  });

  it('rechaza days null', () => {
    expect(codigos(validar({ ...rutinaValida(), days: null }))).toContain('MISSING_FIELD');
  });

  it('rechaza sets null', () => {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['sets'] = null;

    expect(codigos(validar(raw))).toContain('MISSING_FIELD');
  });

  it('rechaza reps demasiado largo', () => {
    const raw = rutinaValida();
    const day = (raw['days'] as Record<string, unknown>[])[0]!;
    (day['exercises'] as Record<string, unknown>[])[0]!['reps'] =
      'x'.repeat(WORKOUT_LIMITS.text.reps + 1);

    expect(codigos(validar(raw))).toContain('TOO_LONG');
  });
});

// ---------------------------------------------------------------------------

/** Un error de validación cualquiera: aquí solo importa su mensaje. */
function unError(message: string): ValidationError {
  return { path: 'days', code: 'EMPTY', message };
}

describe('describeErrors — los fallos, en palabras', () => {
  it('junta los mensajes, no los objetos', () => {
    // `errors.join('; ')` sobre objetos produce «[object Object]»: un mensaje
    // que no dice nada y que no falla en ningún sitio hasta verlo en Telegram.
    const texto = describeErrors([unError('Falta el día 1.'), unError('Falta el día 2.')]);

    expect(texto).toBe('Falta el día 1. Falta el día 2.');
    expect(texto).not.toContain('object');
  });

  it('con muchos, se acota y dice cuántos quedan', () => {
    // Una rutina recién empezada produce un error por campo que falta; un
    // muro de texto no ayuda a arreglar nada.
    const texto = describeErrors([1, 2, 3, 4, 5].map((n) => unError(`Fallo ${n}.`)));

    expect(texto).toContain('Fallo 3.');
    expect(texto).not.toContain('Fallo 4.');
    expect(texto).toContain('y 2 más');
  });

  it('justo en el límite no dice «y 0 más»', () => {
    const texto = describeErrors([1, 2, 3].map((n) => unError(`Fallo ${n}.`)));
    expect(texto).not.toContain('más');
  });

  it('sin errores devuelve vacío', () => {
    expect(describeErrors([])).toBe('');
  });
});
