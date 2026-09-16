/**
 * SPEC-001 — Del formulario al dominio.
 *
 * Un formulario devuelve respuestas etiquetadas con el texto de la pregunta;
 * el dominio espera campos con nombre propio. La correspondencia entre unas y
 * otros es **configuración**, no código: cambiar una pregunta no debería
 * significar tocar el parser.
 *
 * ┌─ UN DESCONOCIDO, MANEJADO ─────────────────────────────────────────────┐
 * │ En una pregunta de selección, el valor puede venir como el texto de la │
 * │ opción o como su identificador. En vez de suponer cuál, se soportan    │
 * │ los dos: si el valor coincide con el id de una opción, se resuelve; si │
 * │ no, se usa tal cual. Ambos casos están cubiertos por tests.            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Este módulo no valida nada. Solo traduce. La validación es el paso
 * siguiente, en `validate-assessment.ts`.
 */

export interface FormOption {
  readonly id: string;
  readonly text: string;
}

/** Una respuesta tal como la devuelve el formulario. */
export interface FormField {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly value: unknown;
  readonly options?: readonly FormOption[];
}

export interface FieldRule {
  /** El texto de la pregunta, tal cual aparece en el formulario. */
  readonly label: string;
  /**
   * Textos que significan «sí». Si está presente, el campo se convierte a
   * booleano; si no, se deja como texto.
   */
  readonly trueWhen?: readonly string[];
}

/** Qué pregunta alimenta cada campo del dominio. */
export type FieldMapping = Readonly<Record<string, FieldRule>>;

/** Minúsculas, sin acentos y sin espacios sobrantes. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convierte el valor crudo en texto, resolviendo identificadores de opción.
 *
 * Devuelve `null` cuando no hay respuesta, para distinguir «no contestó» de
 * «contestó algo vacío».
 */
function toText(value: unknown, options: readonly FormOption[] | undefined): string | null {
  const resolve = (item: unknown): string | null => {
    if (item === null || item === undefined) return null;

    const asText = typeof item === 'string' ? item : String(item);
    if (asText.length === 0) return null;

    const match = options?.find((option) => option.id === asText);
    return match?.text ?? asText;
  };

  if (Array.isArray(value)) {
    const parts = value.map(resolve).filter((part): part is string => part !== null);
    return parts.length === 0 ? null : parts.join(', ');
  }

  return resolve(value);
}

function isFormField(value: unknown): value is FormField {
  return isRecord(value) && typeof value['label'] === 'string';
}

/**
 * Aplica el mapeo y devuelve un objeto plano listo para `validateAssessment`.
 *
 * Los campos sin respuesta se **omiten** en vez de quedar en `null`: así la
 * validación distingue «no contestó» de «contestó algo inválido».
 */
export function mapFormFields(
  fields: readonly FormField[],
  mapping: FieldMapping,
): Record<string, unknown> {
  // Índice por etiqueta normalizada, para no recorrer el mapeo por cada campo.
  const byLabel = new Map<string, { domainField: string; rule: FieldRule }>();
  for (const [domainField, rule] of Object.entries(mapping)) {
    byLabel.set(normalize(rule.label), { domainField, rule });
  }

  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (!isFormField(field)) continue;

    const target = byLabel.get(normalize(field.label));
    if (target === undefined) continue;

    const text = toText(field.value, field.options);

    if (target.rule.trueWhen !== undefined) {
      // Una pregunta sí/no sin respuesta es «no», no «sin contestar»: en el
      // dominio `hasLimitations` no admite ausencia.
      if (typeof field.value === 'boolean') {
        result[target.domainField] = field.value;
        continue;
      }

      const affirmatives = target.rule.trueWhen.map(normalize);
      result[target.domainField] = text !== null && affirmatives.includes(normalize(text));
      continue;
    }

    // Un valor vacío no pisa uno que ya se había resuelto, y tampoco crea la
    // clave: la ausencia se representa omitiendo el campo.
    if (text === null) continue;

    // El cero y el false llegan aquí como texto y se conservan: solo se
    // descarta la ausencia real.
    result[target.domainField] =
      typeof field.value === 'number' || typeof field.value === 'boolean' ? field.value : text;
  }

  return result;
}
