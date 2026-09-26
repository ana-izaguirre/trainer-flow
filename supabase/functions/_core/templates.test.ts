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
import { formatForClient } from './telegram/client-format.ts';
import { EQUIPMENT_TIERS } from './equipment.ts';
import { TEMPLATES, adaptDays, applyTemplate, findTemplate, templatesFor } from './templates.ts';

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

  // SPEC-028: para cada nivel de equipamiento, al menos una que pueda hacer.
  it.each(EQUIPMENT_TIERS)('incluye al menos una para el nivel %s', (nivel) => {
    expect(TEMPLATES.some((t) => t.equipment === nivel)).toBe(true);
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
      equipment: 'Máquinas de gimnasio',
    });

    expect(resultado[0]?.id).toBe('upper-lower-4d');
  });

  it('pone primero la de casa si el cliente no tiene equipo', () => {
    const resultado = templatesFor({
      daysPerWeek: 3,
      level: 'beginner',
      equipment: 'Sin equipamiento',
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

// ---------------------------------------------------------------------------

describe('los días se ajustan a los que el cliente pidió', () => {
  // ┌─ EL BUG QUE ESTO CIERRA ───────────────────────────────────────────────┐
  // │ Las cuatro plantillas son de 3, 4, 3 y 6 días, y `validateDraft` exige │
  // │ que coincidan exactamente. Un cliente de 2 días veía las cuatro —la    │
  // │ regla 7 promete no dejarlo sin opciones— y NINGUNA cargaba.            │
  // └────────────────────────────────────────────────────────────────────────┘
  const tresDias = TEMPLATES.find((t) => t.daysPerWeek === 3)!;

  it('de 3 días a 2: se queda con los dos primeros', () => {
    const draft = applyTemplate(tresDias, { daysPerWeek: 2, hasLimitations: false });
    const result = validateDraft(draft, { daysPerWeek: 2, hasLimitations: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout.days.map((d) => d.dayNumber)).toEqual([1, 2]);
    expect(result.workout.days[0]?.focus).toBe(tresDias.workout.days[0]?.focus);
  });

  it('de 3 días a 5: vuelve a empezar, renumerando', () => {
    const draft = applyTemplate(tresDias, { daysPerWeek: 5, hasLimitations: false });
    const result = validateDraft(draft, { daysPerWeek: 5, hasLimitations: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout.days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5]);
    // El ciclo: el cuarto día repite el primero, el quinto el segundo.
    expect(result.workout.days[3]?.focus).toBe(tresDias.workout.days[0]?.focus);
    expect(result.workout.days[4]?.focus).toBe(tresDias.workout.days[1]?.focus);
  });

  it('si el número ya coincide, no toca nada ni avisa', () => {
    const draft = applyTemplate(tresDias, { daysPerWeek: 3, hasLimitations: false });
    const result = validateDraft(draft, { daysPerWeek: 3, hasLimitations: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout.days).toEqual(tresDias.workout.days);
    expect(result.workout.warnings).toEqual([]);
  });

  it('cuando el número cambia, el entrenador se entera', () => {
    // Recortar «torso/pierna» a 2 días deja un reparto que hay que mirar. El
    // sistema deja la rutina cargable; decidir si sirve es del entrenador.
    const draft = applyTemplate(tresDias, { daysPerWeek: 2, hasLimitations: false });
    const result = validateDraft(draft, { daysPerWeek: 2, hasLimitations: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout.warnings.some((w) => /d[ií]as/i.test(w))).toBe(true);
  });

  it('sin constraints se deja la plantilla como está', () => {
    const draft = applyTemplate(tresDias, null);
    const result = validateDraft(draft, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workout.days).toEqual(tresDias.workout.days);
  });

  it('sin días de los que partir, no inventa ninguno', () => {
    // `%` sobre una lista vacía da NaN, y un `dayNumber: NaN` se colaría
    // hasta la validación. Ninguna plantilla llega así, pero de esto depende
    // que el borrador sea cargable: no se apoya en un invariante.
    expect(adaptDays([], 3)).toEqual([]);
  });

  // El test que prueba que la regla 7 ya se cumple de verdad.
  it('CUALQUIER plantilla carga para CUALQUIER número de días de 1 a 7', () => {
    const fallos: string[] = [];

    for (const template of TEMPLATES) {
      for (let dias = 1; dias <= 7; dias += 1) {
        const constraints = { daysPerWeek: dias, hasLimitations: false };
        const result = validateDraft(applyTemplate(template, constraints), constraints);
        if (!result.ok) fallos.push(`${template.id} a ${dias} días`);
      }
    }

    expect(fallos).toEqual([]);
  });

  it('y también para un cliente con limitaciones', () => {
    const fallos: string[] = [];

    for (const template of TEMPLATES) {
      for (let dias = 1; dias <= 7; dias += 1) {
        const constraints = { daysPerWeek: dias, hasLimitations: true };
        const result = validateDraft(applyTemplate(template, constraints), constraints);
        if (!result.ok) fallos.push(`${template.id} a ${dias} días`);
      }
    }

    expect(fallos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('SPEC-008 ampliación — una plantilla para cada número de días', () => {
  // ┌─ EL HUECO QUE ESTO CIERRA ────────────────────────────────────────────┐
  // │ El formulario acepta de 1 a 7 días y solo había plantillas de 3, 4 y  │
  // │ 6. Una clienta de 2 días no vio ninguna de 2 (uso real, sept. 2026).  │
  // │ `adaptDays` la hacía cargable, pero el ajuste solo es bueno cerca del │
  // │ original: a 7 días repetía A, B, C sin descanso.                      │
  // └────────────────────────────────────────────────────────────────────────┘

  // R-A1
  it.each([1, 2, 3, 4, 5, 6, 7])('existe al menos una plantilla de exactamente %i días', (dias) => {
    expect(TEMPLATES.some((t) => t.daysPerWeek === dias)).toBe(true);
  });

  // CA-A1
  it.each([1, 2, 3, 4, 5, 6, 7])('CA-A1: a un cliente de %i días, la primera tiene sus días', (dias) => {
    expect(templatesFor({ daysPerWeek: dias })[0]?.daysPerWeek).toBe(dias);
  });

  it('CA-A1 también con nivel y equipamiento de gimnasio: los días pesan más', () => {
    // Un principiante de 7 días: la de 7 es intermedia, y aun así va arriba.
    // Tres puntos por los días frente a dos por el nivel (regla 7).
    for (let dias = 1; dias <= 7; dias += 1) {
      const primera = templatesFor({ daysPerWeek: dias, level: 'beginner', equipment: 'Máquinas de gimnasio' })[0];
      expect(primera?.daysPerWeek, `${dias} días`).toBe(dias);
    }
  });

  // R-A3: se listan todas, no se filtra.
  it('se siguen listando todas', () => {
    expect(templatesFor({ daysPerWeek: 2 })).toHaveLength(TEMPLATES.length);
  });

  // CA-A2
  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    'CA-A2: %s carga con sus propios días sin aviso de ajuste',
    (_id, template) => {
      const constraints = { daysPerWeek: template.daysPerWeek, hasLimitations: false };
      const result = validateDraft(applyTemplate(template, constraints), constraints);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.workout.warnings.some((w) => /se ajustaron los d[ií]as/i.test(w))).toBe(false);
    },
  );

  describe('CA-A3 — la de 7 días avisa al entrenador, no al cliente', () => {
    const sieteDias = TEMPLATES.find((t) => t.daysPerWeek === 7)!;
    const constraints = { daysPerWeek: 7, hasLimitations: false };

    it('tiene días de recuperación activa, no siete de fuerza', () => {
      const recuperacion = sieteDias.workout.days.filter((d) => /recuperaci[oó]n/i.test(d.focus));
      expect(recuperacion).toHaveLength(3);
    });

    it('el borrador lleva el aviso de recuperación', () => {
      const result = validateDraft(applyTemplate(sieteDias, constraints), constraints);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.workout.warnings.some((w) => /recuperaci[oó]n activa/i.test(w))).toBe(true);
    });

    it('el mensaje al cliente no lo incluye', () => {
      const result = validateDraft(applyTemplate(sieteDias, constraints), constraints);
      if (!result.ok) throw new Error('la plantilla de 7 días no valida');

      const texto = formatForClient(result.workout, { clientName: 'Ana', plan: null });
      expect(texto).not.toMatch(/descanso que necesita/i);
      expect(texto).not.toContain('⚠️');
    });

    it('con limitaciones, conserva los dos avisos', () => {
      const conLimitaciones = { daysPerWeek: 7, hasLimitations: true };
      const result = validateDraft(applyTemplate(sieteDias, conLimitaciones), conLimitaciones);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.workout.warnings).toHaveLength(2);
    });

    it('si se ajusta a otros días, el aviso de días va PRIMERO', () => {
      // Es el que explica por qué la rutina no se parece a la que se eligió.
      const cinco = { daysPerWeek: 5, hasLimitations: false };
      const result = validateDraft(applyTemplate(sieteDias, cinco), cinco);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.workout.warnings[0]).toMatch(/se ajustaron los d[ií]as/i);
    });
  });
});

// ---------------------------------------------------------------------------

describe('SPEC-028 — el equipamiento pesa más que los días', () => {
  // ┌─ EL BUG QUE ESTO CIERRA ──────────────────────────────────────────────┐
  // │ La plantilla de casa decía «Ninguno», que no es ninguna opción del    │
  // │ formulario. A un cliente con «Sin equipamiento» le salía primero una  │
  // │ de gimnasio. Los tests usaban «Ninguno» y no lo veían: estos usan los │
  // │ textos REALES del formulario.                                         │
  // └────────────────────────────────────────────────────────────────────────┘
  const primera = (equipment: string | undefined, daysPerWeek?: number) =>
    templatesFor({
      ...(equipment === undefined ? {} : { equipment }),
      ...(daysPerWeek === undefined ? {} : { daysPerWeek }),
      level: 'beginner',
    })[0]?.id;

  it('CA-1 · sin equipo y 3 días → la de peso corporal', () => {
    expect(primera('Sin equipamiento', 3)).toBe('home-bodyweight-3d');
  });

  it('CA-2 · sin equipo y 2 días → la de peso corporal, aunque sea de 3', () => {
    expect(primera('Sin equipamiento', 2)).toBe('home-bodyweight-3d');
  });

  it('CA-3 · mancuernas y bandas → la de mancuernas', () => {
    expect(primera('Mancuernas, Bandas elásticas', 3)).toBe('home-dumbbells-3d');
    expect(primera('Mancuernas, Bandas elásticas', 5)).toBe('home-dumbbells-3d');
  });

  it('CA-4 · solo bandas → la de bandas, y lo que no puede hacer va al final', () => {
    const orden = templatesFor({ equipment: 'Bandas elásticas', daysPerWeek: 2 });

    expect(orden[0]?.id).toBe('home-bands-3d');
    const primeraQueNoPuede = orden.findIndex((t) => t.equipment === 'gym' || t.equipment === 'free_weights');
    const ultimaQuePuede = orden.findLastIndex((t) => t.equipment === 'bands' || t.equipment === 'none');
    expect(ultimaQuePuede).toBeLessThan(primeraQueNoPuede);
  });

  it.each([1, 2, 3, 4, 5, 6, 7])('CA-5 · gimnasio y %i días → una de gimnasio de esos días', (dias) => {
    const [t] = templatesFor({ equipment: 'Máquinas de gimnasio', daysPerWeek: dias, level: 'beginner' });
    expect(t?.equipment).toBe('gym');
    expect(t?.daysPerWeek).toBe(dias);
  });

  it('con gimnasio, las de casa van detrás de las de gimnasio', () => {
    // Puede hacerlas, pero no es lo que tiene: primero las de su nivel.
    const orden = templatesFor({ equipment: 'Máquinas de gimnasio', daysPerWeek: 3, level: 'beginner' });
    expect(orden[0]?.id).toBe('full-body-3d');
    expect(orden.findIndex((t) => t.equipment !== 'gym')).toBe(
      orden.filter((t) => t.equipment === 'gym').length,
    );
  });

  it.each([
    ['solo «Otro»', 'Otro'],
    ['sin evaluación', undefined],
  ])('CA-6 · %s: el equipamiento no cuenta, solo días y nivel', (_caso, equipment) => {
    for (let dias = 1; dias <= 7; dias += 1) {
      expect(templatesFor({ ...(equipment === undefined ? {} : { equipment }), daysPerWeek: dias })[0]?.daysPerWeek).toBe(dias);
    }
  });

  it('CA-7 · «Sin equipamiento, Mancuernas» cuenta como mancuernas', () => {
    expect(primera('Sin equipamiento, Mancuernas', 3)).toBe('home-dumbbells-3d');
  });

  it.each([
    'Sin equipamiento',
    'Bandas elásticas',
    'Mancuernas',
    'Máquinas de gimnasio',
    'Otro',
  ])('CA-8 · con «%s» salen TODAS', (equipment) => {
    expect(templatesFor({ equipment, daysPerWeek: 4 })).toHaveLength(TEMPLATES.length);
  });

  it('CA-8 · el catálogo son las 10', () => {
    expect(TEMPLATES).toHaveLength(10);
  });

  // CA-9: las dos nuevas pasan por los `it.each` de arriba, que recorren
  // todas las plantillas con sus días y ajustadas de 1 a 7. Aquí, que existen.
  it.each(['home-dumbbells-3d', 'home-bands-3d'])('CA-9 · %s existe y es de 3 días', (id) => {
    expect(findTemplate(id)?.daysPerWeek).toBe(3);
  });
});
