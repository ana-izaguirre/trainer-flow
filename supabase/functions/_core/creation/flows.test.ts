/**
 * SPEC-008 — Plantillas y creación manual.
 *
 * ┌─ LO QUE MÁS IMPORTA AQUÍ ──────────────────────────────────────────────┐
 * │ Que este camino no toque la IA. Es lo que hace cierto que «el sistema  │
 * │ funciona completo sin IA»: con el proveedor caído, esto sigue          │
 * │ creando rutinas.                                                       │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { CreationRepo, VersionForCreation } from '../ports/creation-ports.ts';
import { TEMPLATES } from '../templates.ts';
import { parseTemplateCallback } from '../telegram/template-callback.ts';
import { listTemplates, loadTemplate, startManual, type CreationDeps } from './flows.ts';

const VERSION_ID = '3f8a1c2e-0b4d-4e6f-8a91-2c3d4e5f6a7b';
const CHAT = 10;

function version(extra: Partial<VersionForCreation> = {}): VersionForCreation {
  return {
    versionId: VERSION_ID,
    state: 'NEW',
    clientName: 'Carlos Pérez',
    versionNumber: 1,
    daysPerWeek: 3,
    level: 'beginner',
    equipment: 'Gimnasio',
    hasLimitations: false,
    ...extra,
  };
}

interface Espia {
  readonly deps: CreationDeps;
  readonly pasos: string[];
  readonly mensajes: { text: string; keyboard?: unknown }[];
  readonly guardado: { content: unknown; source: string; templateId: string | null }[];
}

function espia(
  opciones: { version?: VersionForCreation | null; llenarFalla?: boolean } = {},
): Espia {
  const pasos: string[] = [];
  const mensajes: { text: string; keyboard?: unknown }[] = [];
  const guardado: { content: unknown; source: string; templateId: string | null }[] = [];

  const repo: CreationRepo = {
    findVersion: () => {
      pasos.push('findVersion');
      return Promise.resolve(opciones.version === undefined ? version() : opciones.version);
    },
    fillVersion: (_v, _e, source, templateId, content) => {
      pasos.push(`fillVersion:${source}`);
      guardado.push({ content, source, templateId });
      return Promise.resolve(!(opciones.llenarFalla ?? false));
    },
    currentDraft: () => Promise.resolve(null),
    saveDraft: () => Promise.resolve(true),
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (_chatId, text, keyboard) => {
          pasos.push('sendMessage');
          mensajes.push({ text, ...(keyboard === undefined ? {} : { keyboard }) });
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

/** Los ids de plantilla de un teclado, en orden. */
function idsDelTeclado(keyboard: unknown): string[] {
  const k = keyboard as { inline_keyboard: { callback_data: string }[][] };
  return k.inline_keyboard.flat().map((b) => parseTemplateCallback(b.callback_data)!.templateId);
}

// ---------------------------------------------------------------------------

describe('📋 listar plantillas', () => {
  it('CA-11 · lista y NO carga ninguna', async () => {
    // Regla 8: el entrenador elige siempre, aunque solo encaje una.
    const { deps, pasos, mensajes } = espia();

    const outcome = await listTemplates(VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'listed' });
    expect(pasos.some((p) => p.startsWith('fillVersion'))).toBe(false);
    expect(mensajes[0]?.keyboard).toBeDefined();
  });

  it('CA-9 · nunca lista vacía, ni con criterios raros', async () => {
    // Si se filtrara, un cliente poco común se quedaría sin opciones justo
    // cuando la IA acaba de fallar (regla 7).
    const { deps, mensajes } = espia({
      version: version({ daysPerWeek: 5, level: 'advanced', equipment: 'Solo una toalla' }),
    });

    const outcome = await listTemplates(VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'listed', count: TEMPLATES.length });
    expect(idsDelTeclado(mensajes[0]!.keyboard)).toHaveLength(TEMPLATES.length);
  });

  it('CA-8 · la que mejor encaja va primero', async () => {
    const { deps, mensajes } = espia({
      version: version({ daysPerWeek: 4, level: 'intermediate', equipment: 'Gimnasio' }),
    });

    await listTemplates(VERSION_ID, CHAT, deps);

    expect(idsDelTeclado(mensajes[0]!.keyboard)[0]).toBe('upper-lower-4d');
  });

  it('un plan sin evaluación también lista', async () => {
    const { deps, mensajes } = espia({
      version: version({ daysPerWeek: null, level: null, equipment: null }),
    });

    const outcome = await listTemplates(VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'listed', count: TEMPLATES.length });
    expect(mensajes[0]?.text).toContain('Carlos');
  });

  it('una versión que no existe se rechaza igual que una ajena', async () => {
    const { deps, pasos } = espia({ version: null });

    expect(await listTemplates(VERSION_ID, CHAT, deps)).toMatchObject({ kind: 'rejected' });
    expect(pasos.some((p) => p.startsWith('fillVersion'))).toBe(false);
  });
});

