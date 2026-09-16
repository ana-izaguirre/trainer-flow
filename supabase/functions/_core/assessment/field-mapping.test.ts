/**
 * SPEC-001 — Mapeo de los campos del formulario a los del dominio.
 *
 * Esta capa resuelve UN problema concreto: un formulario devuelve respuestas
 * etiquetadas con el texto de la pregunta, y el dominio espera campos con
 * nombre propio. La correspondencia es CONFIGURACIÓN, no código.
 *
 * Se maneja explícitamente que el valor de una pregunta de selección pueda
 * venir como el identificador de la opción o como su texto. No saber cuál de
 * los dos usa el proveedor no es excusa para suponerlo: se soportan ambos.
 */
import { describe, expect, it } from 'vitest';
import { mapFormFields, type FormField, type FieldMapping } from './field-mapping.ts';

const MAPPING: FieldMapping = {
  fullName: { label: 'Nombre completo' },
  goalDetail: { label: 'Detalle del objetivo' },
  goal: { label: '¿Cuál es tu objetivo?' },
  level: { label: 'Nivel de experiencia' },
  daysPerWeek: { label: '¿Cuántos días por semana?', numeric: true },
  sessionMinutes: { label: '¿Cuánto tiempo tienes por sesión?', numeric: true },
  equipment: { label: 'Equipamiento disponible' },
  hasLimitations: { label: '¿Tienes alguna lesión o limitación?', trueWhen: ['Sí', 'Si', 'Yes'] },
  limitationsDetail: { label: 'Cuéntanos más sobre tu limitación' },
  lifestyle: { label: '¿Cómo describirías tu día a día?' },
  notes: { label: 'Algo más que debamos saber' },
};

function campo(label: string, value: unknown, extra: Partial<FormField> = {}): FormField {
  return { key: `q_${label}`, label, type: 'INPUT_TEXT', value, ...extra };
}

// ---------------------------------------------------------------------------

