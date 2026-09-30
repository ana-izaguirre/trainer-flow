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
 * Primero las plantillas (§6, revisada): cobertura completa, riesgo cero,
 * con matices hechos a mano que RepDB no distingue por nombre (más abajo).
 * Si ahí no está, se cae al diccionario ampliado de los 601 ejercicios
 * reales de RepDB (`repdb-exercises.ts`) — así un ejercicio que nombra la
 * IA también puede matchear, sin enum, sin campo nuevo en el dominio, sin
 * llamada extra al proveedor: comparación de strings, local y posterior a
 * la generación.
 */
import { REPDB_EXERCISE_SLUGS } from './repdb-exercises.ts';

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
 * `REPDB_EXERCISE_SLUGS` por nombre en minúsculas: el `name_es` de RepDB
 * no sigue un único estilo de mayúsculas (repdb-exercises.ts), y nada
 * garantiza cómo capitaliza el nombre quien genera la rutina. Se
 * construye una sola vez, al cargar el módulo — la búsqueda en
 * `exerciseUrl` queda en O(1), no en un recorrido de las 601 entradas.
 */
const REPDB_SLUGS_BY_LOWER_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(REPDB_EXERCISE_SLUGS).map(([name, slug]) => [name.toLowerCase(), slug]),
);

/**
 * Reglas 2 y 3 de SPEC-019: coincidencia exacta o búsqueda — nunca sin
 * referencia, nunca un slug inventado.
 *
 * Primero `TEMPLATE_EXERCISE_SLUGS`, exacto y sensible a mayúsculas: sus
 * 48 entradas son una decisión hecha a mano (el unilateral/bilateral de
 * «Remo con mancuerna» vs «Remo inclinado con dos mancuernas», por
 * ejemplo) que debe ganar siempre, incluso si RepDB cambiara ese slug
 * algún día. Si el nombre no está ahí, se cae al diccionario ampliado de
 * RepDB, sin distinguir mayúsculas de minúsculas.
 */
export function exerciseUrl(name: string): string {
  const slug =
    TEMPLATE_EXERCISE_SLUGS[name] !== undefined
      ? TEMPLATE_EXERCISE_SLUGS[name]
      : REPDB_SLUGS_BY_LOWER_NAME.get(name.toLowerCase());
  return slug === undefined ? searchUrl(name) : `${REPDB_BASE}/${slug}/`;
}
