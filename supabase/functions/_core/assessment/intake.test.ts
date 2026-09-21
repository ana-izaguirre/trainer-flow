/**
 * SPEC-015 — La ficha de admisión.
 *
 * Lo que más importa aquí: que sea el ÚNICO mensaje con `limitationsDetail`,
 * y que aun así no lo vea nadie que no sea el entrenador dueño.
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import type { IntakeForVersion, IntakeRepo } from '../ports/intake-ports.ts';
import { formatIntake, showIntake, type IntakeDeps } from './intake.ts';

const VERSION_ID = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';

const ENTRENADOR: Identity = {
  profileId: 'p-trainer',
  role: 'trainer',
  telegramUserId: 10,
  telegramChatId: 10,
};

const OTRO_ENTRENADOR: Identity = { ...ENTRENADOR, profileId: 'p-otro' };
const CLIENTE: Identity = { ...ENTRENADOR, profileId: 'p-cliente', role: 'client' };

function ficha(extra: Partial<IntakeForVersion> = {}): IntakeForVersion {
  return {
    versionId: VERSION_ID,
    state: 'NEW',
    client: { clientId: 'c-1', trainerId: 'p-trainer', profileId: 'p-cliente' },
    clientName: 'Carlos Pérez',
    goal: 'Ganancia muscular',
    level: 'beginner',
    daysPerWeek: 3,
    sessionMinutes: 60,
    equipment: 'Gimnasio completo',
    hasLimitations: true,
    limitationsDetail: 'Hernia discal L4-L5, evitar carga axial',
    lifestyle: 'Trabajo de oficina, poco movimiento',
    notes: 'Quiero llegar bien al verano',
    submittedAt: new Date('2026-03-14T10:00:00Z'),
    gender: 'Hombre',
    age: 34,
    weightKg: 78.5,
    heightCm: 180,
    lastWeighed: 'Hace una semana',
    quitReasons: 'Falta de tiempo, falta de motivación',
    menopauseStage: null,
    chronicConditions: 'Diabetes tipo 2. Padre con hipertensión.',
    medications: 'Metformina 850 mg, 2 al día',
    birthDate: '1992-03-12',
    ...extra,
  };
}

function espia(intake: IntakeForVersion | null = ficha()) {
  const enviados: string[] = [];
  const repo: IntakeRepo = { findIntake: () => Promise.resolve(intake) };

  const deps: IntakeDeps = {
    repo,
    sender: {
      sendMessage: (_chatId, text) => {
        enviados.push(text);
        return Promise.resolve();
      },
      answerCallback: () => Promise.resolve(),
    },
  };

  return { deps, enviados };
}

describe('formatIntake', () => {
  it('CA-1 · trae todo lo que contestó', () => {
    const texto = formatIntake(ficha());

    expect(texto).toContain('Carlos Pérez');
    expect(texto).toContain('Ganancia muscular');
    expect(texto).toContain('Principiante');
    expect(texto).toContain('3 días');
    expect(texto).toContain('60 min');
    expect(texto).toContain('Gimnasio completo');
    expect(texto).toContain('Trabajo de oficina');
    expect(texto).toContain('verano');
    expect(texto).toContain('14/03/2026');
  });

  it('el detalle de la limitación SÍ va: es el motivo de la spec', () => {
    // El aviso de nueva evaluación dice QUE hay, no cuáles. Aquí sí, porque
    // este mensaje se pide pulsando un botón.
    expect(formatIntake(ficha())).toContain('Hernia discal L4\\-L5');
  });

  it('CA-3 · un campo vacío no se pinta', () => {
    const texto = formatIntake(ficha({ lifestyle: null, notes: '   ' }));

    expect(texto).not.toContain('Estilo de vida');
    expect(texto).not.toContain('Lo que quiere que sepas');
  });

  it('sin limitaciones lo dice, en vez de callar', () => {
    expect(formatIntake(ficha({ hasLimitations: false, limitationsDetail: null }))).toContain(
      'Sin limitaciones',
    );
  });

  it('marcó limitaciones pero no detalló: se distingue de no tener', () => {
    const texto = formatIntake(ficha({ limitationsDetail: null }));

    expect(texto).toContain('no detalló');
    expect(texto).not.toContain('Sin limitaciones');
  });

  it('escapa lo que rompería el formato', () => {
    expect(formatIntake(ficha({ notes: 'Entreno (a veces) con mi hermano' }))).toContain('\\(');
  });
});

describe('showIntake', () => {
  it('CA-1 · el dueño la recibe', async () => {
    const e = espia();

    expect(await showIntake(VERSION_ID, ENTRENADOR, e.deps)).toEqual({
      kind: 'shown',
      versionId: VERSION_ID,
    });
    expect(e.enviados[0]).toContain('Hernia');
  });

  it.each([
    ['otro entrenador', OTRO_ENTRENADOR],
    ['un cliente', CLIENTE],
  ])('CA-4 · %s no ve NI UN campo', async (_quien, intruso) => {
    const e = espia();

    const r = await showIntake(VERSION_ID, intruso, e.deps);

    expect(r.kind).toBe('rejected');
    expect(e.enviados.join('')).not.toContain('Hernia');
    expect(e.enviados.join('')).not.toContain('Carlos');
    expect(e.enviados.join('')).not.toContain('Ganancia');
  });

  it('CA-5 · una versión sin evaluación lo dice, no revienta', async () => {
    const e = espia(null);

    expect((await showIntake(VERSION_ID, ENTRENADOR, e.deps)).kind).toBe('rejected');
    expect(e.enviados).toHaveLength(1);
  });

  it('negar suena igual que no existir', async () => {
    const ajena = espia();
    const inexistente = espia(null);

    await showIntake(VERSION_ID, CLIENTE, ajena.deps);
    await showIntake(VERSION_ID, ENTRENADOR, inexistente.deps);

    expect(ajena.enviados[0]).toBe(inexistente.enviados[0]);
  });
});

// ─── SPEC-016 · los campos nuevos en la ficha ──────────────────────────────

describe('los campos de SPEC-016 en la ficha', () => {
  it('CA-5 · las enfermedades crónicas SÍ se ven aquí', () => {
    // Es el único sitio del sistema donde aparecen.
    const texto = formatIntake(ficha());

    expect(texto).toContain('Diabetes tipo 2');
    expect(texto).toContain('hipertensión');
    expect(texto).toContain('🩺');
  });

  it('los datos físicos van juntos, en una línea', () => {
    const texto = formatIntake(ficha());

    expect(texto).toContain('Hombre · 34 años \\(1992\\-03\\-12\\) · 78\\.5 kg · 180 cm');
  });

  it('el último pesaje va pegado a los datos: dice si el peso es fiable', () => {
    expect(formatIntake(ficha())).toContain('Último pesaje: Hace una semana');
  });

  it('por qué abandonó, y la etapa cuando la hay', () => {
    const texto = formatIntake(ficha({ menopauseStage: 'Perimenopausia' }));

    expect(texto).toContain('Falta de tiempo');
    expect(texto).toContain('Perimenopausia');
  });

  it('CA-3 · una evaluación vieja, sin ningún campo nuevo, se pinta igual', () => {
    const texto = formatIntake(
      ficha({
        gender: null,
        age: null,
        weightKg: null,
        heightCm: null,
        lastWeighed: null,
        quitReasons: null,
        menopauseStage: null,
        chronicConditions: null,
      }),
    );

    expect(texto).toContain('Carlos Pérez');
    expect(texto).not.toContain('🩺');
    expect(texto).not.toContain('👤');
    expect(texto).not.toContain('null');
  });

  it('un intruso tampoco ve las enfermedades', async () => {
    const e = espia();

    await showIntake(VERSION_ID, CLIENTE, e.deps);

    expect(e.enviados.join('')).not.toContain('Diabetes');
  });
});

it('sin género pero con peso: la línea sale igual, sin separador huérfano', () => {
  // Pasa de verdad: «Género» es opcional y el peso no.
  const texto = formatIntake(ficha({ gender: null }));

  expect(texto).toContain('👤 34 años \\(1992\\-03\\-12\\) · 78\\.5 kg · 180 cm');
  expect(texto).not.toContain('·  ·');
});
