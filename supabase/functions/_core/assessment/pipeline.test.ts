/**
 * SPEC-001 — Las tres capas juntas, contra el formulario real.
 *
 * Cada capa tiene sus tests. Este prueba lo que ninguna puede sola: que el
 * `MAPPING` de la spec case con las etiquetas que Tally manda de verdad.
 *
 * Es el test que se rompe cuando alguien renombra una pregunta en Tally sin
 * tocar el mapeo — que es el único cambio del formulario capaz de
 * desconectar un campo en silencio.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapFormFields, type FieldMapping } from './field-mapping.ts';
import { parseTallyEnvelope } from './tally-envelope.ts';
import { validateAssessment } from './validate-assessment.ts';

/**
 * El mapeo de producción. Vive aquí hasta que S-13 lo mueva al webhook, y es
 * el mismo que documenta SPEC-001.
 */
export const MAPPING: FieldMapping = {
  fullName: { label: 'Nombre' },
  goal: { label: 'Objetivo' },
  level: {
    label: 'Nivel',
    valueMap: { Principiante: 'beginner', Intermedio: 'intermediate', Avanzado: 'advanced' },
  },
  daysPerWeek: { label: '¿Cuántos días a la semana entrenas?', numeric: true },
  sessionMinutes: { label: 'Tiempo por sesión', numeric: true },
  lifestyle: { label: 'Estilo de vida' },
  equipment: { label: 'Equipamiento disponible' },
  hasLimitations: { label: 'Lesiones, dolor o limitaciones', falseWhen: ['Ninguna'] },
  limitationsDetail: { label: 'Cuéntanos brevemente qué debemos tener en cuenta.' },
  notes: { label: '¿Hay algo más que tu entrenador deba saber?' },
};

const FIXTURE: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../../tests/fixtures/tally-form-response.json'), 'utf8'),
);

function procesar() {
  const sobre = parseTallyEnvelope(FIXTURE);
  if (!sobre.ok) throw new Error('el fixture no parsea');
  return { sobre: sobre.value, campos: mapFormFields(sobre.value.fields, MAPPING) };
}

// ---------------------------------------------------------------------------

describe('el formulario real, de punta a punta', () => {
  it('produce una evaluación válida', () => {
    const { campos } = procesar();
    const result = validateAssessment(campos);

    // Si esto falla, el mensaje dice exactamente qué campo se desconectó.
    expect(result.ok ? [] : result.errors.map((e) => `${e.field}: ${e.message}`)).toEqual([]);
  });

  it('cada campo del dominio sale con su valor', () => {
    const result = validateAssessment(procesar().campos);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      fullName: 'Test',
      goal: 'Fuerza',
      // El formulario dice «Principiante (Menos de 6 meses)»; el dominio, esto.
      level: 'beginner',
      // LINEAR_SCALE manda un número crudo, no el texto de una opción.
      daysPerWeek: 3,
      // «20–30 minutos» → el extremo bajo.
      sessionMinutes: 20,
      lifestyle: 'Sedentario (Trabajo de oficina, poco movimiento)',
      equipment: 'Sin equipamiento, Banco, Cardio (cinta, bicicleta, elíptica, etc.)',
      // Marcadas «Ninguna» Y «Espalda baja» Y «Otra». Ante la duda, se avisa.
      hasLimitations: true,
      limitationsDetail: 'Nada',
      notes: 'No',
    });
  });

  it('toda etiqueta del MAPPING existe en el formulario', () => {
    // Renombrar una pregunta en Tally es el único cambio que desconecta un
    // campo. Esto lo convierte en un test rojo en vez de en un envío perdido.
    const { sobre } = procesar();
    const delFormulario = new Set(sobre.fields.map((f) => f.label));

    const huerfanas = Object.entries(MAPPING)
      .filter(([, regla]) => !delFormulario.has(regla.label))
      .map(([campo, regla]) => `${campo} → "${regla.label}"`);

    expect(huerfanas).toEqual([]);
  });

  it('los campos aplanados de las casillas se ignoran', () => {
    // Tally manda un campo extra por cada opción: «Equipamiento (Banco)».
    // Ninguno coincide con una etiqueta del mapeo, así que no entra nada.
    const { sobre, campos } = procesar();

    expect(sobre.fields.length).toBeGreaterThan(Object.keys(campos).length);
    expect(Object.keys(campos).toSorted()).toEqual(Object.keys(MAPPING).toSorted());
  });

  it('las URLs con credencial se detectan para redactarlas', () => {
    // SPEC-001 regla 3: llevan un JWT dentro y no pueden acabar en la base.
    expect(procesar().sobre.credentialUrls.length).toBe(2);
  });
});
