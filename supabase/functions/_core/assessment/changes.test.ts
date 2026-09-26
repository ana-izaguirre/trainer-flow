/**
 * SPEC-027 regla 8 — Qué cambió entre dos envíos del formulario.
 *
 * Los campos cerrados se muestran antes → después. Los de salud y los de
 * texto libre, solo por su nombre: el aviso se ve en la pantalla de bloqueo.
 */
import { describe, expect, it } from 'vitest';
import { assessmentChanges, formatChanges, type ComparableAssessment } from './changes.ts';

const BASE: ComparableAssessment = {
  goal: 'Ganancia muscular',
  level: 'intermediate',
  daysPerWeek: 3,
  sessionMinutes: 60,
  equipment: 'Máquinas de gimnasio',
  hasLimitations: false,
  limitationsDetail: null,
  lifestyle: null,
  notes: null,
  gender: 'Hombre',
  age: 30,
  weightKg: 80,
  heightCm: 180,
  lastWeighed: null,
  quitReasons: null,
  menopauseStage: null,
  chronicConditions: null,
  birthDate: null,
  medications: null,
  equipmentDetail: null,
};

describe('assessmentChanges', () => {
  it('CA-10 · sin cambios, lista vacía', () => {
    expect(assessmentChanges(BASE, { ...BASE })).toEqual([]);
  });

  it('CA-4 · días y minutos: antes → después', () => {
    const cambios = assessmentChanges(BASE, { ...BASE, daysPerWeek: 2, sessionMinutes: 45 });

    expect(cambios).toEqual([
      { label: 'días', before: '3', after: '2' },
      { label: 'minutos', before: '60', after: '45' },
    ]);
  });

  it('el nivel, en palabras', () => {
    expect(assessmentChanges(BASE, { ...BASE, level: 'beginner' })).toEqual([
      { label: 'nivel', before: 'Intermedio', after: 'Principiante' },
    ]);
  });

  it('objetivo y equipamiento, con su texto', () => {
    const cambios = assessmentChanges(BASE, {
      ...BASE,
      goal: 'Pérdida de grasa',
      equipment: 'Mancuernas',
    });

    expect(cambios).toEqual([
      { label: 'objetivo', before: 'Ganancia muscular', after: 'Pérdida de grasa' },
      { label: 'equipamiento', before: 'Máquinas de gimnasio', after: 'Mancuernas' },
    ]);
  });

  // CA-5. Una lesión nueva no se escribe en un aviso que se ve en la pantalla
  // de bloqueo. El detalle está en 📄 Ver evaluación.
  it('🔴 CA-5 · limitaciones: solo el nombre, nunca el texto', () => {
    const cambios = assessmentChanges(BASE, {
      ...BASE,
      hasLimitations: true,
      limitationsDetail: 'Rodilla derecha operada',
    });

    expect(cambios).toEqual([{ label: 'limitaciones' }]);
    expect(JSON.stringify(cambios)).not.toContain('Rodilla');
  });

  it.each([
    ['medications', 'medicamentos', 'Metformina'],
    ['chronicConditions', 'condiciones de salud', 'Diabetes'],
    ['menopauseStage', 'etapa hormonal', 'Perimenopausia'],
    ['weightKg', 'peso', 75],
    ['heightCm', 'altura', 181],
    ['age', 'edad', 31],
    ['birthDate', 'edad', '1994-01-01'],
    ['gender', 'género', 'Mujer'],
    ['lifestyle', 'estilo de vida', 'Activo'],
    ['notes', 'notas', 'Viajo mucho'],
    ['lastWeighed', 'último pesaje', 'Ayer'],
    ['quitReasons', 'lo que lo frena', 'Tiempo'],
    ['equipmentDetail', 'detalle del equipamiento', 'Mancuernas de 10 kg'],
  ] as const)('%s: solo «%s»', (campo, label, valor) => {
    const cambios = assessmentChanges(BASE, { ...BASE, [campo]: valor });

    expect(cambios).toEqual([{ label }]);
    expect(JSON.stringify(cambios)).not.toContain(String(valor));
  });

  it('edad y fecha de nacimiento a la vez cuentan una sola vez', () => {
    expect(assessmentChanges(BASE, { ...BASE, age: 31, birthDate: '1994-01-01' })).toEqual([
      { label: 'edad' },
    ]);
  });

  it('espacios de más no cuentan como cambio', () => {
    expect(assessmentChanges(BASE, { ...BASE, goal: '  Ganancia muscular ' })).toEqual([]);
  });

  it('un texto vacío y null son lo mismo', () => {
    expect(assessmentChanges(BASE, { ...BASE, notes: '' })).toEqual([]);
  });

  it('un número que llega como texto desde la base no cuenta como cambio', () => {
    // `numeric` en PostgreSQL viaja como texto en algunos drivers.
    const anterior = { ...BASE, weightKg: '80' } as unknown as ComparableAssessment;
    expect(assessmentChanges(anterior, BASE)).toEqual([]);
  });

  it('sin evaluación anterior, todo lo que tiene dato cuenta como nuevo', () => {
    const cambios = assessmentChanges(null, BASE);
    expect(cambios.map((c) => c.label)).toContain('días');
    expect(cambios.find((c) => c.label === 'días')).toEqual({ label: 'días', before: null, after: '3' });
  });

  it('un nivel que no se conoce se muestra tal cual', () => {
    const anterior = { ...BASE, level: 'experto' } as unknown as ComparableAssessment;
    expect(assessmentChanges(anterior, BASE)).toEqual([
      { label: 'nivel', before: 'experto', after: 'Intermedio' },
    ]);
  });
});

describe('formatChanges', () => {
  it('un valor que desaparece se muestra con guion', () => {
    expect(formatChanges([{ label: 'objetivo', before: 'Fuerza', after: null }])).toBe(
      'objetivo (Fuerza → —)',
    );
  });

  it('con antes → después, o solo el nombre', () => {
    expect(
      formatChanges([
        { label: 'días', before: '3', after: '2' },
        { label: 'limitaciones' },
      ]),
    ).toBe('días (3 → 2) · limitaciones');
  });

  it('sin valor anterior, solo el nuevo', () => {
    expect(formatChanges([{ label: 'días', before: null, after: '3' }])).toBe('días (→ 3)');
  });
});
