/**
 * SPEC-003 — Los avisos que recibe el entrenador.
 *
 * Hoy el sistema hace todo bien y no se lo dice a nadie: llega una evaluación,
 * se crean las cuatro filas, y el entrenador se entera si mira la base de
 * datos. Esto es lo que cierra ese hueco.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAssessmentArrived,
  buildDraftReady,
  buildGenerationFailed,
} from './notify.ts';
import { parseCallbackData } from './callback-data.ts';
import type { InlineKeyboard } from './keyboard.ts';

const VERSION = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

const RESUMEN = {
  clientName: 'Carlos Pérez',
  goal: 'Ganancia muscular',
  level: 'intermediate',
  daysPerWeek: 4,
  sessionMinutes: 60,
  equipment: 'Mancuernas',
  hasLimitations: false,
} as const;

const RUTINA = {
  summary: 'Cuatro días de fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press banca', sets: 4, reps: '8', restSeconds: 120, notes: null }],
    },
  ],
  warnings: [],
};

// ---------------------------------------------------------------------------

/** Las acciones de un teclado, en orden, leídas de su `callback_data`. */
function acciones(keyboard: InlineKeyboard | null): (string | undefined)[] {
  return (keyboard?.inline_keyboard ?? [])
    .flat()
    .map((b) => parseCallbackData(b.callback_data)?.action);
}

describe('llegó una evaluación', () => {
  it('dice de quién y lo que pidió', () => {
    const { text } = buildAssessmentArrived(RESUMEN, VERSION);

    expect(text).toContain('Carlos');
    expect(text).toContain('Ganancia muscular');
    expect(text).toContain('4');
    expect(text).toContain('Mancuernas');
  });

  it('el nivel va en palabras, no como código interno', () => {
    const { text } = buildAssessmentArrived(RESUMEN, VERSION);
    expect(text.toLowerCase()).toContain('intermedio');
    expect(text).not.toContain('intermediate');
  });

  it('AVISA de que hay limitaciones, pero NO cuáles', () => {
    // El detalle es información de salud. Un aviso de Telegram se ve en la
    // pantalla de bloqueo, con el móvil encima de la mesa. La limitación se
    // lee al abrir la rutina, no en la previsualización.
    const { text } = buildAssessmentArrived(
      { ...RESUMEN, hasLimitations: true, limitationsDetail: 'Hernia discal L4-L5' },
      VERSION,
    );

    expect(text).toContain('⚠️');
    expect(text).not.toContain('Hernia');
    expect(text).not.toContain('L4');
  });

  it('sin limitaciones no hay aviso de limitaciones', () => {
    const { text } = buildAssessmentArrived(RESUMEN, VERSION);
    expect(text).not.toContain('⚠️');
  });

  it('lleva los tres botones de crear', () => {
    // Antes no llevaba ninguno, y el texto decía «preparando el borrador»:
    // nadie lo preparaba. Ahora pregunta, y las tres respuestas son botones.
    const aviso = buildAssessmentArrived(RESUMEN, VERSION);

    expect(aviso.keyboard).not.toBeNull();
    expect(acciones(aviso.keyboard)).toEqual(['generate', 'template', 'manual']);
    expect(aviso.text).toContain('¿Cómo preparamos la rutina?');
  });

  it('escapa lo que pueda romper el formato', () => {
    // Un cliente que se llame «Ana (la del gym)» no puede tumbar el mensaje.
    const { text } = buildAssessmentArrived({ ...RESUMEN, clientName: 'Ana (la del gym)' }, VERSION);
    expect(text).toContain('\\(');
  });
});

describe('el borrador está listo', () => {
  it('trae la rutina formateada', () => {
    const { text } = buildDraftReady(RUTINA, { clientName: 'Carlos', versionNumber: 1 }, VERSION);

    expect(text).toContain('Carlos');
    expect(text).toContain('Press banca');
  });

  it('trae los tres botones, apuntando a esta versión', () => {
    const { keyboard } = buildDraftReady(RUTINA, { clientName: 'C', versionNumber: 1 }, VERSION);

    expect(keyboard).not.toBeNull();
    expect(acciones(keyboard)).toEqual(['edit', 'approve', 'reject']);
    // Todos apuntan a ESTA versión: un botón con otro id tocaría otra rutina.
    const ids = keyboard!.inline_keyboard
      .flat()
      .map((b) => parseCallbackData(b.callback_data)?.versionId);
    expect(ids.every((id) => id === VERSION)).toBe(true);
  });
});

describe('la IA no pudo', () => {
  it('dice qué pasó en palabras, no con un código', () => {
    const { text } = buildGenerationFailed('RATE_LIMITED', VERSION);

    expect(text).not.toContain('RATE_LIMITED');
    expect(text.length).toBeGreaterThan(10);
  });

  it.each(['API_ERROR', 'TIMEOUT'] as const)(
    '%s SÍ ofrece reintentar: suele ser pasajero',
    (reason) => {
      const { keyboard, text } = buildGenerationFailed(reason, VERSION);

      expect(acciones(keyboard)).toEqual(['generate', 'template', 'manual']);
      expect(text).toContain('reintentar');
    },
  );

  it.each(['RATE_LIMITED', 'INVALID_OUTPUT'] as const)(
    '%s NO ofrece reintentar: fallaría igual',
    (reason) => {
      // Un botón que va a fallar gasta una pulsación, hace esperar, y enseña
      // al entrenador a desconfiar de los botones.
      const { keyboard, text } = buildGenerationFailed(reason, VERSION);

      expect(acciones(keyboard)).toEqual(['template', 'manual']);
      expect(text).not.toContain('reintentar');
    },
  );

  it('pero SIEMPRE quedan plantilla y manual: el producto no se bloquea', () => {
    // La degradación del ADR-005 hecha botón.
    for (const reason of ['RATE_LIMITED', 'TIMEOUT', 'API_ERROR', 'INVALID_OUTPUT'] as const) {
      const salidas = acciones(buildGenerationFailed(reason, VERSION).keyboard);
      expect(salidas, reason).toContain('template');
      expect(salidas, reason).toContain('manual');
    }
  });

  it('cada motivo tiene su mensaje: «falló» a secas no dice nada', () => {
    const textos = (['RATE_LIMITED', 'TIMEOUT', 'API_ERROR', 'INVALID_OUTPUT'] as const).map(
      (r) => buildGenerationFailed(r, VERSION).text,
    );

    expect(new Set(textos).size).toBe(4);
  });
});