describe('mapeo básico por etiqueta', () => {
  it('lleva cada respuesta a su campo del dominio', () => {
    const result = mapFormFields(
      [
        campo('Nombre completo', 'Carlos Pérez'),
        campo('Detalle del objetivo', '@carlitos'),
        campo('¿Cuál es tu objetivo?', 'Ganancia muscular'),
      ],
      MAPPING,
    );

    expect(result).toMatchObject({
      fullName: 'Carlos Pérez',
      goalDetail: '@carlitos',
      goal: 'Ganancia muscular',
    });
  });

  it('ignora preguntas que no están en el mapeo', () => {
    const result = mapFormFields([campo('Pregunta que no usamos', 'x')], MAPPING);
    expect(result).toEqual({});
  });

  it('no distingue mayúsculas, acentos ni espacios sobrantes', () => {
    // El texto de una pregunta se edita: "Nombre completo " no debería romper
    // la ingesta de todos los clientes.
    const result = mapFormFields([campo('  nombre COMPLETO  ', 'Carlos')], MAPPING);
    expect(result['fullName']).toBe('Carlos');
  });

  it('una lista vacía de campos devuelve un objeto vacío', () => {
    expect(mapFormFields([], MAPPING)).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe('preguntas de selección', () => {
  // Caso A: el valor ya viene como texto.
  it('usa el valor tal cual cuando ya es la etiqueta', () => {
    const result = mapFormFields(
      [campo('Nivel de experiencia', 'Intermedio', { type: 'MULTIPLE_CHOICE' })],
      MAPPING,
    );

    expect(result['level']).toBe('Intermedio');
  });

  // Caso B: el valor es el identificador de la opción.
  it('resuelve el identificador de la opción a su texto', () => {
    const result = mapFormFields(
      [
        campo('Nivel de experiencia', ['opt-2'], {
          type: 'MULTIPLE_CHOICE',
          options: [
            { id: 'opt-1', text: 'Principiante' },
            { id: 'opt-2', text: 'Intermedio' },
          ],
        }),
      ],
      MAPPING,
    );

    expect(result['level']).toBe('Intermedio');
  });

  it('un identificador que no está en las opciones se deja tal cual', () => {
    // Mejor guardar algo raro que perder la respuesta: raw_payload conserva
    // el original y el entrenador puede corregirlo.
    const result = mapFormFields(
      [
        campo('Nivel de experiencia', ['opt-9'], {
          type: 'MULTIPLE_CHOICE',
          options: [{ id: 'opt-1', text: 'Principiante' }],
        }),
      ],
      MAPPING,
    );

    expect(result['level']).toBe('opt-9');
  });

  it('une varias opciones seleccionadas con coma', () => {
    const result = mapFormFields(
      [
        campo('Equipamiento disponible', ['opt-1', 'opt-3'], {
          type: 'CHECKBOXES',
          options: [
            { id: 'opt-1', text: 'Mancuernas' },
            { id: 'opt-2', text: 'Barra' },
            { id: 'opt-3', text: 'Bandas' },
          ],
        }),
      ],
      MAPPING,
    );

    expect(result['equipment']).toBe('Mancuernas, Bandas');
  });

  it('un array de un solo elemento no queda como array', () => {
    const result = mapFormFields([campo('Nivel de experiencia', ['Intermedio'])], MAPPING);
    expect(result['level']).toBe('Intermedio');
  });
});

// ---------------------------------------------------------------------------

describe('sí / no', () => {
  it.each(['Sí', 'Si', 'Yes', 'sí', 'SI'])('interpreta %s como true', (value) => {
    const result = mapFormFields([campo('¿Tienes alguna lesión o limitación?', value)], MAPPING);
    expect(result['hasLimitations']).toBe(true);
  });

  it.each(['No', 'no', 'Ninguna', ''])('interpreta %s como false', (value) => {
    const result = mapFormFields([campo('¿Tienes alguna lesión o limitación?', value)], MAPPING);
    expect(result['hasLimitations']).toBe(false);
  });

  it('un booleano real pasa tal cual', () => {
    const result = mapFormFields([campo('¿Tienes alguna lesión o limitación?', true)], MAPPING);
    expect(result['hasLimitations']).toBe(true);
  });

  it('resuelve la opción antes de decidir sí o no', () => {
    const result = mapFormFields(
      [
        campo('¿Tienes alguna lesión o limitación?', ['opt-1'], {
          type: 'MULTIPLE_CHOICE',
          options: [
            { id: 'opt-1', text: 'Sí' },
            { id: 'opt-2', text: 'No' },
          ],
        }),
      ],
      MAPPING,
    );

    expect(result['hasLimitations']).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('valores ausentes', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['array vacío', []],
    ['string vacío', ''],
  ])('omite el campo cuando el valor es %s', (_nombre, value) => {
    const result = mapFormFields([campo('Detalle del objetivo', value)], MAPPING);

    // Omitido, no `null`: así la validación distingue "no contestó" de
    // "contestó algo inválido".
    expect('goalDetail' in result).toBe(false);
  });

  it('el cero sí se conserva', () => {
    const result = mapFormFields([campo('¿Cuánto tiempo tienes por sesión?', 0)], MAPPING);
    expect(result['sessionMinutes']).toBe(0);
  });

  it('un campo sin `numeric` sale como texto aunque llegue un número', () => {
    // Hay un solo camino para obtener un número: declararlo. Si un campo de
    // texto devolviera a veces number y a veces string, el tipo del resultado
    // dependería de lo que mandara el formulario ese día.
    const result = mapFormFields([campo('¿Cuál es tu objetivo?', 42)], MAPPING);
    expect(result['goal']).toBe('42');
  });

  it('el false de una pregunta sí/no se conserva', () => {
    const result = mapFormFields([campo('¿Tienes alguna lesión o limitación?', 'No')], MAPPING);
    expect(result['hasLimitations']).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('datos hostiles', () => {
  it('no se rompe con un campo que no es objeto', () => {
    expect(() => mapFormFields(['no soy un campo'] as never, MAPPING)).not.toThrow();
  });

  it('no se rompe con un campo sin etiqueta', () => {
    const result = mapFormFields([{ key: 'k', type: 'INPUT_TEXT', value: 'x' } as never], MAPPING);
    expect(result).toEqual({});
  });

  it('si dos campos comparten etiqueta, gana el último no vacío', () => {
    const result = mapFormFields(
      [campo('Detalle del objetivo', '@viejo'), campo('Detalle del objetivo', '@nuevo')],
      MAPPING,
    );

    expect(result['goalDetail']).toBe('@nuevo');
  });

  it('un campo vacío no pisa uno que ya tenía valor', () => {
    const result = mapFormFields([campo('Detalle del objetivo', '@bueno'), campo('Detalle del objetivo', '')], MAPPING);
    expect(result['goalDetail']).toBe('@bueno');
  });
});

// ---------------------------------------------------------------------------

describe('valores numéricos', () => {
  // Un formulario no ofrece "60": ofrece "60 minutos". El número hay que
  // sacarlo del texto de la opción, y hacerlo aquí evita que cada campo
  // numérico invente su propia forma de leerlo.
  it.each([
    ['60 minutos', 60],
    ['Menos de 30 minutos', 30],
    ['3 días', 3],
    ['2', 2],
  ])('extrae el entero de %s', (texto, esperado) => {
    const result = mapFormFields([campo('¿Cuánto tiempo tienes por sesión?', texto)], MAPPING);
    expect(result['sessionMinutes']).toBe(esperado);
  });

  it('en un rango se queda con el extremo bajo', () => {
    // Prometer menos tiempo del que el cliente tiene es seguro. Prometer más
    // produce una rutina que no le cabe en el día.
    const result = mapFormFields([campo('¿Cuánto tiempo tienes por sesión?', '45-60 min')], MAPPING);
    expect(result['sessionMinutes']).toBe(45);
  });

  it('omite el campo cuando la respuesta no lleva ningún número', () => {
    // Esto es lo que pasa hoy: la pregunta de tiempo tiene mezcladas opciones
    // de estilo de vida. "Sedentario" no es un tiempo, y colarlo como si lo
    // fuera sería peor que fallar. La validación dirá qué falta.
    const result = mapFormFields([campo('¿Cuánto tiempo tienes por sesión?', 'Sedentario')], MAPPING);
    expect('sessionMinutes' in result).toBe(false);
  });

  it('resuelve el id de la opción antes de buscar el número', () => {
    const result = mapFormFields(
      [
        campo('¿Cuántos días por semana?', ['opt-3'], {
          type: 'MULTIPLE_CHOICE',
          options: [
            { id: 'opt-3', text: '3 días por semana' },
            { id: 'opt-5', text: '5 días por semana' },
          ],
        }),
      ],
      MAPPING,
    );

    expect(result['daysPerWeek']).toBe(3);
  });

  it('un número negativo se lee con su signo', () => {
    // No es un tiempo válido, pero inventarse un 15 sería peor: que falle la
    // validación, que para eso está.
    const result = mapFormFields([campo('¿Cuánto tiempo tienes por sesión?', '-15')], MAPPING);
    expect(result['sessionMinutes']).toBe(-15);
  });

  it('un campo numérico sin respuesta se omite', () => {
    const result = mapFormFields([campo('¿Cuánto tiempo tienes por sesión?', null)], MAPPING);
    expect('sessionMinutes' in result).toBe(false);
  });
});
