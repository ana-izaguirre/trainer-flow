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
import { mapFormFields } from './field-mapping.ts';
import { TALLY_MAPPING as MAPPING } from './mapping.ts';
import { parseTallyEnvelope } from './tally-envelope.ts';
import { validateAssessment } from './validate-assessment.ts';


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
      gender: null,
      age: null,
      weightKg: null,
      heightCm: null,
      lastWeighed: null,
      quitReasons: null,
      menopauseStage: null,
      chronicConditions: null,
      birthDate: null,
      medications: null,
      familyConditions: null,
      equipmentDetail: null,
    });
  });

  /**
   * Los campos de SPEC-016, cuyas preguntas todavía no existen en el
   * formulario real.
   *
   * Sus etiquetas en `mapping.ts` son una CONJETURA. Cuando el entrenador
   * añada las preguntas en Tally y se actualice el fixture con un envío de
   * verdad, el test de abajo avisa de cuáles ya cuadran para sacarlas de
   * aquí. Mientras estén en esta lista, ese dato NO se está recogiendo.
   */
  const PENDIENTES_DE_CONFIRMAR = new Set([
    'gender',
    'age',
    'weightKg',
    'heightCm',
    'lastWeighed',
    'quitReasons',
    'menopauseStage',
    'chronicConditions',
    'birthDate',
    'medications',
    'familyConditions',
    'equipmentDetail',
  ]);

  it('toda etiqueta CONFIRMADA existe en el formulario', () => {
    // Renombrar una pregunta en Tally es el único cambio que desconecta un
    // campo. Esto lo convierte en un test rojo en vez de en un envío perdido.
    const { sobre } = procesar();
    const delFormulario = new Set(sobre.fields.map((f) => f.label));

    const huerfanas = Object.entries(MAPPING)
      .filter(([campo]) => !PENDIENTES_DE_CONFIRMAR.has(campo))
      .filter(([, regla]) => !delFormulario.has(regla.label))
      .map(([campo, regla]) => `${campo} → "${regla.label}"`);

    expect(huerfanas).toEqual([]);
  });

  it('avisa cuando una etiqueta pendiente ya cuadra', () => {
    // Este test existe para apagarse solo. En cuanto el formulario real traiga
    // una de estas preguntas con la etiqueta que espera `mapping.ts`, falla
    // pidiendo que se saque de la lista — y así la lista no miente.
    const { sobre } = procesar();
    const delFormulario = new Set(sobre.fields.map((f) => f.label));

    const yaCuadran = [...PENDIENTES_DE_CONFIRMAR].filter((campo) => {
      const regla = MAPPING[campo as keyof typeof MAPPING];
      return regla !== undefined && delFormulario.has(regla.label);
    });

    expect(yaCuadran).toEqual([]);
  });

  it('los campos aplanados de las casillas se ignoran', () => {
    // Tally manda un campo extra por cada opción: «Equipamiento (Banco)».
    // Ninguno coincide con una etiqueta del mapeo, así que no entra nada.
    const { sobre, campos } = procesar();

    expect(sobre.fields.length).toBeGreaterThan(Object.keys(campos).length);

    // Los de SPEC-016 no están todavía en el formulario: se comparan solo los
    // confirmados, que son los que este fixture puede traer.
    const esperados = Object.keys(MAPPING).filter((c) => !PENDIENTES_DE_CONFIRMAR.has(c));
    expect(Object.keys(campos).toSorted()).toEqual(esperados.toSorted());
  });

  it('las URLs con credencial se detectan para redactarlas', () => {
    // SPEC-001 regla 3: llevan un JWT dentro y no pueden acabar en la base.
    expect(procesar().sobre.credentialUrls.length).toBe(2);
  });
});
