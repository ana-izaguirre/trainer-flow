/**
 * SPEC-001 — Lectura del sobre de Tally.
 *
 * Los tests corren contra `tests/fixtures/tally-form-response.json`, que es
 * una respuesta REAL del formulario, no un ejemplo inventado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTallyEnvelope } from './tally-envelope.ts';

const FIXTURE: unknown = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../tests/fixtures/tally-form-response.json'),
    'utf8',
  ),
);

/** Copia profunda del fixture, para poder romperlo sin afectar a otros tests. */
function payload(): Record<string, unknown> {
  return structuredClone(FIXTURE) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------

describe('el payload real de Tally', () => {
  it('se parsea sin error', () => {
    const result = parseTallyEnvelope(FIXTURE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.eventId).toBe('71804ed2-dfd5-4242-9477-e2651f072c80');
    expect(result.value.formId).toBe('GxAKrk');
    expect(result.value.responseId).toBe('Nqgd4rl');
  });

  it('el eventId es lo que garantiza la idempotencia', () => {
    const result = parseTallyEnvelope(FIXTURE);

    expect(result.ok).toBe(true);
    // Sin eventId no hay UNIQUE (source, external_id) que valga.
    if (result.ok) expect(result.value.eventId.length).toBeGreaterThan(0);
  });

  it('extrae los campos con sus opciones', () => {
    const result = parseTallyEnvelope(FIXTURE);
    if (!result.ok) throw new Error('el fixture no parsea');

    const objetivo = result.value.fields.find((f) => f.label === 'Objetivo');
    expect(objetivo?.type).toBe('MULTIPLE_CHOICE');
    expect(objetivo?.options).toHaveLength(6);

    // 🔑 Confirmado con el payload real: el valor es el ID de la opción,
    // no su texto. La rama defensiva del mapeo es la que aplica.
    expect(objetivo?.value).toEqual(['7f847e84-a9df-4e3e-ad60-44fcc66bbc4d']);
  });

  it('conserva los campos aplanados que Tally añade por cada casilla', () => {
    // Tally manda, además de la pregunta, un campo por opción con true/false.
    // No se filtran: el mapeo los ignora porque sus etiquetas no coinciden,
    // y filtrarlos exigiría suponer el formato de las claves.
    const result = parseTallyEnvelope(FIXTURE);
    if (!result.ok) throw new Error('el fixture no parsea');

    const aplanado = result.value.fields.find(
      (f) => f.label === 'Lesiones, dolor o limitaciones (Ninguna)',
    );
    expect(aplanado?.value).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('rechaza lo que no debe procesar', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'hola'],
    ['array', []],
    ['número', 1],
  ])('rechaza una raíz que es %s', (_nombre, raw) => {
    expect(parseTallyEnvelope(raw).ok).toBe(false);
  });

  it('rechaza un eventType que no es FORM_RESPONSE', () => {
    const raw = payload();
    raw['eventType'] = 'FORM_UPDATED';

    const result = parseTallyEnvelope(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('FORM_UPDATED');
  });

  it.each(['eventId', 'eventType'])('rechaza si falta %s', (campo) => {
    const raw = payload();
    delete raw[campo];

    expect(parseTallyEnvelope(raw).ok).toBe(false);
  });

  it('rechaza si falta data', () => {
    const raw = payload();
    delete raw['data'];

    expect(parseTallyEnvelope(raw).ok).toBe(false);
  });

  it('rechaza si fields no es una lista', () => {
    const raw = payload();
    (raw['data'] as Record<string, unknown>)['fields'] = 'no soy una lista';

    expect(parseTallyEnvelope(raw).ok).toBe(false);
  });

  it('rechaza si falta formId', () => {
    const raw = payload();
    delete (raw['data'] as Record<string, unknown>)['formId'];

    expect(parseTallyEnvelope(raw).ok).toBe(false);
  });

  it('acepta una lista de campos vacía', () => {
    // Un formulario sin respuestas es raro, pero no es malformado: se guarda
    // el raw_payload y el entrenador decide.
    const raw = payload();
    (raw['data'] as Record<string, unknown>)['fields'] = [];

    const result = parseTallyEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('campos hostiles', () => {
  it('descarta entradas que no son campos, sin perder las demás', () => {
    const raw = payload();
    const fields = (raw['data'] as Record<string, unknown>)['fields'] as unknown[];
    fields.push('no soy un campo', null, 42, { sinEtiqueta: true });

    const result = parseTallyEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const field of result.value.fields) {
        expect(typeof field.label).toBe('string');
      }
    }
  });

  it('descarta opciones malformadas de un campo', () => {
    const raw = payload();
    const fields = (raw['data'] as Record<string, unknown>)['fields'] as Record<string, unknown>[];
    const objetivo = fields.find((f) => f['label'] === 'Objetivo')!;
    (objetivo['options'] as unknown[]).push({ sinId: true }, null);

    const result = parseTallyEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const campo = result.value.fields.find((f) => f.label === 'Objetivo');
      for (const option of campo?.options ?? []) {
        expect(typeof option.id).toBe('string');
        expect(typeof option.text).toBe('string');
      }
    }
  });

  it('un campo cuyas options son TODAS malformadas queda sin options', () => {
    const raw = payload();
    const fields = (raw['data'] as Record<string, unknown>)['fields'] as Record<string, unknown>[];
    const objetivo = fields.find((f) => f['label'] === 'Objetivo')!;
    objetivo['options'] = [{ sinId: true }, null, 'texto suelto'];

    const result = parseTallyEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const campo = result.value.fields.find((f) => f.label === 'Objetivo');
      // Sin options, el mapeo usará el valor crudo: no se pierde la respuesta.
      expect(campo?.options).toBeUndefined();
    }
  });

  it('un campo sin type queda marcado como UNKNOWN', () => {
    const raw = payload();
    const fields = (raw['data'] as Record<string, unknown>)['fields'] as Record<string, unknown>[];
    delete fields[0]!['type'];

    const result = parseTallyEnvelope(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.fields[0]?.type).toBe('UNKNOWN');
  });

  it('un campo sin options queda sin options, no con una lista vacía', () => {
    const result = parseTallyEnvelope(FIXTURE);
    if (!result.ok) throw new Error('el fixture no parsea');

    const nombre = result.value.fields.find((f) => f.label === 'Nombre');
    expect(nombre?.options).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('🔒 el payload trae credenciales', () => {
  it('las URLs de Tally llevan un token de acceso', () => {
    // submissionPdfUrl y submissionPreviewUrl contienen un JWT y una firma.
    // Quien los tenga puede descargar el PDF de la evaluación. Por eso el
    // parser los expone aparte: SPEC-001 exige redactarlos antes de guardar
    // el raw_payload.
    const result = parseTallyEnvelope(FIXTURE);
    if (!result.ok) throw new Error('el fixture no parsea');

    expect(result.value.credentialUrls).toEqual(
      expect.arrayContaining(['submissionPdfUrl', 'submissionPreviewUrl']),
    );
  });
});
