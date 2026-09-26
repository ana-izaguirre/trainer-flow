/**
 * SPEC-008 — El editor sobre el borrador en curso.
 */
import { describe, expect, it } from 'vitest';
import type { CreationRepo, CurrentDraft } from '../ports/creation-ports.ts';
import type { Workout } from '../domain/workout.ts';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import { handleEditorCommand, isEditorCommand, type EditorDeps } from './editor-session.ts';

const TRAINER = 'p-entrenador';
const CHAT = 10;

const RUTINA: Workout = {
  summary: 'Fuerza',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [{ name: 'Press banca', sets: 4, reps: '8', restSeconds: 90, notes: null }],
    },
  ],
  warnings: [],
};

function borrador(extra: Partial<CurrentDraft> = {}): CurrentDraft {
  return {
    versionId: 'v1',
    versionNumber: 1,
    clientName: 'Carlos Pérez',
    content: RUTINA,
    ...extra,
  };
}

interface Espia {
  readonly deps: EditorDeps;
  readonly pasos: string[];
  readonly mensajes: string[];
  readonly guardado: Workout[];
}

function espia(
  opciones: { draft?: CurrentDraft | null; guardarFalla?: boolean } = {},
): Espia {
  const pasos: string[] = [];
  const mensajes: string[] = [];
  const guardado: Workout[] = [];

  const repo: CreationRepo = {
    findVersion: () => Promise.resolve(null),
    fillVersion: () => Promise.resolve(true),
    currentDraft: (trainerId) => {
      pasos.push(`currentDraft:${trainerId}`);
      return Promise.resolve(opciones.draft === undefined ? borrador() : opciones.draft);
    },
    saveDraft: (_v, content) => {
      pasos.push('saveDraft');
      guardado.push(content);
      return Promise.resolve(!(opciones.guardarFalla ?? false));
    },
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (_c, text) => {
          pasos.push('sendMessage');
          mensajes.push(text);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    },
    pasos,
    mensajes,
    guardado,
  };
}

// ---------------------------------------------------------------------------

describe('qué comandos son suyos', () => {
  it.each(['dia', 'día', 'add', 'quitar', 'nota', 'ver'])('%s sí', (c) => {
    expect(isEditorCommand(c)).toBe(true);
  });

  it.each(['clientes', 'pendientes', 'start', 'ayuda'])('%s no', (c) => {
    expect(isEditorCommand(c)).toBe(false);
  });

  it('uno que no es suyo se devuelve sin tocar nada', async () => {
    const { deps, pasos } = espia();

    expect(await handleEditorCommand('clientes', '', TRAINER, CHAT, deps)).toEqual({
      kind: 'not_an_editor_command',
    });
    expect(pasos).toEqual([]);
  });
});

describe('editar', () => {
  it('añade un ejercicio y lo guarda', async () => {
    const { deps, guardado } = espia();

    const outcome = await handleEditorCommand('add', '1 Remo 3x10 60', TRAINER, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'edited' });
    expect(guardado[0]?.days[0]?.exercises).toHaveLength(2);
  });

  it('CA-13 · la respuesta dice DE QUIÉN es el borrador', async () => {
    // El contexto es implícito: si tenía otro cliente en mente, lo ve ahora.
    const { deps, mensajes } = espia();

    await handleEditorCommand('add', '1 Remo 3x10', TRAINER, CHAT, deps);

    expect(mensajes.at(-1)).toContain('Carlos');
  });

  it('pide el borrador del entrenador que escribe, no otro', async () => {
    const { deps, pasos } = espia();

    await handleEditorCommand('ver', '', TRAINER, CHAT, deps);

    expect(pasos).toContain(`currentDraft:${TRAINER}`);
  });

  it('CA-15 · un día sin ejercicios se guarda igual', async () => {
    // Si se validara entero en cada edición, el primer comando siempre
    // fallaría y no habría forma de construir una rutina paso a paso.
    const { deps, guardado } = espia();

    const outcome = await handleEditorCommand('dia', '2 Tirón', TRAINER, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'edited' });
    expect(guardado[0]?.days).toHaveLength(2);
    expect(guardado[0]?.days[1]?.exercises).toEqual([]);
  });

  it('`día` con tilde funciona igual', async () => {
    const { deps, guardado } = espia();

    expect(await handleEditorCommand('día', '2 Tirón', TRAINER, CHAT, deps)).toMatchObject({
      kind: 'edited',
    });
    expect(guardado[0]?.days).toHaveLength(2);
  });

  it('`/ver` enseña y no guarda', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await handleEditorCommand('ver', '', TRAINER, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'shown' });
    expect(pasos).not.toContain('saveDraft');
    expect(mensajes[0]).toContain('Press banca');
  });

  it('quita un ejercicio', async () => {
    const { deps, guardado } = espia();

    await handleEditorCommand('quitar', '1 1', TRAINER, CHAT, deps);

    expect(guardado[0]?.days[0]?.exercises).toEqual([]);
  });
});

