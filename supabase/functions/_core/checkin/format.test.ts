/**
 * SPEC-006 §3 — Los mensajes del check-in.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_ANSWERS, parseCheckinCallback, type CheckinAnswers } from './answers.ts';
import {
  buildCheckinMessage,
  buildReminderMessage,
  formatCheckinAck,
  formatCheckinSummary,
  formatTrainerAlert,
} from './format.ts';

const CHECKIN_ID = '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const COMPLETAS: CheckinAnswers = { sessions: 3, feeling: 'good', discomfort: '' };

/** Todos los botones del teclado, aplanados. */
function botones(keyboard: { inline_keyboard: readonly (readonly { callback_data: string }[])[] }) {
  return keyboard.inline_keyboard.flat();
}

// ---------------------------------------------------------------------------

describe('el check-in del cliente', () => {
  it('dice de qué semana es', () => {
    expect(buildCheckinMessage(3, CHECKIN_ID).text).toContain('semana 3');
  });

  it('las tres preguntas van en UN solo mensaje', () => {
    // Tres mensajes seguidos se leen como tres notificaciones y se contesta
    // el último.
    const { text, keyboard } = buildCheckinMessage(1, CHECKIN_ID);

    expect(text).toContain('1️⃣');
    expect(text).toContain('2️⃣');
    expect(text).toContain('3️⃣');
    expect(keyboard.inline_keyboard).toHaveLength(3);
  });

  it('CADA botón produce un callback que se puede volver a leer', () => {
    // Un `callback_data` que no se parsea es un botón que no hace nada, y
    // Telegram no avisa de eso.
    for (const boton of botones(buildCheckinMessage(1, CHECKIN_ID).keyboard)) {
      expect(parseCheckinCallback(boton.callback_data), boton.callback_data).not.toBeNull();
    }
  });

  it('ningún botón pasa los 64 bytes de Telegram', () => {
    // Pasarse NO da error al construirlo: Telegram rechaza el mensaje entero.
    for (const boton of botones(buildCheckinMessage(99, CHECKIN_ID).keyboard)) {
      expect(new TextEncoder().encode(boton.callback_data).length, boton.callback_data)
        .toBeLessThanOrEqual(64);
    }
  });

  it('el recordatorio lleva el MISMO teclado', () => {
    // Sin botones, el cliente tendría que buscar el mensaje anterior.
    const recordatorio = buildReminderMessage(2, CHECKIN_ID);

    expect(recordatorio.keyboard).toEqual(buildCheckinMessage(2, CHECKIN_ID).keyboard);
    expect(recordatorio.text).toContain('semana 2');
  });
});

describe('el resumen para el entrenador', () => {
  it('cuenta las sesiones sobre el total planificado', () => {
    // «3 de 4» dice si la semana fue buena. «3» a secas, no.
    expect(formatCheckinSummary('Carlos', 3, COMPLETAS, 4)).toContain('3 de 4');
  });

  it('sin total planificado, solo el número', () => {
    expect(formatCheckinSummary('Carlos', 3, COMPLETAS)).toContain('Sesiones: 3');
  });

  it('«4» se lee como «4 o más»', () => {
    const texto = formatCheckinSummary('Carlos', 1, { ...COMPLETAS, sessions: 4 }, 4);
    expect(texto).toContain('4 o más');
  });

  it('distingue «ninguna molestia» de «no contestó»', () => {
    // `''` y `null` no son lo mismo, y confundirlos haría creer al entrenador
    // que un cliente dijo que está bien cuando no dijo nada.
    expect(formatCheckinSummary('Carlos', 1, COMPLETAS)).toContain('Molestias: ninguna');
    expect(
      formatCheckinSummary('Carlos', 1, { ...COMPLETAS, discomfort: null }),
    ).toContain('Molestias: sin contestar');
  });

  it('un check-in a medias se lee igual', () => {
    const texto = formatCheckinSummary('Carlos', 1, {
      sessions: null,
      feeling: null,
      discomfort: null,
    });

    expect(texto).toContain('Sesiones: sin contestar');
    expect(texto).toContain('Sensación: sin contestar');
  });

  it('escapa un nombre con caracteres de MarkdownV2', () => {
    // El nombre lo escribió un desconocido en Tally. Un `[` sin escapar hace
    // que Telegram rechace el mensaje entero.
    expect(formatCheckinSummary('Ana [la jefa]', 1, COMPLETAS)).toContain('Ana \\[la jefa\\]');
  });
});

