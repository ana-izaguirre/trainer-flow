/**
 * SPEC-009 — Autorización.
 *
 * Con RLS en denegación total y todas las Edge Functions usando `service_role`,
 * este módulo es LO ÚNICO que separa a un cliente de los datos de otro
 * (ADR-010). Por eso la cobertura es del 100%, casos denegados incluidos.
 */
import { describe, expect, it } from 'vitest';
import type { Identity } from './domain/identity.ts';
import type { ClientRef, VersionRef, VersionState } from './domain/version.ts';
import { VERSION_STATES } from './domain/version.ts';
import {
  canManageClient,
  canModifyVersion,
  canRequestChange,
  canViewClient,
  canViewVersion,
} from './authorization.ts';

const TRAINER_A = 'trainer-a';
const TRAINER_B = 'trainer-b';
const CLIENT_A = 'client-profile-a';
const CLIENT_B = 'client-profile-b';

function identity(profileId: string, role: Identity['role']): Identity {
  return { profileId, role, telegramUserId: 1, telegramChatId: 1 };
}

const trainerA = identity(TRAINER_A, 'trainer');
const trainerB = identity(TRAINER_B, 'trainer');
const clientA = identity(CLIENT_A, 'client');
const clientB = identity(CLIENT_B, 'client');

/** Cliente de trainerA, vinculado al perfil clientA. */
function clientRef(overrides: Partial<ClientRef> = {}): ClientRef {
  return { clientId: 'c1', trainerId: TRAINER_A, profileId: CLIENT_A, ...overrides };
}

function versionRef(state: VersionState, client: ClientRef = clientRef()): VersionRef {
  return { versionId: 'v1', state, client };
}

// ---------------------------------------------------------------------------

describe('canViewClient', () => {
  it('permite al entrenador dueño', () => {
    expect(canViewClient(trainerA, clientRef())).toEqual({ allowed: true });
  });

  it('permite al propio cliente', () => {
    expect(canViewClient(clientA, clientRef())).toEqual({ allowed: true });
  });

  it('deniega al entrenador B ver un cliente de A', () => {
    expect(canViewClient(trainerB, clientRef())).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_CLIENT',
    });
  });

  it('deniega al cliente B ver al cliente A', () => {
    expect(canViewClient(clientB, clientRef())).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_CLIENT',
    });
  });

  it('deniega cuando el cliente aún no se ha vinculado', () => {
    // profileId NULL: nadie puede hacerse pasar por él.
    expect(canViewClient(clientA, clientRef({ profileId: null }))).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_CLIENT',
    });
  });
});

// ---------------------------------------------------------------------------

describe('canManageClient', () => {
  it('permite al entrenador dueño', () => {
    expect(canManageClient(trainerA, clientRef())).toEqual({ allowed: true });
  });

  it('deniega a cualquier cliente, incluso al suyo propio', () => {
    expect(canManageClient(clientA, clientRef())).toEqual({
      allowed: false,
      reason: 'NOT_TRAINER',
    });
  });

  it('deniega al entrenador B', () => {
    expect(canManageClient(trainerB, clientRef())).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_CLIENT',
    });
  });
});

// ---------------------------------------------------------------------------

describe('canViewVersion', () => {
  it('el entrenador dueño ve la versión en CUALQUIER estado', () => {
    for (const state of VERSION_STATES) {
      expect(canViewVersion(trainerA, versionRef(state)), state).toEqual({ allowed: true });
    }
  });

  // CA-6: el cliente SOLO ve lo que se le envió.
  it('el cliente solo ve versiones en SENT', () => {
    for (const state of VERSION_STATES) {
      const result = canViewVersion(clientA, versionRef(state));

      if (state === 'SENT') {
        expect(result, state).toEqual({ allowed: true });
      } else {
        expect(result, state).toEqual({ allowed: false, reason: 'VERSION_NOT_VISIBLE' });
      }
    }
  });

  it('deniega al entrenador B aunque la versión esté en SENT', () => {
    expect(canViewVersion(trainerB, versionRef('SENT'))).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_VERSION',
    });
  });

  it('deniega al cliente B la versión enviada al cliente A', () => {
    expect(canViewVersion(clientB, versionRef('SENT'))).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_VERSION',
    });
  });

  it('deniega si el cliente no está vinculado', () => {
    const noLink = versionRef('SENT', clientRef({ profileId: null }));
    expect(canViewVersion(clientA, noLink)).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_VERSION',
    });
  });
});