describe('lo que no se puede', () => {
  it('CA-14 · sin borrador abierto se dice, y no se guarda nada', async () => {
    const { deps, pasos, mensajes } = espia({ draft: null });

    const outcome = await handleEditorCommand('add', '1 Remo 3x10', TRAINER, CHAT, deps);

    expect(outcome).toEqual({ kind: 'no_draft' });
    expect(pasos).not.toContain('saveDraft');
    expect(mensajes[0]).toContain('borrador');
  });

  // SPEC-022 M2. «Pulsa 📋 o ✍️ en el aviso de un cliente» mandaba a buscar
  // un mensaje enterrado en el chat. `/cliente` lleva esos botones.
  it('CA-M2 · sin borrador abierto nombra /cliente, el camino que existe', async () => {
    const { deps, mensajes } = espia({ draft: null });

    await handleEditorCommand('crear_rutina', 'Día 1: A\nPress 4x8', TRAINER, CHAT, deps);

    expect(mensajes[0]).toContain('/cliente');
    expect(mensajes[0]).toContain('/crear\\_rutina');
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });

  it('un comando mal escrito explica la sintaxis', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await handleEditorCommand('add', 'esto no vale', TRAINER, CHAT, deps);

    expect(outcome.kind).toBe('invalid');
    expect(pasos).not.toContain('saveDraft');
    // No un «error» a secas: dice qué se esperaba.
    expect(mensajes[0]!.length).toBeGreaterThan(20);
  });

  it('un valor fuera de rango se rechaza', async () => {
    // 15 series no se guardan aunque las escriba el entrenador (regla 4).
    const { deps, pasos } = espia();

    const outcome = await handleEditorCommand('add', '1 Press 15x8', TRAINER, CHAT, deps);

    expect(outcome.kind).toBe('invalid');
    expect(pasos).not.toContain('saveDraft');
  });

  it('quitar un ejercicio que no existe se explica', async () => {
    const { deps, pasos } = espia();

    const outcome = await handleEditorCommand('quitar', '1 9', TRAINER, CHAT, deps);

    expect(outcome.kind).toBe('invalid');
    expect(pasos).not.toContain('saveDraft');
  });

  it('si se aprobó mientras escribía, se le dice', async () => {
    // Su cambio no se pierde en silencio.
    const { deps, mensajes } = espia({ guardarFalla: true });

    const outcome = await handleEditorCommand('add', '1 Remo 3x10', TRAINER, CHAT, deps);

    expect(outcome).toEqual({ kind: 'not_draft_anymore' });
    expect(mensajes.at(-1)).toContain('no se aplicó');
  });
});

// ---------------------------------------------------------------------------

