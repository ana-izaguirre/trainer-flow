/**
 * SPEC-001 — Validación de la evaluación del cliente.
 *
 * Esta capa NO sabe nada de Tally. Recibe campos ya extraídos y los convierte
 * en un `ParsedAssessment` tipado, o en una lista de errores.
 *
 * Esa separación es lo que hace que un cambio en el formato de Tally no toque
 * las reglas del dominio.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSESSMENT_LIMITS, validateAssessment } from './validate-assessment.ts';

function campos(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Carlos Pérez',
    goal: 'Ganancia muscular',
    level: 'intermediate',
    daysPerWeek: 4,
    sessionMinutes: 60,
    equipment: 'Gimnasio',
    hasLimitations: true,
    limitationsDetail: 'Molestia de hombro derecho',
    lifestyle: 'Trabajo sentado',
    notes: null,
    ...overrides,
  };
}

function errores(raw: unknown): string[] {
  const result = validateAssessment(raw);
  return result.ok ? [] : result.errors.map((e) => e.field);
}

// ---------------------------------------------------------------------------

describe('evaluación válida', () => {
  it('acepta y devuelve el objeto tipado', () => {
    const result = validateAssessment(campos());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      fullName: 'Carlos Pérez',
      goal: 'Ganancia muscular',
      level: 'intermediate',
      daysPerWeek: 4,
      sessionMinutes: 60,
      equipment: 'Gimnasio',
      hasLimitations: true,
      limitationsDetail: 'Molestia de hombro derecho',
      lifestyle: 'Trabajo sentado',
      notes: null,
      gender: null,
      age: null,
      weightKg: null,
      heightCm: null,
      lastWeighed: null,
      quitReasons: null,
      menopauseStage: null,
      chronicConditions: null,
      birthDate: null,
      medications: null,
      equipmentDetail: null,
    });
  });

  it('ignora campos desconocidos sin romperse', () => {
    expect(validateAssessment({ ...campos(), inventado: 'x' }).ok).toBe(true);
  });

  it('recorta los espacios de los textos', () => {
    const result = validateAssessment(campos({ fullName: '  Carlos Pérez  ' }));
    if (result.ok) expect(result.value.fullName).toBe('Carlos Pérez');
  });
});

// ---------------------------------------------------------------------------

describe('la raíz', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'Carlos'],
    ['array', []],
    ['número', 1],
  ])('rechaza %s', (_nombre, raw) => {
    expect(validateAssessment(raw).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('campos obligatorios', () => {
  it.each(['fullName', 'goal', 'equipment', 'level', 'daysPerWeek', 'sessionMinutes', 'hasLimitations'])(
    'rechaza si falta %s',
    (campo) => {
      const sinCampo = campos();
      delete sinCampo[campo];

      expect(errores(sinCampo)).toContain(campo);
    },
  );

  it.each(['fullName', 'goal', 'equipment'])('rechaza %s en blanco', (campo) => {
    expect(errores(campos({ [campo]: '   ' }))).toContain(campo);
  });

  it('reporta TODOS los campos que fallan, no solo el primero', () => {
    const roto = campos({ fullName: '', daysPerWeek: 99, level: 'experto' });
    const fallos = errores(roto);

    expect(fallos).toEqual(expect.arrayContaining(['fullName', 'daysPerWeek', 'level']));
  });
});

// ---------------------------------------------------------------------------

describe('nivel', () => {
  it.each(['beginner', 'intermediate', 'advanced'])('acepta %s', (level) => {
    expect(validateAssessment(campos({ level })).ok).toBe(true);
  });

  it.each(['experto', 'BEGINNER', '', 1, null])('rechaza %s', (level) => {
    expect(errores(campos({ level }))).toContain('level');
  });
});

// ---------------------------------------------------------------------------

describe('números', () => {
  it('acepta los extremos válidos', () => {
    expect(validateAssessment(campos({ daysPerWeek: 1 })).ok).toBe(true);
    expect(validateAssessment(campos({ daysPerWeek: 7 })).ok).toBe(true);
    expect(validateAssessment(campos({ sessionMinutes: 15 })).ok).toBe(true);
    expect(validateAssessment(campos({ sessionMinutes: 180 })).ok).toBe(true);
  });

  it.each([0, 8, -1, 3.5])('rechaza daysPerWeek = %s', (daysPerWeek) => {
    expect(errores(campos({ daysPerWeek }))).toContain('daysPerWeek');
  });

  it.each([14, 181, 0])('rechaza sessionMinutes = %s', (sessionMinutes) => {
    expect(errores(campos({ sessionMinutes }))).toContain('sessionMinutes');
  });

  // Un formulario web manda strings. Coercionar "4" es inequívoco y evita
  // que la capa de mapeo tenga que adivinar tipos.
  it('acepta un número escrito como texto', () => {
    const result = validateAssessment(campos({ daysPerWeek: '4', sessionMinutes: '60' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.daysPerWeek).toBe(4);
      expect(result.value.sessionMinutes).toBe(60);
    }
  });

  it.each(['cuatro', '', '4 días', null, true])('rechaza %s como número', (daysPerWeek) => {
    expect(errores(campos({ daysPerWeek }))).toContain('daysPerWeek');
  });
});

// ---------------------------------------------------------------------------

describe('limitaciones', () => {
  it('sin limitaciones, el detalle se normaliza a null', () => {
    // El CHECK de la base lo exige: has_limitations OR limitations_detail IS NULL
    const result = validateAssessment(
      campos({ hasLimitations: false, limitationsDetail: 'algo que sobra' }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.limitationsDetail).toBeNull();
  });

  it('con limitaciones pero sin detalle, se acepta', () => {
    // El cliente marcó que sí pero no quiso explayarse. Es válido.
    const result = validateAssessment(campos({ hasLimitations: true, limitationsDetail: null }));
    expect(result.ok).toBe(true);
  });

  it.each(['sí', 1, 'true', null])('rechaza hasLimitations = %s', (hasLimitations) => {
    // Normalizar "sí"/"no" es tarea de la capa de mapeo, que sí conoce el
    // formulario. Aquí el tipo tiene que ser booleano.
    expect(errores(campos({ hasLimitations }))).toContain('hasLimitations');
  });
});

// ---------------------------------------------------------------------------

describe('texto libre', () => {
  it('trunca en vez de rechazar', () => {
    // SPEC-001 regla 7: el texto libre se acota, no se pierde la evaluación.
    const largo = 'x'.repeat(ASSESSMENT_LIMITS.freeText + 500);
    const result = validateAssessment(campos({ lifestyle: largo, notes: largo }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lifestyle?.length).toBe(ASSESSMENT_LIMITS.freeText);
      expect(result.value.notes?.length).toBe(ASSESSMENT_LIMITS.freeText);
    }
  });

  it('trunca también el detalle de limitaciones', () => {
    const largo = 'x'.repeat(ASSESSMENT_LIMITS.freeText + 100);
    const result = validateAssessment(campos({ limitationsDetail: largo }));

    if (result.ok) expect(result.value.limitationsDetail?.length).toBe(ASSESSMENT_LIMITS.freeText);
  });

  it('un nombre demasiado largo sí se rechaza, no se trunca', () => {
    // Truncar un nombre produciría un cliente llamado "Carl". Mejor fallar.
    expect(errores(campos({ fullName: 'x'.repeat(ASSESSMENT_LIMITS.name + 1) }))).toContain(
      'fullName',
    );
  });

  it('los campos opcionales en blanco quedan en null', () => {
    const result = validateAssessment(campos({ lifestyle: '  ', notes: '' }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lifestyle).toBeNull();
      expect(result.value.notes).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe('los errores son útiles para depurar', () => {
  it('cada error nombra el campo y explica qué se esperaba', () => {
    const result = validateAssessment(campos({ daysPerWeek: 99 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const error = result.errors.find((e) => e.field === 'daysPerWeek');
    expect(error?.message).toMatch(/1.*7/);
  });

  it('NUNCA incluye el valor del detalle de limitaciones en el mensaje', () => {
    // Es un dato de salud: no puede acabar en un log de error.
    const result = validateAssessment(
      campos({ hasLimitations: 'sí', limitationsDetail: 'hernia discal L4-L5' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    for (const error of result.errors) {
      expect(error.message).not.toContain('hernia');
    }
  });
});

// ─── SPEC-016 · los campos nuevos ──────────────────────────────────────────

describe('campos opcionales de SPEC-016', () => {
  const base = {
    fullName: 'Carlos',
    goal: 'Fuerza',
    level: 'beginner',
    daysPerWeek: 3,
    sessionMinutes: 60,
    equipment: 'Gimnasio',
    hasLimitations: false,
  };

  it('CA-6 · el peso acepta coma decimal', () => {
    // «78,5» y «78.5» tienen que ser el mismo dato.
    const coma = validateAssessment({ ...base, weightKg: '78,5' });
    const punto = validateAssessment({ ...base, weightKg: '78.5' });

    expect(coma.ok && coma.value.weightKg).toBe(78.5);
    expect(punto.ok && punto.value.weightKg).toBe(78.5);
  });

  it('CA-2 · sin ningún campo nuevo, la evaluación entra igual', () => {
    const r = validateAssessment(base);

    expect(r.ok).toBe(true);
    expect(r.ok && r.value.age).toBeNull();
    expect(r.ok && r.value.chronicConditions).toBeNull();
  });

  it('un dedazo se descarta, NO invalida la evaluación', () => {
    // Tirar la evaluación entera por un «250» en la edad dejaría al cliente
    // sin rutina por un dato que ni siquiera hacía falta.
    const r = validateAssessment({ ...base, age: '250', heightCm: '3' });

    expect(r.ok).toBe(true);
    expect(r.ok && r.value.age).toBeNull();
    expect(r.ok && r.value.heightCm).toBeNull();
  });

  it('un número con texto pegado no cuela', () => {
    const r = validateAssessment({ ...base, weightKg: '78 kg', age: 'treinta' });

    expect(r.ok && r.value.weightKg).toBeNull();
    expect(r.ok && r.value.age).toBeNull();
  });

  it('CA-1 · con todos los campos, se guardan todos', () => {
    const r = validateAssessment({
      ...base,
      gender: 'Mujer',
      age: 47,
      weightKg: 62,
      heightCm: 165,
      lastWeighed: 'Hace un mes',
      quitReasons: 'Falta de tiempo, falta de motivación',
      menopauseStage: 'Perimenopausia',
      chronicConditions: 'Hipertensión. Madre con diabetes.',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.gender).toBe('Mujer');
    expect(r.value.age).toBe(47);
    expect(r.value.weightKg).toBe(62);
    expect(r.value.menopauseStage).toBe('Perimenopausia');
    expect(r.value.chronicConditions).toContain('Hipertensión');
  });
});

describe('la fecha de nacimiento (SPEC-016)', () => {
  const base = {
    fullName: 'Carlos',
    goal: 'Fuerza',
    level: 'beginner',
    daysPerWeek: 3,
    sessionMinutes: 60,
    equipment: 'Gimnasio',
    hasLimitations: false,
  };

  const fecha = (v: unknown): string | null => {
    const r = validateAssessment({ ...base, birthDate: v });
    return r.ok ? r.value.birthDate : null;
  };

  it('acepta AAAA-MM-DD y la deja como texto', () => {
    // No se convierte a Date: interpretarla aquí metería la zona horaria del
    // servidor en una fecha de nacimiento, y un 1 de enero sería 31 de dic.
    expect(fecha('1992-03-12')).toBe('1992-03-12');
    expect(fecha('  1992-03-12  ')).toBe('1992-03-12');
  });

  it('rechaza un día que no existe aunque cumpla el patrón', () => {
    // `2026-02-31` pasa la expresión regular y no es un día real.
    expect(fecha('2026-02-31')).toBeNull();
    expect(fecha('2026-13-01')).toBeNull();
  });

  it.each([
    ['otro formato', '12/03/1992'],
    ['con hora pegada', '1992-03-12T00:00:00Z'],
    ['texto', 'no sé'],
    ['vacío', ''],
    ['un número', 19920312],
    ['nulo', null],
  ])('descarta %s sin invalidar la evaluación', (_n, v) => {
    expect(fecha(v)).toBeNull();
    expect(validateAssessment({ ...base, birthDate: v }).ok).toBe(true);
  });

  it('acepta el 29 de febrero de un bisiesto', () => {
    expect(fecha('1992-02-29')).toBe('1992-02-29');
    expect(fecha('1993-02-29')).toBeNull();
  });

  // El mismo rango que el CHECK real de la base (migración 0021): entre hace
  // 120 y hace 10 años. Una fecha válida en el calendario pero fuera de este
  // rango pasaba antes, y el INSERT reventaba en la base sin que nadie se
  // enterara (webhook.ts la trataba como error transitorio, no como dato
  // inválido) — exactamente el bug que esto evita.
  // En UTC, igual que la implementación: así no depende de la zona horaria
  // de quien corre los tests, sobre todo en los límites exactos.
  function haceAnios(anios: number, ajusteDias = 0): string {
    const hoy = new Date();
    const calculada = new Date(
      Date.UTC(hoy.getUTCFullYear() - anios, hoy.getUTCMonth(), hoy.getUTCDate() + ajusteDias),
    );
    return calculada.toISOString().slice(0, 10);
  }

  it('rechaza una fecha en el futuro', () => {
    expect(fecha(haceAnios(-1))).toBeNull();
  });

  it('rechaza a alguien con menos de 10 años', () => {
    expect(fecha(haceAnios(5))).toBeNull();
    expect(fecha(haceAnios(10, 1))).toBeNull(); // un día más joven que el límite
  });

  it('rechaza una fecha de hace más de 120 años', () => {
    expect(fecha(haceAnios(121))).toBeNull();
    expect(fecha(haceAnios(130))).toBeNull();
  });

  it('acepta los dos extremos del rango, igual que el CHECK de la base', () => {
    expect(fecha(haceAnios(10))).toBe(haceAnios(10));
    expect(fecha(haceAnios(120))).toBe(haceAnios(120));
  });

  it('acepta una fecha típica dentro del rango', () => {
    expect(fecha(haceAnios(30))).toBe(haceAnios(30));
  });

  // ─────────────────────────────────────────────────────────────────────
  // El 29 de febrero sobre un año que NO es bisiesto: el CHECK real
  // (`current_date - interval 'N years'`) hace CLAMPING al 28 de febrero;
  // `Date.UTC` sin corregir hace ROLLOVER al 1 de marzo. Dos resultados
  // distintos — exactamente la divergencia que esto debe evitar. Solo se
  // puede probar fijando el reloj: en cualquier otro día del año, ambos
  // cálculos coinciden y el caso no se manifiesta.
  describe('el 29 de febrero, con el año límite NO bisiesto', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('el límite coincide con el clamping de Postgres, no con el rollover de Date.UTC', () => {
      // Hoy: 29 feb 2028 (bisiesto). hoy - 10 años = 2018 (NO bisiesto).
      // Postgres: date '2028-02-29' - interval '10 years' = '2018-02-28'.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2028-02-29T12:00:00Z'));

      // El límite real (clamping): nacer ESE día cumple exactamente 10 años.
      expect(fecha('2018-02-28')).toBe('2018-02-28');
      // Un día más joven que el límite real: con el rollover sin corregir,
      // esto pasaba como "válido" y el INSERT real lo habría rechazado.
      expect(fecha('2018-03-01')).toBeNull();
    });
  });
});