// ---------------------------------------------------------------------------

describe('canModifyVersion', () => {
  it('permite al entrenador dueño, en cualquier estado', () => {
    // Qué transición es legal lo decide la máquina de estados, no este módulo.
    for (const state of VERSION_STATES) {
      expect(canModifyVersion(trainerA, versionRef(state)), state).toEqual({ allowed: true });
    }
  });

  // Regla 6 de SPEC-009: el cliente NUNCA edita, aprueba ni rechaza.
  it('deniega a un cliente, incluso sobre su propia versión enviada', () => {
    expect(canModifyVersion(clientA, versionRef('SENT'))).toEqual({
      allowed: false,
      reason: 'NOT_TRAINER',
    });
  });

  it('deniega al entrenador B', () => {
    expect(canModifyVersion(trainerB, versionRef('DRAFT'))).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_VERSION',
    });
  });
});

// ---------------------------------------------------------------------------

describe('canRequestChange', () => {
  it('permite al cliente sobre su versión enviada', () => {
    expect(canRequestChange(clientA, versionRef('SENT'))).toEqual({ allowed: true });
  });

  it('deniega sobre cualquier estado que no sea SENT', () => {
    for (const state of VERSION_STATES.filter((s) => s !== 'SENT')) {
      expect(canRequestChange(clientA, versionRef(state)), state).toEqual({
        allowed: false,
        reason: 'VERSION_NOT_VISIBLE',
      });
    }
  });

  it('deniega al entrenador: pedir cambios es cosa del cliente', () => {
    expect(canRequestChange(trainerA, versionRef('SENT'))).toEqual({
      allowed: false,
      reason: 'NOT_CLIENT',
    });
  });

  it('deniega al cliente B sobre la versión del cliente A', () => {
    expect(canRequestChange(clientB, versionRef('SENT'))).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_VERSION',
    });
  });

  it('deniega si el cliente no está vinculado', () => {
    const noLink = versionRef('SENT', clientRef({ profileId: null }));
    expect(canRequestChange(clientA, noLink)).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_VERSION',
    });
  });
});

// ---------------------------------------------------------------------------

describe('cambiar un ID no da acceso a nada (CA-7)', () => {
  it('la decisión depende de la identidad resuelta, no del ID recibido', () => {
    // El atacante conoce el versionId real de otro cliente y lo envía.
    const ajena = versionRef('SENT', {
      clientId: 'c-de-otro',
      trainerId: TRAINER_B,
      profileId: CLIENT_B,
    });

    // Su identidad sale del webhook verificado, no de lo que él envió.
    expect(canViewVersion(clientA, ajena).allowed).toBe(false);
    expect(canModifyVersion(clientA, ajena).allowed).toBe(false);
    expect(canRequestChange(clientA, ajena).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/**
 * Hallados con mutation testing (Stryker): con 100% de cobertura, nada
 * fallaba si se borraban las comprobaciones de rol o de NULL. La base hoy
 * impide estas combinaciones, pero este módulo es la ÚNICA capa que separa
 * datos (ADR-010): no puede apoyarse en que la base las impida.
 */
describe('el rol cuenta, no solo el ID', () => {
  it('un cliente con el ID de su entrenador no pasa por entrenador', () => {
    const clienteConIdDeEntrenador = identity(TRAINER_A, 'client');

    expect(canViewClient(clienteConIdDeEntrenador, clientRef())).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_CLIENT',
    });
  });

  it('un entrenador con el ID del cliente no pasa por el cliente', () => {
    const entrenadorConIdDeCliente = identity(CLIENT_A, 'trainer');

    expect(canViewClient(entrenadorConIdDeCliente, clientRef())).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_CLIENT',
    });
  });

  it('un NULL no coincide con un cliente sin vincular', () => {
    // Imposible por tipos, pero la guarda existe justo para cuando un dato
    // de fuera llega roto: dos NULL no pueden abrir acceso.
    const sinPerfil = identity(null as unknown as string, 'client');
    const sinVincular = clientRef({ profileId: null });

    expect(canViewClient(sinPerfil, sinVincular)).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_CLIENT',
    });
  });
});