describe('cargar la elegida', () => {
  it('CA-2 · queda con source=template y su id', async () => {
    const { deps, guardado } = espia();

    const outcome = await loadTemplate('full-body-3d', VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'filled', source: 'template' });
    expect(guardado[0]).toMatchObject({ source: 'template', templateId: 'full-body-3d' });
  });

  it('CA-10 · con limitaciones inyecta el aviso Y pasa la validación', async () => {
    // Sin el aviso, `validateDraft` rechazaría el borrador y el entrenador no
    // podría ni cargar la plantilla (regla 9).
    const { deps, guardado } = espia({ version: version({ hasLimitations: true }) });

    const outcome = await loadTemplate('full-body-3d', VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'filled' });
    const contenido = guardado[0]!.content as { warnings: string[] };
    expect(contenido.warnings.length).toBeGreaterThan(0);
  });

  it('enseña el borrador con los botones de decidir', async () => {
    const { deps, mensajes } = espia();

    await loadTemplate('full-body-3d', VERSION_ID, CHAT, deps);

    expect(mensajes.at(-1)?.keyboard).toBeDefined();
    expect(mensajes.at(-1)?.text).toContain('Carlos');
  });

  it('un id inventado se rechaza sin tocar la versión', async () => {
    // El `callback_data` lo fabrica cualquiera: tener la forma no basta.
    const { deps, pasos } = espia();

    const outcome = await loadTemplate('no-existe', VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'rejected' });
    expect(pasos).toEqual(['sendMessage']);
  });

  it('sobre una versión que no existe, no se carga nada', async () => {
    const { deps, pasos } = espia({ version: null });

    expect(await loadTemplate('full-body-3d', VERSION_ID, CHAT, deps)).toMatchObject({
      kind: 'rejected',
    });
    expect(pasos.some((p) => p.startsWith('fillVersion'))).toBe(false);
  });

  it('un plan SIN evaluación acepta la plantilla tal cual', async () => {
    // Una rutina manual no tiene días pedidos: los de la plantilla mandan, y
    // no hay criterios contra los que pueda chocar.
    const { deps, guardado } = espia({
      version: version({ daysPerWeek: null, level: null, equipment: null }),
    });

    const outcome = await loadTemplate('push-pull-legs-6d', VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'filled' });
    expect((guardado[0]!.content as { days: unknown[] }).days).toHaveLength(6);
  });

  it('si otro se adelantó, no se pisa', async () => {
    // Dos pulsaciones rápidas: la segunda encuentra otro estado.
    const { deps, mensajes } = espia({ llenarFalla: true });

    const outcome = await loadTemplate('full-body-3d', VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'rejected' });
    expect(mensajes.at(-1)?.text).toContain('No puedo');
  });

  it.each(TEMPLATES.map((t) => t.id))('%s se carga y pasa validateDraft', async (id) => {
    // Las cuatro del catálogo, contra la MISMA puerta que la IA.
    const plantilla = TEMPLATES.find((t) => t.id === id)!;
    const { deps } = espia({ version: version({ daysPerWeek: plantilla.daysPerWeek }) });

    expect(await loadTemplate(id, VERSION_ID, CHAT, deps)).toMatchObject({ kind: 'filled' });
  });

  it('si la plantilla no encaja con los días pedidos, se dice', async () => {
    // No se cuela: una plantilla de 3 días sobre un cliente que pidió 6 es
    // justo lo que `validateDraft` existe para detener.
    const { deps, mensajes, pasos } = espia({ version: version({ daysPerWeek: 6 }) });

    const outcome = await loadTemplate('full-body-3d', VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'invalid_draft' });
    expect(pasos.some((p) => p.startsWith('fillVersion'))).toBe(false);
    expect(mensajes.at(-1)?.text).toContain('No pude cargarla');
  });
});

describe('✍️ empezar a mano', () => {
  it('CA-12 · deja un borrador vacío y explica los comandos', async () => {
    const { deps, guardado, mensajes } = espia();

    const outcome = await startManual(VERSION_ID, CHAT, deps);

    expect(outcome).toMatchObject({ kind: 'filled', source: 'manual' });
    expect(guardado[0]).toMatchObject({ source: 'manual', templateId: null });
    expect((guardado[0]!.content as { days: unknown[] }).days).toEqual([]);
    expect(mensajes[0]?.text).toContain('/add');
  });

  it('el borrador vacío NO pasa por validateDraft, a propósito', async () => {
    // Una rutina vacía no es válida, y ese es justo el estado en el que tiene
    // que quedar para poder editarla. La puerta está en aprobar.
    const { deps } = espia();

    expect(await startManual(VERSION_ID, CHAT, deps)).toMatchObject({ kind: 'filled' });
  });

  it('si otro se adelantó, no se pisa', async () => {
    const { deps } = espia({ llenarFalla: true });

    expect(await startManual(VERSION_ID, CHAT, deps)).toMatchObject({ kind: 'rejected' });
  });

  it('una versión que no existe se rechaza', async () => {
    const { deps, pasos } = espia({ version: null });

    expect(await startManual(VERSION_ID, CHAT, deps)).toMatchObject({ kind: 'rejected' });
    expect(pasos.some((p) => p.startsWith('fillVersion'))).toBe(false);
  });
});
