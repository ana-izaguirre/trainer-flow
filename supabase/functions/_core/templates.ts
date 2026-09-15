/**
 * Plantillas de rutina predefinidas.
 *
 * ┌─ POR QUÉ VIVEN EN CÓDIGO Y NO EN LA BASE DE DATOS ─────────────────────┐
 * │ Son la garantía de que la IA no es punto único de fallo. Si el         │
 * │ proveedor se cae o se agota la cuota, el entrenador carga una          │
 * │ plantilla y sigue trabajando. Estando en el binario funcionan aunque   │
 * │ la base de datos esté degradada: cero migración, cero consulta.        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Son un PUNTO DE PARTIDA, no una prescripción. El entrenador las edita antes
 * de aprobar, igual que haría con una propuesta de la IA.
 */
import type { Level } from './domain/assessment.ts';
import type { WorkoutConstraints, WorkoutDraft } from './domain/draft.ts';
import type { Exercise, Workout } from './domain/workout.ts';

export interface WorkoutTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly daysPerWeek: number;
  readonly level: Level;
  readonly equipment: string;
  readonly workout: Workout;
}

export interface TemplateCriteria {
  readonly daysPerWeek?: number;
  readonly level?: Level;
  readonly equipment?: string;
}

/** Atajo para no repetir `notes: null` en cada ejercicio. */
function ex(name: string, sets: number, reps: string, restSeconds: number, notes: string | null = null): Exercise {
  return { name, sets, reps, restSeconds, notes };
}

// ---------------------------------------------------------------------------
// El catálogo
// ---------------------------------------------------------------------------

