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
import { canDo, equipmentTier, type EquipmentTier } from './equipment.ts';
import type { WorkoutConstraints, WorkoutDraft } from './domain/draft.ts';
import type { Exercise, Workout, WorkoutDay } from './domain/workout.ts';

export interface WorkoutTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly daysPerWeek: number;
  readonly level: Level;
  /** El nivel de equipamiento que NECESITA (SPEC-028). */
  readonly equipment: EquipmentTier;
  readonly workout: Workout;
}

export interface TemplateCriteria {
  readonly daysPerWeek?: number;
  readonly level?: Level;
  /** El texto del formulario tal cual llega («Mancuernas, Banco»). */
  readonly equipment?: string;
}

/** Atajo para no repetir `notes: null` en cada ejercicio. */
function ex(name: string, sets: number, reps: string, restSeconds: number, notes: string | null = null): Exercise {
  return { name, sets, reps, restSeconds, notes };
}

// ---------------------------------------------------------------------------
// Días compartidos
// ---------------------------------------------------------------------------
//
// La de 7 días reutiliza las cuatro sesiones de fuerza de la de 5 (SPEC-008,
// ampliación). Son constantes y no copias: si el entrenador corrige una, la
// corrige en las dos.

const TORSO_FUERZA: WorkoutDay = {
  dayNumber: 1,
  focus: 'Torso — fuerza',
  exercises: [
    ex('Press de banca', 4, '6-8', 150),
    ex('Remo con barra', 4, '6-8', 150),
    ex('Press militar', 3, '8-10', 120),
    ex('Jalón al pecho', 3, '10-12', 90),
  ],
};

const PIERNA_FUERZA: WorkoutDay = {
  dayNumber: 2,
  focus: 'Pierna — fuerza',
  exercises: [
    ex('Sentadilla con barra', 4, '6-8', 180),
    ex('Peso muerto rumano', 3, '8-10', 150),
    ex('Prensa de piernas', 3, '10-12', 120),
    ex('Elevación de talones', 4, '12-15', 60),
  ],
};

const TORSO_VOLUMEN: WorkoutDay = {
  dayNumber: 4,
  focus: 'Torso — volumen',
  exercises: [
    ex('Press inclinado con mancuernas', 4, '10-12', 90),
    ex('Remo en polea baja', 4, '10-12', 90),
    ex('Aperturas en polea', 3, '12-15', 60),
    ex('Elevaciones laterales', 3, '12-15', 60),
    ex('Curl de bíceps', 3, '12-15', 60),
  ],
};

const PIERNA_VOLUMEN: WorkoutDay = {
  dayNumber: 5,
  focus: 'Pierna — volumen',
  exercises: [
    ex('Peso muerto convencional', 3, '5-6', 180),
    ex('Zancadas con mancuernas', 3, '10-12', 90),
    ex('Curl femoral', 3, '12-15', 60),
    ex('Extensión de cuádriceps', 3, '12-15', 60),
  ],
};

/** El mismo día con otro número: la posición cambia de una plantilla a otra. */
function asDay(day: WorkoutDay, dayNumber: number): WorkoutDay {
  return { ...day, dayNumber };
}

/**
 * Va en `warnings`, que es del entrenador: el mensaje al cliente no lo
 * muestra (SPEC-005 regla 5).
 */
