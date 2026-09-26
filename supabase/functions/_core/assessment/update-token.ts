/**
 * SPEC-027 — El token de actualización, del lado del formulario.
 *
 * El bot le da al cliente un enlace de Tally con `?update=<token>`, y Tally lo
 * devuelve en un campo oculto llamado `update`. Con él, la evaluación es de
 * ESE cliente y no de uno nuevo.
 *
 * ┌─ 🔒 EL TOKEN ES UNA CREDENCIAL ────────────────────────────────────────┐
 * │ Permite reescribir la evaluación de un cliente, datos de salud         │
 * │ incluidos. No se loguea, y se quita del payload ANTES de guardarlo:    │
 * │ si la ingesta falla, sigue vivo, y no puede quedar en `webhook_events`.│
 * │ En la base solo se guarda su hash (migración 0026).                    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { FormField } from './field-mapping.ts';

/** El nombre del campo oculto en Tally. Ana lo crea así (SPEC-027 §12). */
export const UPDATE_FIELD = 'update';

/** La misma forma que el `link_token`: base64url, sin relleno. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export type UpdateTokenField =
  /** Un envío normal: sin campo, o con el campo vacío. */
  | { readonly kind: 'none' }
  | { readonly kind: 'present'; readonly token: string }
  /** Trae algo, pero no tiene forma de token. Se trata como vencido. */
  | { readonly kind: 'invalid' };

function isUpdateField(label: string): boolean {
  return label.trim().toLowerCase() === UPDATE_FIELD;
}

/**
 * ┌─ VACÍO NO ES INVÁLIDO ─────────────────────────────────────────────────┐
 * │ Con el campo oculto configurado, TODO envío lo trae: el de quien llega │
 * │ por primera vez, vacío. Tratarlo como un token malo pondría un aviso   │
 * │ de «enlace que ya no vale» en cada cliente nuevo.                      │
 * └────────────────────────────────────────────────────────────────────────┘
 */
export function readUpdateToken(fields: readonly FormField[]): UpdateTokenField {
  const campo = fields.find((f) => isUpdateField(f.label));
  const valor = campo?.value;

  if (valor === undefined || valor === null) return { kind: 'none' };
  if (typeof valor === 'string' && valor.trim().length === 0) return { kind: 'none' };
  if (typeof valor !== 'string' || !TOKEN_PATTERN.test(valor)) return { kind: 'invalid' };

  return { kind: 'present', token: valor };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** El payload sin el token, listo para guardarse. Lo demás, intacto. */
export function redactUpdateToken(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const data = raw['data'];
  if (!isRecord(data) || !Array.isArray(data['fields'])) return raw;

  const fields = data['fields'].map((f: unknown) =>
    isRecord(f) && typeof f['label'] === 'string' && isUpdateField(f['label'])
      ? { ...f, value: '[REDACTED]' }
      : f,
  );

  return { ...raw, data: { ...data, fields } };
}

export function buildUpdateUrl(formUrl: string, token: string): string {
  const separador = formUrl.includes('?') ? '&' : '?';
  return `${formUrl}${separador}${UPDATE_FIELD}=${token}`;
}