export const TEMPLATES: readonly WorkoutTemplate[] = [
  {
    id: 'full-body-3d',
    name: 'Cuerpo completo — 3 días',
    description: 'Trabaja todo el cuerpo en cada sesión. Buen punto de partida para empezar.',
    daysPerWeek: 3,
    level: 'beginner',
    equipment: 'Gimnasio',
    workout: {
      summary: 'Cuerpo completo tres veces por semana, con un día de descanso entre sesiones.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Cuerpo completo A',
          exercises: [
            ex('Sentadilla con barra', 3, '8-10', 120, 'Baja hasta donde controles la postura'),
            ex('Press de banca', 3, '8-10', 90),
            ex('Remo con barra', 3, '10-12', 90),
            ex('Plancha frontal', 3, '30 s', 60),
          ],
        },
        {
          dayNumber: 2,
          focus: 'Cuerpo completo B',
          exercises: [
            ex('Peso muerto rumano', 3, '8-10', 120),
            ex('Press militar con mancuernas', 3, '10-12', 90),
            ex('Jalón al pecho', 3, '10-12', 90),
            ex('Curl de bíceps', 2, '12-15', 60),
          ],
        },
        {
          dayNumber: 3,
          focus: 'Cuerpo completo C',
          exercises: [
            ex('Prensa de piernas', 3, '10-12', 120),
            ex('Press inclinado con mancuernas', 3, '10-12', 90),
            ex('Remo en polea baja', 3, '10-12', 90),
            ex('Elevaciones laterales', 3, '12-15', 60),
          ],
        },
      ],
    },
  },

  {
    id: 'upper-lower-4d',
    name: 'Torso / Pierna — 4 días',
    description: 'Dos sesiones de torso y dos de pierna. El reparto más común a nivel intermedio.',
    daysPerWeek: 4,
    level: 'intermediate',
    equipment: 'Gimnasio',
    workout: {
      summary: 'Torso y pierna alternados, cuatro sesiones por semana.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Torso — fuerza',
          exercises: [
            ex('Press de banca', 4, '6-8', 150),
            ex('Remo con barra', 4, '6-8', 150),
            ex('Press militar', 3, '8-10', 120),
            ex('Jalón al pecho', 3, '10-12', 90),
            ex('Fondos en paralelas', 3, '8-10', 90),
          ],
        },
        {
          dayNumber: 2,
          focus: 'Pierna — fuerza',
          exercises: [
            ex('Sentadilla con barra', 4, '6-8', 180),
            ex('Peso muerto rumano', 3, '8-10', 150),
            ex('Prensa de piernas', 3, '10-12', 120),
            ex('Elevación de talones', 4, '12-15', 60),
          ],
        },
        {
          dayNumber: 3,
          focus: 'Torso — volumen',
          exercises: [
            ex('Press inclinado con mancuernas', 4, '10-12', 90),
            ex('Remo en punta', 4, '10-12', 90),
            ex('Aperturas en polea', 3, '12-15', 60),
            ex('Face pull', 3, '15-20', 60, 'Cuida la postura del hombro'),
            ex('Curl de bíceps', 3, '12-15', 60),
          ],
        },
        {
          dayNumber: 4,
          focus: 'Pierna — volumen',
          exercises: [
            ex('Peso muerto convencional', 3, '5-6', 180),
            ex('Zancadas con mancuernas', 3, '10-12', 90),
            ex('Curl femoral', 3, '12-15', 60),
            ex('Extensión de cuádriceps', 3, '12-15', 60),
          ],
        },
      ],
    },
  },

  {
    id: 'home-bodyweight-3d',
    name: 'En casa, sin equipo — 3 días',
    description: 'Solo peso corporal. No hace falta nada de material.',
    daysPerWeek: 3,
    level: 'beginner',
    equipment: 'Ninguno',
    workout: {
      summary: 'Tres sesiones de peso corporal, sin ningún equipamiento.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Tren inferior y core',
          exercises: [
            ex('Sentadilla libre', 3, '15-20', 60),
            ex('Puente de glúteo', 3, '15-20', 45),
            ex('Plancha frontal', 3, '30 s', 45),
            ex('Elevación de talones', 3, '20', 45),
          ],
        },
        {
          dayNumber: 2,
          focus: 'Tren superior',
          exercises: [
            ex('Flexiones', 3, 'al fallo', 90, 'Apoya las rodillas si hace falta'),
            ex('Flexiones inclinadas', 3, '10-15', 60),
            ex('Superman', 3, '12-15', 45),
            ex('Fondos en silla', 3, '10-12', 60),
          ],
        },
        {
          dayNumber: 3,
          focus: 'Cuerpo completo',
          exercises: [
            ex('Zancadas alternas', 3, '12 por pierna', 60),
            ex('Sentadilla búlgara', 3, '10 por pierna', 60),
            ex('Plancha lateral', 3, '20 s por lado', 45),
            ex('Escaladores', 3, '30 s', 45),
          ],
        },
      ],
    },
  },

  {
    id: 'push-pull-legs-6d',
    name: 'Empuje / Tirón / Pierna — 6 días',
    description: 'Alto volumen, seis sesiones. Para quien ya entrena con constancia.',
    daysPerWeek: 6,
    level: 'advanced',
    equipment: 'Gimnasio',
    workout: {
      summary: 'Empuje, tirón y pierna, dos veces cada uno por semana.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Empuje — fuerza',
          exercises: [
            ex('Press de banca', 5, '5', 180),
            ex('Press militar', 4, '6-8', 150),
            ex('Fondos lastrados', 3, '8-10', 120),
            ex('Elevaciones laterales', 4, '12-15', 60),
          ],
        },
        {
          dayNumber: 2,
          focus: 'Tirón — fuerza',
          exercises: [
            ex('Dominadas lastradas', 4, '6-8', 150),
            ex('Remo con barra', 4, '6-8', 150),
            ex('Remo en polea baja', 3, '10-12', 90),
            ex('Curl con barra', 3, '10-12', 60),
          ],
        },
        {
          dayNumber: 3,
          focus: 'Pierna — fuerza',
          exercises: [
            ex('Sentadilla con barra', 5, '5', 210),
            ex('Peso muerto rumano', 4, '8-10', 150),
            ex('Prensa de piernas', 3, '10-12', 120),
            ex('Elevación de talones', 4, '15', 60),
          ],
        },
        {
          dayNumber: 4,
          focus: 'Empuje — volumen',
          exercises: [
            ex('Press inclinado con mancuernas', 4, '10-12', 90),
            ex('Press de hombros sentado', 4, '10-12', 90),
            ex('Aperturas en polea', 3, '12-15', 60),
            ex('Extensión de tríceps en polea', 4, '12-15', 60),
          ],
        },
        {
          dayNumber: 5,
          focus: 'Tirón — volumen',
          exercises: [
            ex('Jalón al pecho', 4, '10-12', 90),
            ex('Remo en punta', 4, '10-12', 90),
            ex('Face pull', 4, '15-20', 60),
            ex('Curl martillo', 3, '12-15', 60),
          ],
        },
        {
          dayNumber: 6,
          focus: 'Pierna — volumen',
          exercises: [
            ex('Peso muerto convencional', 4, '6', 210),
            ex('Zancadas con mancuernas', 3, '12 por pierna', 90),
            ex('Curl femoral', 4, '12-15', 60),
            ex('Extensión de cuádriceps', 4, '12-15', 60),
          ],
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export function findTemplate(id: string): WorkoutTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/** Minúsculas y sin acentos, para comparar textos que escribe una persona. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function equipmentMatches(templateEquipment: string, clientEquipment: string): boolean {
  const a = normalize(templateEquipment);
  const b = normalize(clientEquipment);
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Las plantillas ordenadas por cuánto encajan con lo que pidió el cliente.
 *
 * **Ordena, no filtra.** Si filtrara, un cliente con criterios poco comunes se
 * quedaría sin ninguna opción justo cuando la IA acaba de fallar, que es
 * exactamente el momento en que las plantillas tienen que estar ahí.
 */
export function templatesFor(criteria: TemplateCriteria): readonly WorkoutTemplate[] {
  const score = (template: WorkoutTemplate): number => {
    let points = 0;
    if (criteria.daysPerWeek !== undefined && template.daysPerWeek === criteria.daysPerWeek) {
      points += 3;
    }
    if (criteria.level !== undefined && template.level === criteria.level) {
      points += 2;
    }
    if (criteria.equipment !== undefined && equipmentMatches(template.equipment, criteria.equipment)) {
      points += 1;
    }
    return points;
  };

  return TEMPLATES.toSorted((a, b) => score(b) - score(a));
}

// ---------------------------------------------------------------------------
// Aplicación
// ---------------------------------------------------------------------------

const LIMITATIONS_NOTICE =
  'Revisar: el cliente declaró limitaciones y esta plantilla no las contempla. ' +
  'Ajusta o sustituye los ejercicios afectados antes de aprobar.';

/**
 * Convierte una plantilla en un borrador listo para el editor.
 *
 * Si el cliente declaró limitaciones, inyecta un aviso. Una plantilla no sabe
 * nada del hombro de nadie: el aviso hace que el borrador pase la misma
 * validación que exigimos a la IA, y deja el recordatorio a la vista del
 * entrenador. **El criterio de qué ajustar sigue siendo suyo.**
 */
export function applyTemplate(
  template: WorkoutTemplate,
  constraints: WorkoutConstraints | null,
): WorkoutDraft {
  const needsNotice = constraints?.hasLimitations === true;

  const workout: Workout = {
    ...template.workout,
    warnings: needsNotice
      ? [...template.workout.warnings, LIMITATIONS_NOTICE]
      : [...template.workout.warnings],
  };

  return { source: 'template', raw: workout };
}
