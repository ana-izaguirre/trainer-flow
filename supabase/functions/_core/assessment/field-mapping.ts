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
  /**
   * El texto de la pregunta, tal cual aparece en el formulario.
   *
   * ┌─ VARIAS PREGUNTAS, UN SOLO CAMPO ──────────────────────────────────┐
   * │ Una lista de etiquetas une las respuestas en un texto, en el orden │
   * │ en que el formulario las manda. «Lesiones» pregunta DOS veces —qué │
   * │ parte del cuerpo, y luego qué debemos tener en cuenta—, y las dos  │
   * │ son el mismo dato del dominio.                                     │
   * └────────────────────────────────────────────────────────────────────┘
   */
  readonly label: string | readonly string[];
  /**
   * La pregunta solo se le muestra a algunas personas.
   *
   * ┌─ PARA QUÉ SIRVE ESTA MARCA ─────────────────────────────────────────┐
   * │ `camposAusentes` avisa de las etiquetas que el mapeo no encontró,   │
   * │ para descubrir que una está mal escrita. Una pregunta condicional   │
   * │ falta en CADA envío de quien no la ve —la etapa hormonal en todos   │
   * │ los hombres—, y esa falsa alarma enseña a ignorar el aviso justo    │
   * │ cuando sirve para algo.                                             │
   * └─────────────────────────────────────────────────────────────────────┘
   */
  readonly conditional?: boolean;
  /**
   * Textos que significan «sí». Si está presente, el campo se convierte a
   * booleano; si no, se deja como texto.
   */
  readonly trueWhen?: readonly string[];
  /**
   * Un sí/no leído de una lista de casillas: `true` cuando el cliente marcó
   * algo que **no** está en esta lista de negaciones.
   *
   * «Lesiones» ofrece `Ninguna` junto a las partes del cuerpo, y Tally deja
   * marcar las dos cosas. Ante esa contradicción el resultado es `true`:
   * `hasLimitations` es lo que dispara el aviso de seguridad de la rutina, y
   * equivocarse hacia el aviso de más no lastima a nadie; hacia el de menos,
   * sí.
   */
  readonly falseWhen?: readonly string[];
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
  /**
   * Opciones que NO son un valor: «Ninguna» marcada sola significa que no hay
   * detalle que guardar, no que el detalle sea la palabra «Ninguna».
   *
   * Si todo lo marcado está en esta lista, el campo se omite.
   */
  readonly omitWhen?: readonly string[];
  /**
   * Traduce el texto de la opción al valor que espera el dominio:
   * `"Principiante (Menos de 6 meses)"` → `"beginner"`.
   *
   * La clave se compara como **prefijo**, ignorando mayúsculas y acentos. El
   * texto de una opción se edita igual que el de una pregunta, y anclar la
   * traducción al texto completo la haría frágil por nada.
   *
   * Un texto que no está en el mapa **pasa tal cual**: omitirlo diría «falta
   * el nivel» cuando el cliente sí contestó. Dejarlo pasar hace que el error
   * de validación nombre el problema real.
   */
  readonly valueMap?: Readonly<Record<string, string>>;
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
 * Las respuestas marcadas, ya resueltas a texto.
 *
 * Una casilla marcada es un elemento de la lista. Las vacías se descartan,
 * así que una lista vacía significa «no contestó».
 */
function toTextList(value: unknown, options: readonly FormOption[] | undefined): string[] {
  const resolve = (item: unknown): string | null => {
    if (item === null || item === undefined) return null;

    const asText = typeof item === 'string' ? item : String(item);
    if (asText.length === 0) return null;

    const match = options?.find((option) => option.id === asText);
    return match?.text ?? asText;
  };

  const items = Array.isArray(value) ? value : [value];
  return items.map(resolve).filter((part): part is string => part !== null);
}

/**
 * El valor como un solo texto.
 *
 * Devuelve `null` cuando no hay respuesta, para distinguir «no contestó» de
 * «contestó algo vacío».
 */
