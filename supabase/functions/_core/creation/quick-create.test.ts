/**
 * SPEC-031 — `/crear_rutina <cliente>`, de un solo mensaje.
 */
import { describe, expect, it } from 'vitest';
import type { ChangeRequestRepo, VersionForRequest } from '../ports/change-request-ports.ts';
import type { ClientDetail, ClientSummary, QueryRepo } from '../ports/query-ports.ts';
import type { CreationRepo, VersionForCreation } from '../ports/creation-ports.ts';
import type { VersionState } from '../domain/version.ts';
import { tieneCaracterSinEscapar } from '../../../../tests/helpers/markdown.ts';
import { handleQuickCreate, type QuickCreateDeps } from './quick-create.ts';

const TRAINER = 'p-entrenador';
const CHAT = 10;

const RUTINA_TEXTO = 'Día 1: Empuje\nPress banca 4x8 90';

function cliente(extra: Partial<ClientSummary> = {}): ClientSummary {
  return {
    clientId: 'c-carlos',
    fullName: 'Carlos Pérez',
    versionState: 'NEW',
    versionNumber: 1,
    linked: true,
    pendingCheckinDays: null,
    ...extra,
  };
}

function detalleDe(c: ClientSummary, extra: Partial<ClientDetail> = {}): ClientDetail {
  return {
    ...c,
    versionId: `v-${c.clientId}`,
    goal: null,
    level: null,
    daysPerWeek: null,
    sessionMinutes: null,
    equipment: null,
    hasLimitations: false,
    sentDaysAgo: null,
    lastCheckin: null,
    openChangeRequest: null,
    ...extra,
  };
}

interface Config {
  readonly clientes: readonly ClientSummary[];
  readonly detalles: Readonly<Record<string, ClientDetail | null>>;
  readonly fillFalla?: boolean;
  readonly saveFalla?: boolean;
  readonly changeVersion?: VersionForRequest | null;
  readonly nuevaVersionId?: string;
  /** `null` simula que la versión desapareció justo antes de confirmar. */
  readonly findVersionParaConfirmar?: VersionForCreation | null;
}

interface Espia {
  readonly deps: QuickCreateDeps;
  readonly pasos: string[];
  readonly mensajes: string[];
  readonly guardado: { versionId: string; content: unknown }[];
}

