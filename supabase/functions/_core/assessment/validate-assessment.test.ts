/**
 * SPEC-001 — Validación de la evaluación del cliente.
 *
 * Esta capa NO sabe nada de Tally. Recibe campos ya extraídos y los convierte
 * en un `ParsedAssessment` tipado, o en una lista de errores.
 *
 * Esa separación es lo que hace que un cambio en el formato de Tally no toque
 * las reglas del dominio.
 */
import { describe, expect, it } from 'vitest';
import { ASSESSMENT_LIMITS, validateAssessment } from './validate-assessment.ts';

function campos(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Carlos Pérez',
    email: 'carlos@example.com',
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
      email: 'carlos@example.com',
      goal: 'Ganancia muscular',
      level: 'intermediate',
      daysPerWeek: 4,
      sessionMinutes: 60,
      equipment: 'Gimnasio',
      hasLimitations: true,
      limitationsDetail: 'Molestia de hombro derecho',
      lifestyle: 'Trabajo sentado',
      notes: null,
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

describe('email', () => {
  it('es opcional', () => {
    expect(validateAssessment(campos({ email: null })).ok).toBe(true);
    const sinEmail = campos();
    delete sinEmail['email'];
    expect(validateAssessment(sinEmail).ok).toBe(true);
  });

  it('normaliza a minúsculas', () => {
    const result = validateAssessment(campos({ email: 'Carlos@Example.COM' }));
    if (result.ok) expect(result.value.email).toBe('carlos@example.com');
  });

  it('un email en blanco se trata como ausente', () => {
    const result = validateAssessment(campos({ email: '   ' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBeNull();
  });

  it.each(['sin-arroba', '@sindominio.com', 'con espacio@x.com', 'a@b'])(
    'rechaza %s',
    (email) => {
      expect(errores(campos({ email }))).toContain('email');
    },
  );
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
