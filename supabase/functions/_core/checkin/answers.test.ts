/**
 * SPEC-006 — Las respuestas del check-in.
 *
 * ┌─ LA REGLA QUE IMPORTA ES LA 7 ─────────────────────────────────────────┐
 * │ Si el cliente reporta una molestia, el entrenador se entera DE         │
 * │ INMEDIATO. No al final de la semana, no cuando abra el bot: en ese     │
 * │ momento.                                                               │
 * │                                                                        │
 * │ Un dolor que aparece el martes y se avisa el domingo es una lesión     │
 * │ que se pudo evitar.                                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import {
  buildCheckinCallback,
  isComplete,
  mergeAnswer,
  needsTrainerAlert,
  parseCheckinCallback,
  EMPTY_ANSWERS,
} from './answers.ts';

const CHECKIN = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

// ---------------------------------------------------------------------------

describe('los botones caben en 64 bytes', () => {
  it.each([
    ['sessions', '3'],
    ['feeling', 'good'],
    ['discomfort', 'none'],
  ] as const)('%s=%s', (campo, valor) => {
    const data = buildCheckinCallback(campo, valor, CHECKIN);
    expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
  });

  it('todo lo que se construye se vuelve a leer', () => {
    const data = buildCheckinCallback('feeling', 'hard', CHECKIN);
    expect(parseCheckinCallback(data)).toEqual({
      field: 'feeling',
      value: 'hard',
      checkinId: CHECKIN,
    });
  });

  it('no se confunde con el callback de una versión', () => {
    // Los dos viajan por el mismo canal. Si un prefijo leyera el del otro,
    // pulsar «Bien» en un check-in podría aprobar una rutina.
    expect(parseCheckinCallback(`act:approve:${CHECKIN}`)).toBeNull();
  });

  it.each(['basura', '', 'chk:inventado:x', `chk:feeling:no-es-uuid`])(
    'rechaza %s',
    (raw) => {
      expect(parseCheckinCallback(raw)).toBeNull();
    },
  );

  it('un campo inventado con forma válida se rechaza', () => {
    // La forma cuadra, el campo no existe. Sin esta comprobación entraría
    // como si fuera bueno.
    expect(parseCheckinCallback(`chk:inventado:none:${CHECKIN}`)).toBeNull();
  });

  it('un valor que no es de ese campo se rechaza', () => {
    // «feeling=7» no existe. Aceptarlo guardaría basura en `answers`.
    expect(parseCheckinCallback(`chk:feeling:7:${CHECKIN}`)).toBeNull();
    expect(parseCheckinCallback(`chk:sessions:good:${CHECKIN}`)).toBeNull();
  });
});

describe('se va completando por partes', () => {
  it('cada respuesta se suma a las anteriores', () => {
    // Regla: una respuesta parcial se guarda y el check-in sigue PENDING.
    let answers = mergeAnswer(EMPTY_ANSWERS, { field: 'sessions', value: '3' });
    expect(answers).toEqual({ sessions: 3, feeling: null, discomfort: null });

    answers = mergeAnswer(answers, { field: 'feeling', value: 'good' });
    expect(answers).toEqual({ sessions: 3, feeling: 'good', discomfort: null });
  });

  it('responder dos veces lo mismo se queda con lo último', () => {
    const answers = mergeAnswer(
      mergeAnswer(EMPTY_ANSWERS, { field: 'sessions', value: '1' }),
      { field: 'sessions', value: '4' },
    );
    expect(answers.sessions).toBe(4);
  });

  it('«4+» se guarda como 4', () => {
    expect(mergeAnswer(EMPTY_ANSWERS, { field: 'sessions', value: '4' }).sessions).toBe(4);
  });

  it('«ninguna molestia» se guarda como tal, no como ausencia', () => {
    // Distinguir «dijo que ninguna» de «no contestó» es lo que permite saber
    // si el check-in está completo.
    const answers = mergeAnswer(EMPTY_ANSWERS, { field: 'discomfort', value: 'none' });
    expect(answers.discomfort).toBe('');
  });

  it('una molestia escrita se guarda', () => {
    const answers = mergeAnswer(EMPTY_ANSWERS, { field: 'discomfort', value: 'Rodilla derecha' });
    expect(answers.discomfort).toBe('Rodilla derecha');
  });

  it('el texto libre se trunca, no se rechaza', () => {
    const largo = 'x'.repeat(900);
    const answers = mergeAnswer(EMPTY_ANSWERS, { field: 'discomfort', value: largo });
    expect(answers.discomfort?.length).toBe(500);
  });
});

describe('cuándo está completo', () => {
  it('con las tres respuestas', () => {
    expect(isComplete({ sessions: 3, feeling: 'good', discomfort: '' })).toBe(true);
  });

  it.each([
    [{ sessions: null, feeling: 'good' as const, discomfort: '' }],
    [{ sessions: 3, feeling: null, discomfort: '' }],
    [{ sessions: 3, feeling: 'good' as const, discomfort: null }],
  ])('sin alguna, no: %o', (answers) => {
    expect(isComplete(answers)).toBe(false);
  });

  it('sesiones = 0 cuenta como respondido', () => {
    // El cero es una respuesta, y probablemente la más importante.
    expect(isComplete({ sessions: 0, feeling: 'hard', discomfort: '' })).toBe(true);
  });
});

describe('el aviso inmediato al entrenador', () => {
  it('una molestia reportada lo dispara', () => {
    // CA-4 y regla 7. Un dolor que aparece el martes y se avisa el domingo es
    // una lesión que se pudo evitar.
    expect(needsTrainerAlert({ sessions: 3, feeling: 'good', discomfort: 'Rodilla' })).toBe(true);
  });

  it('«ninguna» no lo dispara', () => {
    expect(needsTrainerAlert({ sessions: 3, feeling: 'good', discomfort: '' })).toBe(false);
  });

  it('sin contestar todavía, tampoco', () => {
    expect(needsTrainerAlert({ sessions: 3, feeling: 'good', discomfort: null })).toBe(false);
  });

  it('«muy duro» también avisa, aunque no haya molestia', () => {
    // Tres semanas de «muy duro» sin que nadie mire es cómo se abandona un
    // plan. El entrenador decide si ajusta.
    expect(needsTrainerAlert({ sessions: 1, feeling: 'hard', discomfort: '' })).toBe(true);
  });

  it('un espacio en blanco no cuenta como molestia', () => {
    expect(needsTrainerAlert({ sessions: 3, feeling: 'good', discomfort: '   ' })).toBe(false);
  });
});