describe('el aviso inmediato', () => {
  it('una molestia se nombra como tal', () => {
    const texto = formatTrainerAlert('Carlos', 3, {
      ...COMPLETAS,
      discomfort: 'molestia de hombro',
    });

    expect(texto).toContain('Reportó una molestia');
    expect(texto).toContain('molestia de hombro');
  });

  it('un «muy duro» sin molestia se nombra distinto', () => {
    const texto = formatTrainerAlert('Carlos', 3, { ...COMPLETAS, feeling: 'hard' });

    expect(texto).toContain('muy dura');
  });

  it('lleva el resumen completo, no solo el motivo', () => {
    // El entrenador decide si ajusta; para eso necesita el contexto entero.
    const texto = formatTrainerAlert('Carlos', 3, { ...COMPLETAS, feeling: 'hard' });

    expect(texto).toContain('Sesiones:');
    expect(texto).toContain('Sensación:');
    expect(texto).toContain('semana 3');
  });
});

describe('SPEC-030 regla 9 · el acuse de cada botón', () => {
  it('sesiones: singular en 1, plural en el resto, «4 o más» en 4', () => {
    expect(
      formatCheckinAck({ field: 'sessions', value: '0' }, { ...EMPTY_ANSWERS, sessions: 0 }),
    ).toContain('0 sesiones');
    expect(
      formatCheckinAck({ field: 'sessions', value: '1' }, { ...EMPTY_ANSWERS, sessions: 1 }),
    ).toContain('1 sesión.');
    expect(
      formatCheckinAck({ field: 'sessions', value: '3' }, { ...EMPTY_ANSWERS, sessions: 3 }),
    ).toContain('3 sesiones');
    expect(
      formatCheckinAck({ field: 'sessions', value: '4' }, { ...EMPTY_ANSWERS, sessions: 4 }),
    ).toContain('4 o más sesiones');
  });

  it('sensación: el mismo texto que en el resumen', () => {
    const texto = formatCheckinAck(
      { field: 'feeling', value: 'good' },
      { ...EMPTY_ANSWERS, feeling: 'good' },
    );
    expect(texto).toContain('💪 Bien');
  });

  it('molestia por botón siempre es «sin molestias»', () => {
    const texto = formatCheckinAck(
      { field: 'discomfort', value: 'none' },
      { ...EMPTY_ANSWERS, discomfort: '' },
    );
    expect(texto).toContain('sin molestias');
  });

  it('nombra la SIGUIENTE pregunta que falta, en orden', () => {
    expect(
      formatCheckinAck({ field: 'sessions', value: '3' }, { ...EMPTY_ANSWERS, sessions: 3 }),
    ).toContain('Falta: ¿cómo te sentiste?');

    expect(
      formatCheckinAck(
        { field: 'feeling', value: 'good' },
        { sessions: 3, feeling: 'good', discomfort: null },
      ),
    ).toContain('Falta: ¿alguna molestia?');
  });

  it('completas las tres, no dice «Falta»', () => {
    const texto = formatCheckinAck({ field: 'discomfort', value: 'none' }, COMPLETAS);
    expect(texto).not.toContain('Falta');
  });

  it('texto plano: nada de MarkdownV2', () => {
    // El aviso emergente de Telegram no interpreta Markdown.
    const texto = formatCheckinAck(
      { field: 'sessions', value: '3' },
      { ...EMPTY_ANSWERS, sessions: 3 },
    );
    expect(texto).not.toMatch(/\\/);
  });
});
