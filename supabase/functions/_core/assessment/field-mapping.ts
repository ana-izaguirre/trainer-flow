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
  /**
   * El valor es un número escondido en el texto de una opción: un formulario
   * no ofrece «60», ofrece «60 minutos».
   *
   * Sin número en la respuesta el campo **se omite**, y la validación falla
   * diciendo qué falta. Es lo que queremos: si la pregunta de tiempo por
   * sesión trae mezclada una opción de estilo de vida, «Sedentario» no puede
   * colarse como si fuera una duración.
   */
  readonly numeric?: boolean;
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

/**
 * El primer entero que aparece en el texto.
 *
 * En un rango se queda con el extremo bajo (`"45-60 min"` → `45`): prometer
 * menos tiempo del que el cliente tiene es seguro; prometer más produce una
 * rutina que no le cabe en el día.
 */
function firstInteger(text: string | null): number | null {
  if (text === null) return null;

  const match = /-?\d+/.exec(text);
  return match === null ? null : Number.parseInt(match[0], 10);
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

    if (target.rule.numeric === true) {
      const parsed = firstInteger(text);
      // Una respuesta sin número se omite igual que una ausente: no hay valor
      // que inventar, y la validación dirá cuál falta.
      if (parsed !== null) result[target.domainField] = parsed;
      continue;
    }

    // Un valor vacío no pisa uno que ya se había resuelto, y tampoco crea la
    // clave: la ausencia se representa omitiendo el campo.
    if (text === null) continue;

    // Todo lo demás sale como texto, incluido un número o un booleano que
    // llegue del formulario. Quien necesite el número lo declara con
    // `numeric: true`: tener dos caminos para eso es lo que hacía ambiguo el
    // tipo del resultado.
    result[target.domainField] = text;
  }

  return result;
}
