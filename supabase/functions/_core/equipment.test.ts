/**
 * SPEC-028 §4 — El nivel de equipamiento de un cliente, a partir de lo que
 * marcó en el formulario.
 *
 * Los textos son los REALES del formulario de Tally. Si Ana renombra una
 * opción, este archivo es el que tiene que ponerse en rojo.
 */
import { describe, expect, it } from 'vitest';
import { canDo, equipmentTier, FORM_OPTIONS } from './equipment.ts';

describe('las nueve opciones del formulario', () => {
  it('se conocen todas, con su texto exacto', () => {
    expect(FORM_OPTIONS).toEqual([
      'Sin equipamiento',
      'Mancuernas',
      'Barra y discos',
      'Bandas elásticas',
      'Banco',
      'Kettlebell',
      'Máquinas de gimnasio',
      'Cardio (cinta, bicicleta, elíptica, etc.)',
      'Otro',
    ]);
  });

  it.each([
    ['Sin equipamiento', 'none'],
    ['Mancuernas', 'free_weights'],
    ['Barra y discos', 'free_weights'],
    ['Bandas elásticas', 'bands'],
    ['Kettlebell', 'free_weights'],
    ['Máquinas de gimnasio', 'gym'],
    // Por sí solos no alcanzan para una plantilla de fuerza.
    ['Banco', 'none'],
    ['Cardio (cinta, bicicleta, elíptica, etc.)', 'none'],
  ] as const)('«%s» → %s', (opcion, nivel) => {
    expect(equipmentTier(opcion)).toBe(nivel);
  });

  it('solo «Otro» no dice nada: el nivel es desconocido', () => {
    expect(equipmentTier('Otro')).toBeNull();
  });
});

describe('varias opciones: cuenta la más alta', () => {
  it.each([
    ['Mancuernas, Bandas elásticas', 'free_weights'],
    ['Bandas elásticas, Máquinas de gimnasio', 'gym'],
    ['Banco, Bandas elásticas', 'bands'],
    ['Banco, Otro', 'none'],
    // CA-7. Contradictorio, y pasa en datos reales: se toma lo más alto.
    ['Sin equipamiento, Mancuernas', 'free_weights'],
    // El caso de `pipeline.test.ts`. Las comas de «Cardio (…)» no confunden.
    ['Sin equipamiento, Banco, Cardio (cinta, bicicleta, elíptica, etc.)', 'none'],
  ] as const)('«%s» → %s', (texto, nivel) => {
    expect(equipmentTier(texto)).toBe(nivel);
  });
});

describe('lo que escribe una persona o manda Tally sin limpiar', () => {
  it('no distingue mayúsculas ni tildes', () => {
    expect(equipmentTier('MAQUINAS DE GIMNASIO')).toBe('gym');
    expect(equipmentTier('bandas elasticas')).toBe('bands');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['vacío', ''],
    ['solo espacios', '   '],
    ['un texto que no es ninguna opción', 'Una toalla'],
  ])('%s → desconocido', (_caso, valor) => {
    expect(equipmentTier(valor)).toBeNull();
  });
});

describe('canDo: quién puede hacer qué', () => {
  it.each([
    ['gym', 'none', true],
    ['gym', 'gym', true],
    ['free_weights', 'bands', true],
    ['free_weights', 'gym', false],
    ['bands', 'free_weights', false],
    ['none', 'bands', false],
    ['none', 'none', true],
  ] as const)('cliente %s, plantilla %s → %s', (cliente, plantilla, puede) => {
    expect(canDo(cliente, plantilla)).toBe(puede);
  });
});
