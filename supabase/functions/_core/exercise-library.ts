/**
 * SPEC-019 — Una referencia visual por ejercicio: el nombre se vuelve enlace.
 *
 * Son ENLACES, no imágenes (§2 de la spec): cero alojamiento, sin fetch —
 * es una tabla estática, igual que `templates.ts`.
 *
 * ┌─ COINCIDENCIA EXACTA O NADA (regla 1) ──────────────────────────────────┐
 * │ El slug se verificó a mano contra los 601 ejercicios reales de RepDB   │
 * │ (docs/specs/SPEC-019 §4). Un nombre que no está aquí cae a la búsqueda │
 * │ de YouTube (§3), nunca a un slug parecido: enseñar el ejercicio base   │
 * │ para una variante sería engañoso (§4 «Por qué una variante NO cae a su │
 * │ ejercicio base»).                                                       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Primero las plantillas (§6 de la spec): cobertura completa, riesgo cero.
 * La IA, con los 601 slugs y obligada a elegir uno o `null`, va después.
 */

const REPDB_BASE = 'https://exercise-dataset.com/exercise';

/**
 * Nombre EXACTO de `templates.ts` → slug de RepDB.
 *
 * «Remo con mancuerna» y «Remo inclinado con dos mancuernas» llevan slugs
 * DISTINTOS aunque se parezcan: el primero es a un brazo («12 por brazo» en
 * la plantilla), el segundo bilateral — son ejercicios distintos, no el
 * mismo con nombre repetido.
 */
export const TEMPLATE_EXERCISE_SLUGS: Readonly<Record<string, string>> = {
  'Aperturas en polea': 'cable-fly',
  Caminata: 'walking',
  'Caminata lateral con banda': 'banded-lateral-walk',
  'Curl con barra': 'barbell-curl',
  'Curl de bíceps': 'bicep-curl',
  'Curl femoral': 'leg-curl',
  'Curl martillo': 'hammer-curl',
  'Dominadas lastradas': 'weighted-pull-up',
  'Elevación de talones': 'standing-calf-raise',
  'Elevaciones laterales': 'lateral-raise',
  Escaladores: 'mountain-climbers',
  'Extensión de cuádriceps': 'leg-extension',
  'Extensión de tríceps en polea': 'tricep-pushdown',
  'Face pull': 'face-pull',
  Flexiones: 'push-up',
  'Flexiones inclinadas': 'incline-push-ups',
  'Fondos en paralelas': 'dips',
  'Fondos en silla': 'bench-dips',
  'Fondos lastrados': 'weighted-dips',
  'Jalón al pecho': 'lat-pulldown',
  'Peso muerto convencional': 'deadlift',
  'Peso muerto rumano': 'romanian-deadlift',
  'Peso muerto rumano con mancuernas': 'dumbbell-romanian-deadlift',
  'Plancha frontal': 'plank',
  'Plancha lateral': 'side-plank',
  'Prensa de piernas': 'leg-press',
  'Press de banca': 'bench-press',
  'Press de hombros con mancuernas': 'dumbbell-shoulder-press',
  'Press de hombros sentado': 'seated-db-press',
  'Press de pecho con mancuernas en el suelo': 'dumbbell-floor-press',
  'Press inclinado con mancuernas': 'incline-db-press',
  'Press militar': 'ohp',
  'Press militar con mancuernas': 'dumbbell-shoulder-press',
  'Puente de glúteo': 'glute-bridge',
  'Remo con barra': 'barbell-row',
  'Remo con mancuerna': 'single-arm-db-row',
  'Remo en polea baja': 'seated-cable-row',
  'Remo en punta': 't-bar-row',
  'Remo inclinado con dos mancuernas': 'bent-over-db-row',
  'Sentadilla búlgara': 'bulgarian-split-squat',
  'Sentadilla búlgara con mancuernas': 'bulgarian-split-squat',
  'Sentadilla con banda': 'banded-squat',
  'Sentadilla con barra': 'squat',
  'Sentadilla goblet': 'goblet-squat',
  'Sentadilla libre': 'bodyweight-squat',
  Superman: 'superman',
  Zancadas: 'lunge',
  'Zancadas con mancuernas': 'db-lunge',
};

/**
 * La búsqueda no la genera la IA: se arma con el nombre, así que no hay
 * nada que inventar y siempre devuelve algo relevante (§3 de la spec) — a
 * diferencia de pedirle un enlace de vídeo al modelo, que se inventa
 * identificadores con buena pinta que son 404 o apuntan a otra cosa.
 */
function searchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} ejercicio técnica`)}`;
}

/**
 * Reglas 2 y 3 de SPEC-019: coincidencia exacta o búsqueda — nunca sin
 * referencia, nunca un slug inventado.
 */
export function exerciseUrl(name: string): string {
  const slug = TEMPLATE_EXERCISE_SLUGS[name];
  return slug === undefined ? searchUrl(name) : `${REPDB_BASE}/${slug}/`;
}
