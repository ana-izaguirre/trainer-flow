/**
 * Plantillas predefinidas.
 *
 * ┌─ POR QUÉ ESTE MÓDULO IMPORTA ───────────────────────────────────────────┐
 * │ Es lo que hace que la IA no sea punto único de fallo. Si el proveedor  │
 * │ se cae, o se agota la cuota, el entrenador carga una plantilla y sigue.│
 * │ Por eso viven en código y no en la base de datos: funcionan aunque la   │
 * │ base esté degradada.                                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import { LEVELS } from './domain/assessment.ts';
import { validateDraft } from './domain/validate-draft.ts';
import { WORKOUT_LIMITS } from './domain/workout.ts';
import { TEMPLATES, applyTemplate, findTemplate, templatesFor } from './templates.ts';

describe('el catálogo', () => {
  it('tiene al menos tres plantillas', () => {
    // SPEC-008: "un pequeño conjunto de plantillas predefinidas".
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it('cubre los tres niveles', () => {
    const niveles = new Set(TEMPLATES.map((t) => t.level));
    for (const nivel of LEVELS) {
      expect(niveles.has(nivel), `falta una plantilla de nivel ${nivel}`).toBe(true);
    }
  });

  it('incluye al menos una que no necesita gimnasio', () => {
    // Si el cliente no tiene equipo, tiene que haber una opción para él.
    expect(TEMPLATES.some((t) => t.equipment.toLowerCase().includes('ninguno'))).toBe(true);
  });

  it('los ids son únicos', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada plantilla declara los días que realmente tiene', () => {
    for (const template of TEMPLATES) {
      expect(template.workout.days.length, template.id).toBe(template.daysPerWeek);
    }
  });
});

// ---------------------------------------------------------------------------

describe('todas las plantillas pasan la misma validación que la IA', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s es un Workout válido', (id, template) => {
    const result = validateDraft({ source: 'template', raw: template.workout }, null);

    if (!result.ok) {
      // Mensaje legible si alguna vez alguien rompe una plantilla al editarla.
      throw new Error(
        `La plantilla ${id} no valida:\n` +
          result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'),
      );
    }
    expect(result.ok).toBe(true);
  });

  it('también validan contra las restricciones de un cliente sin limitaciones', () => {
    for (const template of TEMPLATES) {
      const result = validateDraft(
        { source: 'template', raw: template.workout },
        { daysPerWeek: template.daysPerWeek, hasLimitations: false },
      );
      expect(result.ok, template.id).toBe(true);
    }
  });

  it('respetan los límites del modelo', () => {
    for (const template of TEMPLATES) {
      for (const day of template.workout.days) {
        expect(day.exercises.length, `${template.id} día ${day.dayNumber}`).toBeGreaterThanOrEqual(
          WORKOUT_LIMITS.exercisesPerDay.min,
        );
        for (const exercise of day.exercises) {
          expect(exercise.sets).toBeGreaterThanOrEqual(WORKOUT_LIMITS.sets.min);
          expect(exercise.sets).toBeLessThanOrEqual(WORKOUT_LIMITS.sets.max);
          expect(exercise.restSeconds).toBeLessThanOrEqual(WORKOUT_LIMITS.restSeconds.max);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('findTemplate', () => {
  it('encuentra por id', () => {
    const primera = TEMPLATES[0]!;
    expect(findTemplate(primera.id)?.id).toBe(primera.id);
  });

  it('devuelve undefined si no existe', () => {
    expect(findTemplate('no-existe')).toBeUndefined();
  });

  it('devuelve undefined con id vacío', () => {
    expect(findTemplate('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('templatesFor', () => {
  // SPEC-008 CA-8
  it('pone primero la que mejor encaja: 4 días, intermedio', () => {
    const resultado = templatesFor({
      daysPerWeek: 4,
      level: 'intermediate',
      equipment: 'Gimnasio',
    });

    expect(resultado[0]?.id).toBe('upper-lower-4d');
  });

  it('pone primero la de casa si el cliente no tiene equipo', () => {
    const resultado = templatesFor({
      daysPerWeek: 3,
      level: 'beginner',
      equipment: 'Ninguno',
    });

    expect(resultado[0]?.id).toBe('home-bodyweight-3d');
  });

  it('sin criterios devuelve todas', () => {
    expect(templatesFor({})).toHaveLength(TEMPLATES.length);
  });

  // Esto es lo que protege el fallback: si filtrara, un cliente con criterios
  // raros se quedaría sin ninguna opción justo cuando la IA falló.
  it('NUNCA devuelve una lista vacía, por raros que sean los criterios', () => {
    const resultado = templatesFor({
      daysPerWeek: 7,
      level: 'advanced',
      equipment: 'Solo una toalla',
    });

    expect(resultado).toHaveLength(TEMPLATES.length);
  });

  it('ordena por cuántos criterios encajan', () => {
    const resultado = templatesFor({ daysPerWeek: 6, level: 'advanced' });
    expect(resultado[0]?.id).toBe('push-pull-legs-6d');
  });

  it('no muta el catálogo', () => {
    const antes = TEMPLATES.map((t) => t.id);
    templatesFor({ daysPerWeek: 6 });
    expect(TEMPLATES.map((t) => t.id)).toEqual(antes);
  });
});

// ---------------------------------------------------------------------------

describe('applyTemplate', () => {
  const template = TEMPLATES[0]!;

  it('produce un WorkoutDraft con source template', () => {
    const draft = applyTemplate(template, null);
    expect(draft.source).toBe('template');
  });

  it('el draft resultante valida', () => {
    const draft = applyTemplate(template, null);
    expect(validateDraft(draft, null).ok).toBe(true);
  });

  it('sin limitaciones no añade avisos', () => {
    const draft = applyTemplate(template, {
      daysPerWeek: template.daysPerWeek,
      hasLimitations: false,
    });

    const result = validateDraft(draft, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workout.warnings).toEqual([]);
  });

  // Una plantilla no sabe nada del hombro de Carlos. Si el cliente declaró
  // limitaciones, el draft tiene que decirlo para que el entrenador lo vea.
  it('con limitaciones inyecta un aviso para el entrenador', () => {
    const constraints = { daysPerWeek: template.daysPerWeek, hasLimitations: true };
    const draft = applyTemplate(template, constraints);

    const result = validateDraft(draft, constraints);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workout.warnings.length).toBeGreaterThan(0);
      expect(result.workout.warnings[0]).toMatch(/limitacion/i);
    }
  });

  it('el aviso hace que la plantilla pase la validación de un cliente con limitaciones', () => {
    // Sin el aviso, validateDraft la rechazaría con LIMITATIONS_NOT_ACKNOWLEDGED
    // y el entrenador no podría ni cargarla.
    const constraints = { daysPerWeek: template.daysPerWeek, hasLimitations: true };

    const sinAviso = validateDraft({ source: 'template', raw: template.workout }, constraints);
    expect(sinAviso.ok).toBe(false);

    const conAviso = validateDraft(applyTemplate(template, constraints), constraints);
    expect(conAviso.ok).toBe(true);
  });

  it('no muta la plantilla original', () => {
    const constraints = { daysPerWeek: template.daysPerWeek, hasLimitations: true };
    applyTemplate(template, constraints);

    expect(template.workout.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('SPEC-008 CA-7 — las plantillas no tocan nada externo', () => {
  it('TEMPLATES es un valor estático, disponible sin await', () => {
    // No es una promesa, no es una consulta: es una constante del binario.
    expect(Array.isArray(TEMPLATES)).toBe(true);
    expect(TEMPLATES).not.toBeInstanceOf(Promise);
  });
});
