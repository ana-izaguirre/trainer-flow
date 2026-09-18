/**
 * SPEC-007 — Los comandos del entrenador.
 *
 * ┌─ LO QUE MÁS IMPORTA AQUÍ ──────────────────────────────────────────────┐
 * │ Que un cliente que escriba `/clientes` no llegue a consultar NADA.     │
 * │ No se consulta y luego se filtra: no se consulta (regla 1, CA-4).      │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from '../domain/identity.ts';
import type {
  ClientDetail,
  ClientSummary,
  PendingVersion,
  QueryRepo,
  StaleCheckin,
} from '../ports/query-ports.ts';
import { handleCommand, type CommandDeps } from './router.ts';

const ENTRENADOR: Identity = {
  profileId: 'p-trainer',
  role: 'trainer',
  telegramUserId: 900,
  telegramChatId: 900,
};

const CLIENTE: Identity = {
  profileId: 'p-cliente',
  role: 'client',
  telegramUserId: 500,
  telegramChatId: 500,
};

function resumen(nombre: string, extra: Partial<ClientSummary> = {}): ClientSummary {
  return {
    clientId: nombre.toLowerCase().replace(/\s/g, '-'),
    fullName: nombre,
    versionState: 'SENT',
    versionNumber: 1,
    linked: true,
    pendingCheckinDays: null,
    ...extra,
  };
}

interface Espia {
  readonly deps: CommandDeps;
  readonly pasos: string[];
  readonly mensajes: string[];
}

function espia(
  opciones: {
    clientes?: readonly ClientSummary[];
    detalle?: ClientDetail | null;
    pendientes?: readonly PendingVersion[];
    checkins?: readonly StaleCheckin[];
  } = {},
): Espia {
  const pasos: string[] = [];
  const mensajes: string[] = [];

  const repo: QueryRepo = {
    clients: (trainerId) => {
      pasos.push(`clients:${trainerId}`);
      return Promise.resolve(opciones.clientes ?? [resumen('Carlos Pérez')]);
    },
    clientDetail: (clientId) => {
      pasos.push(`clientDetail:${clientId}`);
      return Promise.resolve(opciones.detalle === undefined ? null : opciones.detalle);
    },
    pendingVersions: () => {
      pasos.push('pendingVersions');
      return Promise.resolve(opciones.pendientes ?? []);
    },
    staleCheckins: (_t, minDays) => {
      pasos.push(`staleCheckins:${minDays}`);
      return Promise.resolve(opciones.checkins ?? []);
    },
  };

  return {
    deps: {
      repo,
      sender: {
        sendMessage: (chatId, text) => {
          pasos.push(`sendMessage:${chatId}`);
          mensajes.push(text);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    },
    pasos,
    mensajes,
  };
}

// ---------------------------------------------------------------------------

describe('🔴 CA-4 · un cliente no consulta nada', () => {
  it.each(['clientes', 'cliente', 'pendientes', 'checkins'])(
    '/%s de un cliente no toca la base',
    async (comando) => {
      const { deps, pasos, mensajes } = espia();

      const outcome = await handleCommand(comando, 'lo que sea', CLIENTE, deps);

      expect(outcome).toEqual({ kind: 'forbidden', command: comando });
      // Lo que importa: ni una consulta. No se filtra después.
      expect(pasos.filter((p) => !p.startsWith('sendMessage'))).toEqual([]);
      // Y el mensaje no revela si el entrenador tiene clientes ni cuántos.
      expect(mensajes[0]).not.toMatch(/Carlos|\d/);
    },
  );
});

describe('/clientes', () => {
  it('CA-1 · devuelve los clientes con su estado', async () => {
    const { deps, mensajes } = espia({
      clientes: [
        resumen('Carlos Pérez'),
        resumen('Marta Ruiz', { versionState: 'DRAFT' }),
        resumen('Luis Soto', { pendingCheckinDays: 5 }),
        resumen('Ana Gil', { linked: false }),
      ],
    });

    const outcome = await handleCommand('clientes', '', ENTRENADOR, deps);

    expect(outcome).toMatchObject({ kind: 'answered', messages: 1 });
    const texto = mensajes[0]!;
    expect(texto).toContain('pendiente de revisión');
    expect(texto).toContain('sin responder');
    expect(texto).toContain('sin vincular');
  });

  it('solo pide los SUYOS', async () => {
    // El filtro por `trainer_id` va en la consulta, no después.
    const { deps, pasos } = espia();

    await handleCommand('clientes', '', ENTRENADOR, deps);

    expect(pasos).toContain('clients:p-trainer');
  });

  it('CA-9 · sin clientes da instrucciones, no una lista vacía', async () => {
    const { deps, mensajes } = espia({ clientes: [] });

    await handleCommand('clientes', '', ENTRENADOR, deps);

    expect(mensajes[0]).toContain('formulario');
  });

  it('CA-6 · con 25 clientes salen DOS mensajes, con los 25', async () => {
    // Truncar en silencio es peor que un error: creería que ya los vio todos.
    const veinticinco = Array.from({ length: 25 }, (_, i) => resumen(`Cliente ${i + 1}`));
    const { deps, mensajes } = espia({ clientes: veinticinco });

    const outcome = await handleCommand('clientes', '', ENTRENADOR, deps);

    expect(outcome).toMatchObject({ messages: 2 });
    const juntos = mensajes.join('\n');
    for (const c of veinticinco) expect(juntos).toContain(c.fullName);
  });
});

describe('/cliente <nombre>', () => {
  it('CA-2 · una coincidencia devuelve la ficha', async () => {
    const { deps, pasos } = espia({
      detalle: {
        ...resumen('Carlos Pérez'),
        goal: 'Ganancia muscular',
        level: 'intermediate',
        daysPerWeek: 4,
        sessionMinutes: 60,
        equipment: 'Gimnasio',
        hasLimitations: true,
        sentDaysAgo: 12,
        lastCheckin: null,
      },
    });

    await handleCommand('cliente', 'carl', ENTRENADOR, deps);

    expect(pasos).toContain('clientDetail:carlos-pérez');
  });

  it('CA-3 · varias coincidencias se listan SIN pedir el detalle', async () => {
    const { deps, pasos, mensajes } = espia({
      clientes: [resumen('Marta Ruiz'), resumen('Marcos Díaz')],
    });

    await handleCommand('cliente', 'Mar', ENTRENADOR, deps);

    expect(pasos.some((p) => p.startsWith('clientDetail'))).toBe(false);
    expect(mensajes[0]).toContain('Marta');
    expect(mensajes[0]).toContain('Marcos');
  });

  it('sin coincidencias no pide detalle de nada', async () => {
    const { deps, pasos } = espia({ clientes: [resumen('Carlos Pérez')] });

    await handleCommand('cliente', 'Zoltan', ENTRENADOR, deps);

    expect(pasos.some((p) => p.startsWith('clientDetail'))).toBe(false);
  });

  it('si la ficha desaparece entre las dos consultas, no revienta', async () => {
    // `clients()` lo trajo y `clientDetail()` ya no lo encuentra: se borró
    // en medio. Se responde como si no existiera, que es lo que pasa.
    const { deps, mensajes } = espia({ detalle: null });

    await handleCommand('cliente', 'carl', ENTRENADOR, deps);

    expect(mensajes[0]).toContain('No tengo a nadie');
  });

  it('`/cliente` a secas no lista a todos', async () => {
    const { deps, mensajes } = espia();

    await handleCommand('cliente', '', ENTRENADOR, deps);

    expect(mensajes[0]).toContain('No tengo a nadie');
  });
});

describe('/pendientes', () => {
  it('CA-5 · una versión por mensaje, cada una con sus botones', async () => {
    // Van sueltas porque el `callback_data` lleva UN `versionId`: en una
    // lista, diez botones de aprobar no se distinguirían al pulsarlos.
    const { deps } = espia({
      pendientes: [
        { versionId: 'v1', clientName: 'Carlos', versionNumber: 1, daysWaiting: 2 },
        { versionId: 'v2', clientName: 'Marta', versionNumber: 3, daysWaiting: 1 },
      ],
    });

    const outcome = await handleCommand('pendientes', '', ENTRENADOR, deps);

    expect(outcome).toMatchObject({ kind: 'answered', messages: 2 });
  });

  it('sin nada pendiente lo dice en un mensaje', async () => {
    const { deps, mensajes } = espia({ pendientes: [] });

    await handleCommand('pendientes', '', ENTRENADOR, deps);

    expect(mensajes[0]).toContain('Nada pendiente');
  });
});

describe('/checkins', () => {
  it('CA-7 · pide los de más de 2 días', async () => {
    const { deps, pasos } = espia();

    await handleCommand('checkins', '', ENTRENADOR, deps);

    expect(pasos).toContain('staleCheckins:2');
  });

  it('los lista con los días que llevan', async () => {
    const { deps, mensajes } = espia({
      checkins: [{ clientName: 'Luis', weekNumber: 3, daysWaiting: 5, reminded: true }],
    });

    await handleCommand('checkins', '', ENTRENADOR, deps);

    expect(mensajes[0]).toContain('Luis');
    expect(mensajes[0]).toContain('5 días');
    expect(mensajes[0]).toContain('recordado');
  });
});

describe('ayuda y lo desconocido', () => {
  it.each(['ayuda', 'help'])('/%s lista los comandos', async (comando) => {
    const { deps, mensajes, pasos } = espia();

    const outcome = await handleCommand(comando, '', ENTRENADOR, deps);

    expect(outcome.kind).toBe('answered');
    expect(mensajes[0]).toContain('/clientes');
    expect(pasos.filter((p) => !p.startsWith('sendMessage'))).toEqual([]);
  });

  it('CA-8 · un comando desconocido responde ayuda y NO consulta', async () => {
    const { deps, mensajes, pasos } = espia();

    const outcome = await handleCommand('inventado', '', ENTRENADOR, deps);

    expect(outcome).toEqual({ kind: 'unknown', command: 'inventado' });
    expect(mensajes[0]).toContain('/clientes');
    expect(pasos.filter((p) => !p.startsWith('sendMessage'))).toEqual([]);
  });

  it('`/start` no es de aquí: lo atiende el canje del deep link', async () => {
    const { deps, pasos } = espia();

    const outcome = await handleCommand('start', '', ENTRENADOR, deps);

    expect(outcome).toEqual({ kind: 'not_mine' });
    expect(pasos).toEqual([]);
  });

  it('...y un `/start` de un cliente tampoco se le deniega', async () => {
    // Si se comprobara el rol primero, un cliente vinculándose recibiría
    // «eso solo lo consulta tu entrenador».
    const { deps, pasos } = espia();

    expect(await handleCommand('start', 'tok', CLIENTE, deps)).toEqual({ kind: 'not_mine' });
    expect(pasos).toEqual([]);
  });
});
