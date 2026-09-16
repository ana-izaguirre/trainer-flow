/**
 * SPEC-001 — Lectura del sobre del webhook de Tally.
 *
 * Escrito contra un payload REAL, guardado en
 * `tests/fixtures/tally-form-response.json`. Esta capa es la única que conoce
 * cómo Tally serializa una respuesta.
 *
 * ┌─ 🔒 EL PAYLOAD TRAE CREDENCIALES ──────────────────────────────────────┐
 * │ `submissionPdfUrl` y `submissionPreviewUrl` incluyen un JWT y una      │
 * │ firma. Quien los tenga puede descargar el PDF de la evaluación.        │
 * │                                                                        │
 * │ El parser los expone en `credentialUrls` para que quien guarde el      │
 * │ `raw_payload` los redacte primero. Guardar el payload íntegro metería  │
 * │ una credencial viva en la base de datos.                              │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { FormField, FormOption } from './field-mapping.ts';

/** El único tipo de evento que procesamos. */
const EXPECTED_EVENT_TYPE = 'FORM_RESPONSE';

/**
 * Campos del sobre cuyo contenido es una credencial y no puede persistirse
 * tal cual.
 */
export const CREDENTIAL_URL_FIELDS = ['submissionPdfUrl', 'submissionPreviewUrl'] as const;

export interface TallyEnvelope {
  /** Identificador del evento. Es lo que garantiza la idempotencia. */
  readonly eventId: string;
  readonly formId: string;
  readonly responseId: string;
  readonly fields: readonly FormField[];
  /** Qué campos del payload hay que redactar antes de guardarlo. */
  readonly credentialUrls: readonly string[];
}

export type EnvelopeResult =
  | { readonly ok: true; readonly value: TallyEnvelope }
  | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(container: Record<string, unknown>, key: string): string | null {
  const value = container[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOptions(value: unknown): readonly FormOption[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const options = value.filter(
    (item): item is FormOption =>
      isRecord(item) && typeof item['id'] === 'string' && typeof item['text'] === 'string',
  );

  return options.length === 0 ? undefined : options;
}

function readField(value: unknown): FormField | null {
  if (!isRecord(value)) return null;

  const label = readString(value, 'label');
  const key = readString(value, 'key');
  if (label === null || key === null) return null;

  const options = readOptions(value['options']);

  return {
    key,
    label,
    type: readString(value, 'type') ?? 'UNKNOWN',
    value: value['value'],
    // `exactOptionalPropertyTypes` obliga a omitir la clave, no a pasar
    // `undefined`: un campo sin opciones no tiene `options`.
    ...(options === undefined ? {} : { options }),
  };
}

export function parseTallyEnvelope(raw: unknown): EnvelopeResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'El payload no es un objeto.' };
  }

  const eventType = readString(raw, 'eventType');
  if (eventType === null) {
    return { ok: false, error: 'El payload no trae eventType.' };
  }
  if (eventType !== EXPECTED_EVENT_TYPE) {
    return { ok: false, error: `Tipo de evento no soportado: ${eventType}.` };
  }

  const eventId = readString(raw, 'eventId');
  if (eventId === null) {
    // Sin esto no hay idempotencia posible: un reintento crearía un cliente
    // duplicado.
    return { ok: false, error: 'El payload no trae eventId.' };
  }

  const data = raw['data'];
  if (!isRecord(data)) {
    return { ok: false, error: 'El payload no trae data.' };
  }

  const formId = readString(data, 'formId');
  const responseId = readString(data, 'responseId');
  if (formId === null || responseId === null) {
    return { ok: false, error: 'data no identifica el formulario o la respuesta.' };
  }

  const rawFields = data['fields'];
  if (!Array.isArray(rawFields)) {
    return { ok: false, error: 'data.fields no es una lista.' };
  }

  // Los campos malformados se descartan uno a uno en vez de invalidar la
  // respuesta entera: `raw_payload` conserva el original.
  //
  // Tampoco se filtran los campos aplanados que Tally añade por cada casilla
  // (`question_XXX_<idOpción>`): el mapeo los ignora porque sus etiquetas no
  // coinciden con ninguna configurada, y filtrarlos exigiría suponer el
  // formato de las claves.
  const fields = rawFields
    .map(readField)
    .filter((field): field is FormField => field !== null);

  return {
    ok: true,
    value: {
      eventId,
      formId,
      responseId,
      fields,
      credentialUrls: CREDENTIAL_URL_FIELDS.filter((key) => typeof data[key] === 'string'),
    },
  };
}
