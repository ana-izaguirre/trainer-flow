/**
 * SPEC-001 — Validación de la evaluación del cliente.
 *
 * ┌─ DÓNDE ENCAJA ESTA CAPA ───────────────────────────────────────────────┐
 * │   Sobre de Tally  →  mapeo etiqueta→campo  →  ESTO  →  ParsedAssessment│
 * │   (_shared)          (configuración)          (_core)                  │
 * │                                                                        │
 * │ Este módulo NO sabe nada de Tally. Recibe campos ya extraídos. Por eso │
 * │ un cambio en el formulario no toca las reglas del dominio.            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Las restricciones son las mismas que los CHECK de la tabla `assessments`:
 * si divergen, la base rechazaría datos que aquí pasaron.
 */
import type { Level } from '../domain/assessment.ts';
import { LEVELS } from '../domain/assessment.ts';

export interface ParsedAssessment {
  readonly fullName: string;
  readonly goal: string;
  readonly level: Level;
  readonly daysPerWeek: number;
  readonly sessionMinutes: number;
  readonly equipment: string;
  readonly hasLimitations: boolean;
  /** Información de salud. Nunca se escribe en logs ni en mensajes de error. */
  readonly limitationsDetail: string | null;
  readonly lifestyle: string | null;
  readonly notes: string | null;

  // ── SPEC-016. Todos opcionales: un formulario viejo entra igual ─────────
  readonly gender: string | null;
  readonly age: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly lastWeighed: string | null;
  readonly quitReasons: string | null;
  readonly menopauseStage: string | null;
  /**
   * Enfermedades crónicas propias y de familia cercana.
   *
   * ┌─ ESTE CAMPO NO VIAJA AL PROVEEDOR DE IA ────────────────────────────┐
   * │ Traducir «diabetes tipo 2» en «intensidad moderada, sin series al   │
   * │ fallo» es criterio clínico: es el trabajo del entrenador y su       │
   * │ responsabilidad. Solo se le enseña a él, en la ficha 📄.            │
   * │                                                                     │
   * │ Hay un test en `prompt-builder.test.ts` que lo hace cumplir, porque │
   * │ una regla que solo vive en un comentario se rompe en el siguiente   │
   * │ PR (SPEC-016 §3.2).                                                 │
   * └─────────────────────────────────────────────────────────────────────┘
   */
  readonly chronicConditions: string | null;
  /** La fuente de verdad de la edad: una edad se queda vieja, una fecha no. */
  readonly birthDate: string | null;
  readonly medications: string | null;
  /** Condiciones de familiares. Factor de riesgo, no diagnóstico propio. */
  /** Los pesos que tiene, en sus palabras. Lo lee la IA. */
  readonly equipmentDetail: string | null;
}

export interface AssessmentError {
  readonly field: string;
  readonly message: string;
}

export type AssessmentResult =
  | { readonly ok: true; readonly value: ParsedAssessment }
  | { readonly ok: false; readonly errors: readonly AssessmentError[] };

export const ASSESSMENT_LIMITS = {
  name: 200,
  goal: 200,
  equipment: 200,
  /** SPEC-001 regla 7: el texto libre se trunca, no invalida la evaluación. */
  freeText: 2000,
  daysPerWeek: { min: 1, max: 7 },
  sessionMinutes: { min: 15, max: 180 },
  /** Rangos que atrapan un dedazo, no que juzguen a nadie. */
  age: { min: 10, max: 120 },
  weightKg: { min: 20, max: 400 },
  heightCm: { min: 80, max: 250 },
  /** El mismo rango que el CHECK de `assessments` (migración 0021). */
  birthDateYears: { min: 10, max: 120 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Errors {
  readonly list: AssessmentError[] = [];

  add(field: string, message: string): void {
    this.list.push({ field, message });
  }
}

/** Texto obligatorio: presente, no en blanco, dentro del límite. */
function readRequiredText(
  value: unknown,
  field: string,
  maxLength: number,
  errors: Errors,
): string | null {
  if (typeof value !== 'string') {
    errors.add(field, `Falta ${field}.`);
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    errors.add(field, `${field} no puede estar en blanco.`);
    return null;
  }
  if (trimmed.length > maxLength) {
    // Truncar un nombre produciría un cliente llamado "Carl": mejor fallar.
    errors.add(field, `${field} supera los ${maxLength} caracteres.`);
    return null;
  }

  return trimmed;
}

/** Texto libre opcional: se trunca en vez de invalidar la evaluación. */
function readFreeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  return trimmed.slice(0, ASSESSMENT_LIMITS.freeText);
}

/**
 * Entero dentro de rango.
 *
 * Acepta un número escrito como texto, porque un formulario web manda strings
 * y coercionar `"4"` es inequívoco. `"4 días"` no lo es, y se rechaza.
 */
function readInt(
  value: unknown,
  field: string,
  range: { readonly min: number; readonly max: number },
  errors: Errors,
): number | null {
  let parsed: number | null = null;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    parsed = Number.parseInt(value.trim(), 10);
  }

  if (parsed === null || !Number.isInteger(parsed)) {
    errors.add(field, `${field} debe ser un número entero.`);
    return null;
  }
  if (parsed < range.min || parsed > range.max) {
    errors.add(field, `${field} debe estar entre ${range.min} y ${range.max}.`);
    return null;
  }

  return parsed;
}

