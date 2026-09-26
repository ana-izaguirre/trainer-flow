/**
 * SPEC-028 §4 — Qué puede hacer un cliente con el equipo que tiene.
 *
 * ┌─ POR QUÉ NIVELES Y NO COMPARAR TEXTOS ─────────────────────────────────┐
 * │ Antes se comparaba el texto del formulario con el de cada plantilla.   │
 * │ La de casa decía «Ninguno», que no es ninguna opción del formulario    │
 * │ («Sin equipamiento»), así que NUNCA encajaba: a un cliente sin equipo  │
 * │ le salía primero una rutina de gimnasio.                               │
 * │                                                                        │
 * │ Ahora cada opción da un nivel, y cada plantilla dice el que necesita.  │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/** De menos a más. Quien tiene un nivel puede hacer los de abajo. */
export const EQUIPMENT_TIERS = ['none', 'bands', 'free_weights', 'gym'] as const;

export type EquipmentTier = (typeof EQUIPMENT_TIERS)[number];

/**
 * Las opciones del formulario de Tally, con su texto exacto. Si Ana renombra
 * una, `equipment.test.ts` se pone en rojo: la opción renombrada dejaría de
 * dar nivel sin que nada fallara.
 */
export const FORM_OPTIONS = [
  'Sin equipamiento',
  'Mancuernas',
  'Barra y discos',
  'Bandas elásticas',
  'Banco',
  'Kettlebell',
  'Máquinas de gimnasio',
  'Cardio (cinta, bicicleta, elíptica, etc.)',
  'Otro',
] as const;

/**
 * Qué nivel da cada opción. Banco y Cardio no alcanzan para una rutina de
 * fuerza por sí solos: dan `none`, pero sí dicen que el cliente contestó.
 * «Otro» no está: no dice nada que se pueda usar.
 */
const TIER_BY_OPTION: readonly (readonly [string, EquipmentTier])[] = [
  ['maquinas de gimnasio', 'gym'],
  ['mancuernas', 'free_weights'],
  ['barra y discos', 'free_weights'],
  ['kettlebell', 'free_weights'],
  ['bandas elasticas', 'bands'],
  ['sin equipamiento', 'none'],
  ['banco', 'none'],
  ['cardio', 'none'],
];

/** Minúsculas y sin tildes, para comparar textos que escribe una persona. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * El nivel MÁS ALTO de lo que marcó el cliente, o `null` si no se sabe (sin
 * evaluación, vacío, o solo «Otro»).
 *
 * Se busca cada opción dentro del texto en vez de partirlo por comas: la de
 * cardio lleva comas dentro («cinta, bicicleta, elíptica, etc.»).
 */
export function equipmentTier(raw: string | null | undefined): EquipmentTier | null {
  if (raw === null || raw === undefined) return null;
  const texto = normalizeText(raw);

  const niveles = TIER_BY_OPTION.filter(([opcion]) => texto.includes(opcion)).map(
    ([, nivel]) => EQUIPMENT_TIERS.indexOf(nivel),
  );

  return niveles.length === 0 ? null : (EQUIPMENT_TIERS[Math.max(...niveles)] as EquipmentTier);
}

/** ¿Puede un cliente con `client` hacer una plantilla que necesita `required`? */
export function canDo(client: EquipmentTier, required: EquipmentTier): boolean {
  return EQUIPMENT_TIERS.indexOf(client) >= EQUIPMENT_TIERS.indexOf(required);
}