const SEVEN_DAYS_NOTICE =
  'Siete días: los de recuperación activa son suaves a propósito. Si el cliente ' +
  'los convierte en entrenamiento intenso, pierde el descanso que necesita para progresar.';

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
    equipment: 'gym',
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
    equipment: 'gym',
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
    equipment: 'none',
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
    equipment: 'gym',
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

  // ── SPEC-008, ampliación: una por cada número de días que faltaba ──────
  // El formulario acepta de 1 a 7 días. `adaptDays` ajusta cualquiera, pero
  // el ajuste solo es bueno cerca del original.

  {
    id: 'full-body-1d',
    name: 'Cuerpo completo — 1 día',
    description: 'Una sesión que toca todos los grupos grandes. Con tan poca frecuencia, lo que cuenta es no saltarla.',
    daysPerWeek: 1,
    level: 'beginner',
    equipment: 'gym',
    workout: {
      summary: 'Una sesión de cuerpo completo por semana.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Cuerpo completo',
          exercises: [
            ex('Sentadilla con barra', 3, '8-10', 120, 'Baja hasta donde controles la postura'),
            ex('Press de banca', 3, '8-10', 90),
            ex('Remo con barra', 3, '10-12', 90),
            ex('Peso muerto rumano', 3, '8-10', 120),
            ex('Press militar con mancuernas', 2, '10-12', 90),
            ex('Plancha frontal', 3, '30 s', 60),
          ],
        },
      ],
    },
  },

  {
    id: 'full-body-2d',
    name: 'Cuerpo completo — 2 días',
    description: 'Cuerpo completo dos veces por semana. Para quien empieza con poco tiempo.',
    daysPerWeek: 2,
    level: 'beginner',
    equipment: 'gym',
    workout: {
      summary: 'Cuerpo completo dos veces por semana, con al menos un día de descanso entre sesiones.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Cuerpo completo A',
          exercises: [
            ex('Sentadilla con barra', 3, '8-10', 120),
            ex('Press de banca', 3, '8-10', 90),
            ex('Remo con barra', 3, '10-12', 90),
            ex('Elevaciones laterales', 2, '12-15', 60),
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
            ex('Zancadas con mancuernas', 2, '10 por pierna', 90),
            ex('Curl de bíceps', 2, '12-15', 60),
          ],
        },
      ],
    },
  },

  {
    id: 'upper-lower-full-5d',
    name: 'Torso / Pierna / Cuerpo completo — 5 días',
    description: 'Torso y pierna dos veces cada uno, con una sesión de cuerpo completo más ligera en medio.',
    daysPerWeek: 5,
    level: 'intermediate',
    equipment: 'gym',
    workout: {
      summary: 'Torso y pierna dos veces por semana, con un día ligero de cuerpo completo en medio.',
      warnings: [],
      days: [
        asDay(TORSO_FUERZA, 1),
        asDay(PIERNA_FUERZA, 2),
        {
          dayNumber: 3,
          focus: 'Cuerpo completo — ligero',
          exercises: [
            ex('Sentadilla goblet', 3, '12-15', 90),
            ex('Flexiones', 3, '10-15', 60),
            ex('Remo con mancuerna', 3, '12 por brazo', 60),
            ex('Face pull', 3, '15-20', 60, 'Cuida la postura del hombro'),
            ex('Plancha lateral', 3, '30 s por lado', 45),
          ],
        },
        asDay(TORSO_VOLUMEN, 4),
        asDay(PIERNA_VOLUMEN, 5),
      ],
    },
  },

  {
    id: 'strength-recovery-7d',
    name: 'Fuerza + recuperación activa — 7 días',
    description: 'Cuatro sesiones de fuerza y tres de recuperación activa. El descanso es parte del plan.',
    daysPerWeek: 7,
    level: 'intermediate',
    equipment: 'gym',
    workout: {
      summary:
        'Cuatro sesiones de fuerza y tres de recuperación activa. Siete días de entrenamiento ' +
        'intenso no dejan progresar: el descanso es parte del plan.',
      warnings: [SEVEN_DAYS_NOTICE],
      days: [
        asDay(TORSO_FUERZA, 1),
        asDay(PIERNA_FUERZA, 2),
        {
          dayNumber: 3,
          focus: 'Recuperación activa',
          exercises: [
            ex('Caminata', 1, '30-40 min', 0, 'A un ritmo que te permita conversar'),
            ex('Movilidad de cadera', 2, '10 por lado', 30),
            ex('Movilidad de hombros', 2, '10', 30),
            ex('Estiramientos generales', 1, '10 min', 0),
          ],
        },
        asDay(TORSO_VOLUMEN, 4),
        asDay(PIERNA_VOLUMEN, 5),
        {
          dayNumber: 6,
          focus: 'Recuperación activa',
          exercises: [
            ex('Bicicleta o elíptica suave', 1, '20-30 min', 0),
            ex('Puente de glúteo', 3, '15', 45),
            ex('Plancha frontal', 3, '30 s', 45),
            ex('Movilidad torácica', 2, '10', 30),
          ],
        },
        {
          dayNumber: 7,
          focus: 'Recuperación activa',
          exercises: [
            ex('Caminata', 1, '30-40 min', 0),
            ex('Estiramientos generales', 1, '15 min', 0),
          ],
        },
      ],
    },
  },

  // ── SPEC-028: en casa, con material ────────────────────────────────────
  // Solo de 3 días: con el equipamiento pesando más que los días, `adaptDays`
  // las lleva a los que pida el cliente. Una por combinación serían 28.

  {
    id: 'home-dumbbells-3d',
    name: 'En casa, con mancuernas — 3 días',
    description: 'Cuerpo completo con mancuernas. Sirve también con kettlebell o barra.',
    daysPerWeek: 3,
    level: 'beginner',
    equipment: 'free_weights',
    workout: {
      summary: 'Cuerpo completo tres veces por semana, en casa, con mancuernas.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Cuerpo completo A',
          exercises: [
            ex('Sentadilla goblet', 3, '10-12', 90, 'Si usas kettlebell o barra, cambia por el equivalente'),
            ex('Press de pecho con mancuernas en el suelo', 3, '10-12', 90),
            ex('Remo con mancuerna', 3, '10-12 por brazo', 60),
            ex('Plancha frontal', 3, '30 s', 45),
          ],
        },
        {
          dayNumber: 2,
          focus: 'Cuerpo completo B',
          exercises: [
            ex('Peso muerto rumano con mancuernas', 3, '10-12', 90),
            ex('Press de hombros con mancuernas', 3, '10-12', 90),
            ex('Zancadas con mancuernas', 3, '10 por pierna', 90),
            ex('Curl de bíceps', 2, '12-15', 60),
          ],
        },
        {
          dayNumber: 3,
          focus: 'Cuerpo completo C',
          exercises: [
            ex('Sentadilla búlgara con mancuernas', 3, '8-10 por pierna', 90),
            ex('Flexiones', 3, '10-15', 60),
            ex('Remo inclinado con dos mancuernas', 3, '10-12', 60),
            ex('Puente de glúteo con mancuerna', 3, '12-15', 60),
          ],
        },
      ],
    },
  },

  {
    id: 'home-bands-3d',
    name: 'En casa, con bandas — 3 días',
    description: 'Cuerpo completo con bandas elásticas y peso corporal.',
    daysPerWeek: 3,
    level: 'beginner',
    equipment: 'bands',
    workout: {
      summary: 'Cuerpo completo tres veces por semana, con bandas elásticas y peso corporal.',
      warnings: [],
      days: [
        {
          dayNumber: 1,
          focus: 'Cuerpo completo A',
          exercises: [
            ex('Sentadilla con banda', 3, '12-15', 60, 'Elige una banda que te deje terminar las repeticiones con buena técnica'),
            ex('Flexiones', 3, '10-15', 60),
            ex('Remo con banda', 3, '12-15', 60),
            ex('Plancha frontal', 3, '30 s', 45),
          ],
        },
        {
          dayNumber: 2,
          focus: 'Cuerpo completo B',
          exercises: [
            ex('Puente de glúteo con banda', 3, '15', 45),
            ex('Press de hombros con banda', 3, '12-15', 60),
            ex('Jalón con banda', 3, '12-15', 60),
            ex('Caminata lateral con banda', 3, '12 por lado', 45),
          ],
        },
        {
          dayNumber: 3,
          focus: 'Cuerpo completo C',
          exercises: [
            ex('Zancadas', 3, '10 por pierna', 60),
            ex('Aperturas con banda', 3, '12-15', 60),
            ex('Face pull con banda', 3, '15-20', 45, 'Cuida la postura del hombro'),
            ex('Pallof press con banda', 3, '10 por lado', 45),
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

/**
 * Las plantillas ordenadas por cuánto encajan con lo que pidió el cliente.
 *
 * **Ordena, no filtra.** Si filtrara, un cliente con criterios poco comunes se
 * quedaría sin ninguna opción justo cuando la IA acaba de fallar, que es
 * exactamente el momento en que las plantillas tienen que estar ahí.
 *
 * ┌─ EL ORDEN (SPEC-028 regla 1) ──────────────────────────────────────────┐
 * │ 1. Las que PUEDE hacer con su equipo                                   │
 * │ 2. Entre esas, las de SU nivel: con gimnasio, primero las de gimnasio  │
 * │ 3. Los días exactos                                                    │
 * │ 4. El nivel de experiencia                                             │
 * │                                                                        │
 * │ El equipamiento va antes que los días porque un ejercicio que no se    │
 * │ puede hacer es peor que un número de días distinto, y eso último ya lo │
 * │ ajusta `adaptDays`. Cada criterio pesa más que la suma de los de       │
 * │ abajo, así que el orden es estricto.                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Con el equipamiento desconocido (sin evaluación, o solo «Otro»), los dos
 * primeros no cuentan.
 */
export function templatesFor(criteria: TemplateCriteria): readonly WorkoutTemplate[] {
  const cliente = equipmentTier(criteria.equipment);

  const score = (template: WorkoutTemplate): number => {
    let points = 0;
    if (cliente !== null && canDo(cliente, template.equipment)) points += 8;
    if (cliente !== null && cliente === template.equipment) points += 4;
    if (criteria.daysPerWeek !== undefined && template.daysPerWeek === criteria.daysPerWeek) {
      points += 2;
    }
    if (criteria.level !== undefined && template.level === criteria.level) points += 1;
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

function daysAdaptedNotice(from: number, to: number): string {
  return (
    `Revisar: esta plantilla es de ${from} días y el cliente pidió ${to}. ` +
    'Se ajustaron los días; comprueba que el reparto tenga sentido antes de aprobar.'
  );
}

/**
 * Los días de la plantilla, ajustados a los que el cliente pidió.
 *
 * ┌─ POR QUÉ EN CICLO ─────────────────────────────────────────────────────┐
 * │ Con menos días se toman los primeros; con más se vuelve a empezar. Es  │
 * │ como se usa una plantilla de verdad: «cuerpo completo 3×» a dos días   │
 * │ son dos de esos tres.                                                  │
 * │                                                                         │
 * │ Sin esto, la regla 7 mentía. Las cuatro plantillas originales eran de │
 * │ 3, 4, 3 y 6 días y `validateDraft` los exige exactos: un cliente de 2  │
 * │ días veía las cuatro opciones y NINGUNA cargaba.                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Hoy hay una plantilla para cada número de días (SPEC-008, ampliación), así
 * que esto solo actúa cuando el entrenador elige una de otro número.
 */
export function adaptDays(days: readonly WorkoutDay[], target: number): readonly WorkoutDay[] {
  // `%` sobre una lista vacía da NaN. Ninguna plantilla llega así, pero de
  // esto depende que el borrador sea cargable: no se apoya en un invariante.
  if (days.length === 0) return [];

  return Array.from({ length: target }, (_, index) => {
    const day = days[index % days.length] as WorkoutDay;
    return { ...day, dayNumber: index + 1 };
  });
}

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
  const original = template.workout.days;
  const days =
    constraints === null || constraints.daysPerWeek === original.length
      ? original
      : adaptDays(original, constraints.daysPerWeek);

  // El aviso de días va PRIMERO, incluso antes de los de la propia
  // plantilla: es el que explica por qué la rutina no se parece a la que el
  // entrenador eligió.
  const warnings = [
    ...(days.length === original.length ? [] : [daysAdaptedNotice(original.length, days.length)]),
    ...template.workout.warnings,
  ];
  if (constraints?.hasLimitations === true) warnings.push(LIMITATIONS_NOTICE);

  const workout: Workout = { ...template.workout, days, warnings };

  return { source: 'template', raw: workout };
}
