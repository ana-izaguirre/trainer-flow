/**
 * SPEC-008 §3 — El botón que elige QUÉ plantilla cargar.
 *
 * ┌─ POR QUÉ UN PREFIJO PROPIO ────────────────────────────────────────────┐
 * │ `act:` son acciones SOBRE una versión; esto es la elección de cuál     │
 * │ cargar, y lleva un dato más. Los tres prefijos —`act:`, `chk:`,        │
 * │ `tpl:`— viajan por el mismo canal y no pueden confundirse: son         │
 * │ literales distintos.                                                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Cabe en los 64 bytes de Telegram: el id más largo del catálogo es
 * `push-pull-legs-6d`, que deja el callback en 58. Hay un test que lo mide
 * contra el catálogo real, así que añadir una plantilla con un id larguísimo
 * pondría el test en rojo antes que el botón en producción.
 */

const PREFIX = 'tpl';

/** Los ids del catálogo: minúsculas, dígitos y guiones. */
const PATTERN =
  /^tpl:([a-z0-9-]{1,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface TemplateChoice {
  readonly templateId: string;
  readonly versionId: string;
}

export function buildTemplateCallback(templateId: string, versionId: string): string {
  return `${PREFIX}:${templateId}:${versionId}`;
}

/**
 * `null` ante cualquier cosa que no sea exactamente lo esperado.
 *
 * Que el id tenga la forma correcta **no lo hace válido**: si no está en el
 * catálogo, `findTemplate` lo rechaza después.
 */
export function parseTemplateCallback(raw: string): TemplateChoice | null {
  const match = PATTERN.exec(raw);
  const templateId = match?.[1]?.toLowerCase();
  const versionId = match?.[2];

  if (templateId === undefined || versionId === undefined) return null;

  return { templateId, versionId };
}