function espia(config: Config): Espia {
  const pasos: string[] = [];
  const mensajes: string[] = [];
  const guardado: { versionId: string; content: unknown }[] = [];

  const clients: Pick<QueryRepo, 'clients' | 'clientDetail'> = {
    clients: () => {
      pasos.push('clients');
      return Promise.resolve(config.clientes);
    },
    clientDetail: (clientId) => {
      pasos.push(`clientDetail:${clientId}`);
      return Promise.resolve(config.detalles[clientId] ?? null);
    },
  };

  const creation: CreationRepo = {
    findVersion: (versionId) => {
      pasos.push(`findVersion:${versionId}`);
      if (config.findVersionParaConfirmar !== undefined) {
        return Promise.resolve(config.findVersionParaConfirmar);
      }
      return Promise.resolve({
        versionId,
        state: 'DRAFT' as VersionState,
        client: { clientId: 'c-carlos', trainerId: TRAINER, profileId: 'p-cliente' },
        clientName: 'Carlos Pérez',
        versionNumber: 1,
        daysPerWeek: null,
        level: null,
        equipment: null,
        hasLimitations: false,
      });
    },
    fillVersion: (versionId, _expected, _source, _templateId, content) => {
      pasos.push('fillVersion');
      guardado.push({ versionId, content });
      return Promise.resolve(!(config.fillFalla ?? false));
    },
    currentDraft: () => Promise.resolve(null),
    saveDraft: (versionId, content) => {
      pasos.push('saveDraft');
      guardado.push({ versionId, content });
      return Promise.resolve(!(config.saveFalla ?? false));
    },
  };

  const changes: Pick<ChangeRequestRepo, 'findVersion' | 'createRevision'> = {
    findVersion: () => {
      pasos.push('changes.findVersion');
      return Promise.resolve(
        config.changeVersion === undefined
          ? {
              versionId: 'v-vieja',
              state: 'SENT',
              client: { clientId: 'c-carlos', trainerId: TRAINER, profileId: 'p-cliente' },
              planId: 'plan-1',
              clientName: 'Carlos Pérez',
              versionNumber: 1,
              trainerChatId: CHAT,
              currentVersionState: 'SENT',
              currentVersionNumber: 1,
            }
          : config.changeVersion,
      );
    },
    createRevision: () => {
      pasos.push('createRevision');
      return Promise.resolve(config.nuevaVersionId ?? 'v-nueva');
    },
  };

  return {
    deps: {
      clients,
      creation,
      changes,
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

describe('handleQuickCreate — cuándo NO es un atajo (not_applicable)', () => {
  it('sin nada escrito', async () => {
    const { deps, pasos } = espia({ clientes: [], detalles: {} });
    const r = await handleQuickCreate('', TRAINER, CHAT, deps);
    expect(r).toEqual({ kind: 'not_applicable' });
    expect(pasos).toEqual([]);
  });

  it('CA-11 · la primera línea es una cabecera de día: ni intenta matchear', async () => {
    const { deps, pasos } = espia({ clientes: [cliente()], detalles: {} });
    const r = await handleQuickCreate(RUTINA_TEXTO, TRAINER, CHAT, deps);
    expect(r).toEqual({ kind: 'not_applicable' });
    expect(pasos).not.toContain('clients');
  });

  it('la primera línea viene en blanco (mensaje empieza con un salto de línea)', async () => {
    const { deps, pasos } = espia({ clientes: [cliente()], detalles: {} });
    const r = await handleQuickCreate(`\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);
    expect(r).toEqual({ kind: 'not_applicable' });
    expect(pasos).not.toContain('clients');
  });

  it('CA-9 · el nombre no matchea a nadie: cae al camino de siempre', async () => {
    const { deps, pasos } = espia({ clientes: [cliente()], detalles: {} });
    const r = await handleQuickCreate('Zzz Inexistente\nPress banca 4x8 90', TRAINER, CHAT, deps);
    expect(r).toEqual({ kind: 'not_applicable' });
    expect(pasos).toEqual(['clients']); // matcheó, no encontró, y no mandó nada
  });
});

describe('handleQuickCreate — ambigüedad y nombre solo', () => {
  it('CA-7 · varios encajan, ninguno exacto: no toca nada, los lista', async () => {
    const clientes = [
      cliente({ clientId: 'c-ana-g', fullName: 'Ana Gómez' }),
      cliente({ clientId: 'c-ana-p', fullName: 'Ana Pérez' }),
    ];
    const { deps, pasos, mensajes } = espia({ clientes, detalles: {} });

    const r = await handleQuickCreate(`Ana\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'ambiguous' });
    expect(pasos).toEqual(['clients', 'sendMessage']);
    expect(mensajes[0]).toContain('Ana Gómez');
    expect(mensajes[0]).toContain('Ana Pérez');
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });

  it('CA-8 · un nombre exacto gana sobre los que solo lo contienen', async () => {
    const clientes = [
      cliente({ clientId: 'c-ana', fullName: 'Ana' }),
      cliente({ clientId: 'c-ana-maria', fullName: 'Ana María' }),
    ];
    const detalles = {
      'c-ana': detalleDe(clientes[0]!, { versionState: 'NEW' }),
    };
    const { deps, guardado } = espia({ clientes, detalles });

    const r = await handleQuickCreate(`Ana\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'filled', versionId: 'v-c-ana' });
    expect(guardado[0]!.versionId).toBe('v-c-ana');
  });

  it('CA-10 · nombre encontrado, nada debajo: confirma y no toca nada', async () => {
    const c = cliente();
    const { deps, pasos, mensajes } = espia({ clientes: [c], detalles: {} });

    const r = await handleQuickCreate('Carlos', TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'named_only' });
    expect(pasos).toEqual(['clients', 'sendMessage']);
    expect(mensajes[0]).toContain('Carlos Pérez');
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });

  it('nombre encontrado, solo espacios en blanco debajo: igual que sin nada', async () => {
    const c = cliente();
    const { deps } = espia({ clientes: [c], detalles: {} });

    const r = await handleQuickCreate('Carlos\n   \n  ', TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'named_only' });
  });
});

describe('handleQuickCreate — renglón ilegible', () => {
  it('CA-12 · el error cuenta el renglón desde la rutina, no desde el nombre', async () => {
    const c = cliente();
    const { deps, pasos, mensajes } = espia({ clientes: [c], detalles: {} });

    const r = await handleQuickCreate('Carlos\nPress banca', TRAINER, CHAT, deps);

    expect(r).toMatchObject({ kind: 'rejected' });
    expect(pasos).toEqual(['clients', 'sendMessage']);
    // «Press banca» es el renglón 1 de LO DICTADO, no el 2 del mensaje entero.
    expect(mensajes[0]).toContain('Renglón 1');
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });
});

describe('handleQuickCreate — sin versión vigente', () => {
  it('CA-6 · el cliente no tiene ninguna evaluación todavía', async () => {
    const c = cliente({ versionState: null });
    const detalles = { [c.clientId]: detalleDe(c, { versionId: null, versionState: null }) };
    const { deps, mensajes } = espia({ clientes: [c], detalles });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'sin versión' });
    expect(mensajes[0]).toContain('Carlos Pérez');
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });

  it('clientDetail devuelve null (se borró entre medias)', async () => {
    const c = cliente();
    const { deps } = espia({ clientes: [c], detalles: {} });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'sin versión' });
  });
});

describe('handleQuickCreate — los 6 estados de la versión vigente', () => {
  it('CA-1 · NEW: llena y devuelve la rutina', async () => {
    const c = cliente({ versionState: 'NEW' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'NEW' }) };
    const { deps, pasos, mensajes, guardado } = espia({ clientes: [c], detalles });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'filled', versionId: 'v-c-carlos' });
    expect(pasos).toContain('fillVersion');
    expect(pasos).not.toContain('saveDraft');
    expect(guardado[0]!.content).toMatchObject({ days: [expect.objectContaining({ dayNumber: 1 })] });
    expect(mensajes.some((m) => m.includes('Carlos'))).toBe(true);
  });

  it('CA-2 · DRAFT: reemplaza, no acumula', async () => {
    const c = cliente({ versionState: 'DRAFT' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'DRAFT' }) };
    const { deps, pasos } = espia({ clientes: [c], detalles });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'filled', versionId: 'v-c-carlos' });
    expect(pasos).toContain('saveDraft');
    expect(pasos).not.toContain('fillVersion');
  });

  it('GENERATING: rechaza sin tocar nada', async () => {
    const c = cliente({ versionState: 'GENERATING' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'GENERATING' }) };
    const { deps, pasos, mensajes } = espia({ clientes: [c], detalles });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'estado GENERATING' });
    expect(pasos).not.toContain('fillVersion');
    expect(pasos).not.toContain('saveDraft');
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });

  it('CA-5 · APPROVED: rechaza sin tocar nada', async () => {
    const c = cliente({ versionState: 'APPROVED' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'APPROVED' }) };
    const { deps, pasos, mensajes } = espia({ clientes: [c], detalles });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'estado APPROVED' });
    expect(pasos).not.toContain('fillVersion');
    expect(pasos).not.toContain('saveDraft');
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });

  it('CA-3 · SENT: crea la v2 y la llena, en ese orden', async () => {
    const c = cliente({ versionState: 'SENT' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'SENT' }) };
    const { deps, pasos, mensajes, guardado } = espia({ clientes: [c], detalles });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'revised', versionId: 'v-nueva' });
    expect(pasos.indexOf('createRevision')).toBeLessThan(pasos.indexOf('fillVersion'));
    expect(guardado[0]!.versionId).toBe('v-nueva');
    expect(mensajes[0]).toContain('versión nueva');
    // Solo el aviso propio: `formatWorkout` ya tiene su propio detector, y
    // usa `*negrita*` MarkdownV2 a propósito — el detector lo marcaría igual.
    expect(tieneCaracterSinEscapar(mensajes[0]!)).toBe(false);
  });

  it('CA-4 · REJECTED: igual que SENT', async () => {
    const c = cliente({ versionState: 'REJECTED' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'REJECTED' }) };
    const { deps } = espia({ clientes: [c], detalles });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'revised', versionId: 'v-nueva' });
  });
});

describe('handleQuickCreate — carreras', () => {
  it('NEW: fillVersion pierde la carrera', async () => {
    const c = cliente({ versionState: 'NEW' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'NEW' }) };
    const { deps, mensajes } = espia({ clientes: [c], detalles, fillFalla: true });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'carrera' });
    expect(mensajes[0]).toContain('ya no es un borrador');
  });

  it('DRAFT: saveDraft pierde la carrera', async () => {
    const c = cliente({ versionState: 'DRAFT' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'DRAFT' }) };
    const { deps } = espia({ clientes: [c], detalles, saveFalla: true });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'carrera' });
  });

  it('SENT: la versión vieja desapareció justo antes de crear la v2', async () => {
    const c = cliente({ versionState: 'SENT' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'SENT' }) };
    const { deps, pasos } = espia({ clientes: [c], detalles, changeVersion: null });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'carrera' });
    expect(pasos).not.toContain('createRevision');
  });

  it('SENT: la v2 recién creada no se pudo llenar', async () => {
    const c = cliente({ versionState: 'SENT' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'SENT' }) };
    const { deps } = espia({ clientes: [c], detalles, fillFalla: true });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'rejected', reason: 'carrera' });
  });

  it('la versión desaparece justo antes de confirmar: no manda la rutina', async () => {
    const c = cliente({ versionState: 'NEW' });
    const detalles = { [c.clientId]: detalleDe(c, { versionState: 'NEW' }) };
    const { deps, pasos } = espia({
      clientes: [c],
      detalles,
      findVersionParaConfirmar: null,
    });

    const r = await handleQuickCreate(`Carlos\n${RUTINA_TEXTO}`, TRAINER, CHAT, deps);

    expect(r).toEqual({ kind: 'filled', versionId: 'v-c-carlos' });
    // Se intentó confirmar, pero al no encontrar la versión no se mandó la rutina.
    expect(pasos.filter((p) => p === 'sendMessage')).toHaveLength(0);
  });
});