/**
 * Un número opcional. Acepta coma decimal: «78,5» y «78.5» son el mismo peso
 * (SPEC-016 regla 5).
 *
 * ┌─ FUERA DE RANGO SE DESCARTA, NO INVALIDA ──────────────────────────────┐
 * │ Estos campos son opcionales. Un «250» en la edad es un dedazo, y      │
 * │ tirar la evaluación entera por eso dejaría al cliente sin rutina por  │
 * │ un dato que ni siquiera hacía falta.                                  │
 * └────────────────────────────────────────────────────────────────────────┘
 */
function readOptionalNumber(
  value: unknown,
  range: { readonly min: number; readonly max: number },
  decimals = 0,
): number | null {
  let parsed: number | null = null;

  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    // La coma decimal primero: `Number()` la rechazaría.
    const limpio = value.trim().replace(',', '.');
    if (/^\d+(\.\d+)?$/.test(limpio)) parsed = Number(limpio);
  }

  if (parsed === null || !Number.isFinite(parsed)) return null;
  if (parsed < range.min || parsed > range.max) return null;

  return decimals === 0 ? Math.round(parsed) : Number(parsed.toFixed(decimals));
}

function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

/**
 * Hoy, menos `anios` años, en el mismo formato que usa el CHECK real:
 * `current_date - interval 'N years'`. Postgres, ante un 29 de febrero
 * cuyo año destino no es bisiesto, hace CLAMPING al 28 — nunca avanza al
 * mes siguiente. `Date.UTC` por sí solo no: interpretaría ese "día 29" como
 * un desborde y haría ROLLOVER al 1 de marzo. Sin este ajuste, el límite
 * calculado aquí se corre un día respecto al que aplica la base.
 */
function haceAnios(hoy: Date, anios: number): string {
  const anio = hoy.getUTCFullYear() - anios;
  const mes = hoy.getUTCMonth();
  const dia = hoy.getUTCDate();
  const diaAjustado = mes === 1 && dia === 29 && !esBisiesto(anio) ? 28 : dia;

  return new Date(Date.UTC(anio, mes, diaAjustado)).toISOString().slice(0, 10);
}

/**
 * Una fecha válida en el calendario no es una fecha plausible como
 * nacimiento. Mismo rango que el CHECK real de `assessments` (migración
 * 0021: entre hace 120 y hace 10 años) — si divergen, la base rechaza datos
 * que aquí pasaron, y antes de esto ese rechazo no avisaba a nadie: caía
 * como error transitorio en vez de como evaluación inválida.
 */
function isBirthDatePlausible(iso: string): boolean {
  const { min, max } = ASSESSMENT_LIMITS.birthDateYears;
  const hoy = new Date();
  const limiteReciente = haceAnios(hoy, min);
  const limiteAntiguo = haceAnios(hoy, max);

  return iso >= limiteAntiguo && iso <= limiteReciente;
}

/**
 * Una fecha en `AAAA-MM-DD`, que es lo que manda un campo de fecha de Tally.
 *
 * No se convierte a `Date`: viaja como texto hasta la base, que es quien tiene
 * el tipo `date`. Interpretarla aquí metería la zona horaria del servidor en
 * una fecha de nacimiento, y un 1 de enero se volvería 31 de diciembre.
 */
function readIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const limpio = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return null;

  // Que exista de verdad: `2026-02-31` cumple el patrón y no es un día.
  const fecha = new Date(`${limpio}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return null;
  if (fecha.toISOString().slice(0, 10) !== limpio) return null;

  if (!isBirthDatePlausible(limpio)) return null;

  return limpio;
}

export function validateAssessment(raw: unknown): AssessmentResult {
  const errors = new Errors();

  if (!isRecord(raw)) {
    return { ok: false, errors: [{ field: '_root', message: 'La evaluación debe ser un objeto.' }] };
  }

  const fullName = readRequiredText(raw['fullName'], 'fullName', ASSESSMENT_LIMITS.name, errors);
  const goal = readRequiredText(raw['goal'], 'goal', ASSESSMENT_LIMITS.goal, errors);
  const equipment = readRequiredText(
    raw['equipment'],
    'equipment',
    ASSESSMENT_LIMITS.equipment,
    errors,
  );

  // ── nivel ──
  const rawLevel = raw['level'];
  let level: Level | null = null;
  if (typeof rawLevel === 'string' && (LEVELS as readonly string[]).includes(rawLevel)) {
    level = rawLevel as Level;
  } else {
    errors.add('level', `level debe ser uno de: ${LEVELS.join(', ')}.`);
  }

  const daysPerWeek = readInt(
    raw['daysPerWeek'],
    'daysPerWeek',
    ASSESSMENT_LIMITS.daysPerWeek,
    errors,
  );
  const sessionMinutes = readInt(
    raw['sessionMinutes'],
    'sessionMinutes',
    ASSESSMENT_LIMITS.sessionMinutes,
    errors,
  );

  // ── limitaciones ──
  const rawHasLimitations = raw['hasLimitations'];
  let hasLimitations: boolean | null = null;
  if (typeof rawHasLimitations === 'boolean') {
    hasLimitations = rawHasLimitations;
  } else {
    // Normalizar "Sí"/"No" es tarea de la capa de mapeo, que sí conoce el
    // formulario. El mensaje NO incluye el valor recibido: podría venir de un
    // campo con información de salud.
    errors.add('hasLimitations', 'hasLimitations debe ser un booleano.');
  }

  if (
    fullName === null ||
    goal === null ||
    equipment === null ||
    level === null ||
    daysPerWeek === null ||
    sessionMinutes === null ||
    hasLimitations === null ||
    errors.list.length > 0
  ) {
    return { ok: false, errors: errors.list };
  }

  // Sin limitaciones declaradas no puede haber detalle: es el CHECK de la
  // tabla `assessments`. Se normaliza en vez de rechazar, porque un formulario
  // puede arrastrar el texto de una respuesta anterior.
  const limitationsDetail = hasLimitations ? readFreeText(raw['limitationsDetail']) : null;

  return {
    ok: true,
    value: {
      fullName,
      goal,
      level,
      daysPerWeek,
      sessionMinutes,
      equipment,
      hasLimitations,
      limitationsDetail,
      lifestyle: readFreeText(raw['lifestyle']),
      notes: readFreeText(raw['notes']),

      // SPEC-016. Ninguno puede invalidar la evaluación: si no llega o no se
      // entiende, queda en `null` y el entrenador lo ve vacío en la ficha.
      gender: readFreeText(raw['gender']),
      age: readOptionalNumber(raw['age'], ASSESSMENT_LIMITS.age),
      weightKg: readOptionalNumber(raw['weightKg'], ASSESSMENT_LIMITS.weightKg, 2),
      heightCm: readOptionalNumber(raw['heightCm'], ASSESSMENT_LIMITS.heightCm),
      lastWeighed: readFreeText(raw['lastWeighed']),
      quitReasons: readFreeText(raw['quitReasons']),
      menopauseStage: readFreeText(raw['menopauseStage']),
      chronicConditions: readFreeText(raw['chronicConditions']),
      birthDate: readIsoDate(raw['birthDate']),
      medications: readFreeText(raw['medications']),
      equipmentDetail: readFreeText(raw['equipmentDetail']),
    },
  };
}