describe('SPEC-022 · /crear_rutina — la rutina entera en un mensaje', () => {
  const DICTADA = `Día 1: Empuje
Press banca 4x8 90
Press militar 3x10

Día 2: Tirón
Dominadas 4x6 120`;

  it('reemplaza los días de golpe', async () => {
    const { deps, guardado } = espia();

    const outcome = await handleEditorCommand('crear_rutina', DICTADA, TRAINER, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'edited' });
    expect(guardado[0]?.days).toHaveLength(2);
    expect(guardado[0]?.days[1]?.exercises[0]?.name).toBe('Dominadas');
  });

  it('conserva el resumen y los avisos', async () => {
    // El aviso de limitaciones no es algo que el entrenador esté
    // reescribiendo al dictar los días, y perderlo haría fallar la
    // validación al aprobar.
    const conAviso = { ...RUTINA, warnings: ['Revisar: hombro'] };
    const { deps, guardado } = espia({ draft: borrador({ content: conAviso }) });

    await handleEditorCommand('crear_rutina', DICTADA, TRAINER, CHAT, deps);

    expect(guardado[0]?.warnings).toEqual(['Revisar: hombro']);
    expect(guardado[0]?.summary).toBe('Fuerza');
  });

  it('devuelve la rutina completa, no un «actualizada»', async () => {
    // Tener que pedir `/ver` para saber si el comando hizo lo esperado es la
    // mitad de por qué el modo manual «no se entendía».
    const { deps, mensajes } = espia();

    await handleEditorCommand('crear_rutina', DICTADA, TRAINER, CHAT, deps);

    expect(mensajes.at(-1)).toContain('Dominadas');
    // Y sigue diciendo de quién es.
    expect(mensajes.at(-1)).toContain('Carlos');
  });

  it('un renglón que no se entiende no guarda nada, y dice cuál', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await handleEditorCommand(
      'crear_rutina',
      'Día 1: Empuje\nPress banca\nRemo 4x8',
      TRAINER,
      CHAT,
      deps,
    );

    expect(outcome).toMatchObject({ kind: 'invalid' });
    expect(pasos).not.toContain('saveDraft');
    expect(mensajes.at(-1)).toContain('2');
  });

  it('un mensaje sin ningún día tampoco guarda', async () => {
    const { deps, pasos, mensajes } = espia();

    const outcome = await handleEditorCommand('crear_rutina', 'Press banca 4x8', TRAINER, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'invalid' });
    expect(pasos).not.toContain('saveDraft');
    expect(mensajes.at(-1)).toContain('día');
  });

  // SPEC-022 M1. En el menú de Telegram, tocar /crear_rutina lo ENVÍA al
  // instante, sin nada debajo. Pasó en uso real.
  describe('CA-M1 · /crear_rutina sin nada debajo', () => {
    it.each([
      ['vacío', ''],
      ['solo espacios y saltos', '  \n \n  '],
    ])('%s: explica que van en el MISMO mensaje, y no guarda', async (_caso, args) => {
      const { deps, pasos, mensajes } = espia();

      const outcome = await handleEditorCommand('crear_rutina', args, TRAINER, CHAT, deps);

      expect(outcome).toMatchObject({ kind: 'invalid' });
      expect(pasos).not.toContain('saveDraft');
      expect(mensajes.at(-1)).toContain('MISMO mensaje');
    });

    it('trae el ejemplo en un bloque de código, que se copia de un toque', async () => {
      const { deps, mensajes } = espia();

      await handleEditorCommand('crear_rutina', '', TRAINER, CHAT, deps);

      const texto = mensajes.at(-1)!;
      const bloque = /```\n([\s\S]*?)```/.exec(texto)?.[1];
      expect(bloque).toBeDefined();
      // El ejemplo, tal cual se escribe: dentro del bloque no se escapa nada.
      expect(bloque).toContain('/crear_rutina\nDía 1: Cuerpo completo A\nSentadilla 3x10 120');
      expect(bloque).toContain('Día 2: Cuerpo completo B');
    });

    it('el ejemplo, pegado tal cual, es una rutina válida', async () => {
      const { deps, mensajes } = espia();
      await handleEditorCommand('crear_rutina', '', TRAINER, CHAT, deps);
      const bloque = /```\n([\s\S]*?)```/.exec(mensajes.at(-1)!)![1]!;
      const [, ...cuerpo] = bloque.trim().split('\n');

      const otra = espia();
      const outcome = await handleEditorCommand('crear_rutina', cuerpo.join('\n'), TRAINER, CHAT, otra.deps);

      expect(outcome).toMatchObject({ kind: 'edited' });
    });

    it('CA-M6 · Telegram no lo rechaza', async () => {
      const { deps, mensajes } = espia();
      await handleEditorCommand('crear_rutina', '', TRAINER, CHAT, deps);
      expect(tieneCaracterSinEscapar(mensajes.at(-1)!)).toBe(false);
    });
  });

  it('es un comando del editor, como los demás', () => {
    expect(isEditorCommand('crear_rutina')).toBe(true);
  });

  it('sin borrador abierto no hace nada', async () => {
    const { deps, pasos } = espia({ draft: null });

    const outcome = await handleEditorCommand('crear_rutina', DICTADA, TRAINER, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'no_draft' });
    expect(pasos).not.toContain('saveDraft');
  });
});
