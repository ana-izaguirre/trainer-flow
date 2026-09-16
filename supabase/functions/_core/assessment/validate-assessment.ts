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
    },
  };
}