function toText(value: unknown, options: readonly FormOption[] | undefined): string | null {
  const parts = toTextList(value, options);
  return parts.length === 0 ? null : parts.join(', ');
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

/** El primer valor cuya clave sea prefijo del texto, ya normalizados los dos. */
function translate(text: string, valueMap: Readonly<Record<string, string>>): string {
  const normalized = normalize(text);
  const hit = Object.entries(valueMap).find(([key]) => normalized.startsWith(normalize(key)));
  return hit?.[1] ?? text;
}

function isFormField(value: unknown): value is FormField {
  return isRecord(value) && typeof value['label'] === 'string';
}

/**
 * Aplica UNA regla a un campo. `undefined` significa «no hay valor que
 * guardar», y es el único centinela: `false` y `0` son valores legítimos.
 */
function applyRule(field: FormField, rule: FieldRule): unknown {
  const text = toText(field.value, field.options);

  if (rule.trueWhen !== undefined) {
    // Una pregunta sí/no sin respuesta es «no», no «sin contestar»: en el
    // dominio `hasLimitations` no admite ausencia.
    if (typeof field.value === 'boolean') return field.value;

    const affirmatives = rule.trueWhen.map(normalize);
    return text !== null && affirmatives.includes(normalize(text));
  }

  if (rule.falseWhen !== undefined) {
    const negations = rule.falseWhen.map(normalize);
    // `.some` sobre una lista vacía es `false`: sin marcar nada, no hay
    // limitación declarada. Y basta UNA marca fuera de las negaciones para
    // que sea `true`, aunque también esté marcada «Ninguna».
    return toTextList(field.value, field.options).some(
      (selected) => !negations.includes(normalize(selected)),
    );
  }

  if (rule.numeric === true) {
    // Una respuesta sin número se omite igual que una ausente: no hay valor
    // que inventar, y la validación dirá cuál falta.
    return firstInteger(text) ?? undefined;
  }

  // Un valor vacío no pisa uno que ya se había resuelto, y tampoco crea la
  // clave: la ausencia se representa omitiendo el campo.
  if (text === null) return undefined;

  if (rule.omitWhen !== undefined) {
    const vacias = rule.omitWhen.map(normalize);
    const utiles = toTextList(field.value, field.options).filter(
      (selected) => !vacias.includes(normalize(selected)),
    );
    return utiles.length === 0 ? undefined : utiles.join(', ');
  }

  if (rule.valueMap !== undefined) return translate(text, rule.valueMap);

  // Todo lo demás sale como texto, incluido un número o un booleano que
  // llegue del formulario. Quien necesite el número lo declara con
  // `numeric: true`: tener dos caminos para eso es lo que hacía ambiguo el
  // tipo del resultado.
  return text;
}

/**
 * Junta dos respuestas de una regla que declara varias preguntas.
 *
 * Dos textos se unen. Cualquier otra cosa se queda con la primera: no hay
 * forma sensata de sumar dos números ni dos sí/no, y elegir una haría parecer
 * intencionado lo que sería un mapeo mal escrito.
 */
function unir(previo: unknown, nuevo: unknown): unknown {
  if (previo === undefined) return nuevo;
  if (typeof previo === 'string' && typeof nuevo === 'string') return `${previo}, ${nuevo}`;
  return previo;
}

/**
 * Aplica el mapeo y devuelve un objeto plano listo para `validateAssessment`.
 *
 * Los campos sin respuesta se **omiten** en vez de quedar en `null`: así la
 * validación distingue «no contestó» de «contestó algo inválido».
 *
 * ┌─ UNA PREGUNTA PUEDE ALIMENTAR VARIOS CAMPOS ───────────────────────────┐
 * │ «Lesiones, dolor o limitaciones» ofrece partes del cuerpo, y esa misma │
 * │ respuesta es DOS cosas: el sí/no que dispara el aviso de seguridad, y  │
 * │ el detalle de qué le duele.                                           │
 * │                                                                        │
 * │ Antes cada etiqueta alimentaba un solo campo, así que la regla del     │
 * │ booleano se quedaba con la respuesta y «Cuello» se perdía: la IA sabía │
 * │ que había una limitación y no cuál.                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
export function mapFormFields(
  fields: readonly FormField[],
  mapping: FieldMapping,
): Record<string, unknown> {
  // Índice por etiqueta normalizada, para no recorrer el mapeo por cada campo.
  // Una lista por etiqueta: varios campos pueden salir de la misma pregunta.
  const byLabel = new Map<string, { domainField: string; rule: FieldRule }[]>();
  for (const [domainField, rule] of Object.entries(mapping)) {
    const etiquetas = typeof rule.label === 'string' ? [rule.label] : rule.label;
    for (const etiqueta of etiquetas) {
      const clave = normalize(etiqueta);
      const lista = byLabel.get(clave) ?? [];
      lista.push({ domainField, rule });
      byLabel.set(clave, lista);
    }
  }

  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (!isFormField(field)) continue;

    for (const { domainField, rule } of byLabel.get(normalize(field.label)) ?? []) {
      const value = applyRule(field, rule);
      if (value === undefined) continue;

      // Unir solo cuando la regla PIDE varias preguntas. Una etiqueta repetida
      // en el formulario es un accidente, y ahí sigue ganando la última: juntar
      // «@viejo, @nuevo» inventaría un valor que nadie escribió.
      result[domainField] =
        typeof rule.label === 'string' ? value : unir(result[domainField], value);
    }
  }

  return result;
}
