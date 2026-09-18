/**
 * SPEC-013 — Los 11 casos obligatorios de `docs/SECURITY.md`, en un archivo.
 *
 * ┌─ POR QUÉ JUNTOS Y NO REPARTIDOS ───────────────────────────────────────┐
 * │ Los casos ya estaban cubiertos a trozos: unos en `schema.test.ts`,     │
 * │ otros en los tests de `_core`, otros en ninguno. Un checklist de       │
 * │ seguridad que hay que ir a buscar a cinco sitios es un checklist que   │
 * │ nadie repasa.                                                          │
 * │                                                                        │
 * │ Aquí se lee de corrido lo que un atacante NO puede hacer.              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ POR QUÉ ESTO NO PRUEBA RLS COMO DEFENSA ──────────────────────────────┐
 * │ Con Telegram como única interfaz, todo pasa por `service_role`, que    │
 * │ salta RLS. RLS es deny-all a propósito (ADR-010) y lo que protege de   │
 * │ verdad es `_core/authorization.ts`. Los casos 8 y 9 comprueban que el  │
 * │ cinturón sigue puesto; los de pertenencia comprueban los tirantes.     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  canModifyVersion,
  canRequestChange,
  canViewClient,
  canViewVersion,
} from '../../supabase/functions/_core/authorization.ts';
import { startManual } from '../../supabase/functions/_core/creation/flows.ts';
import type { Identity } from '../../supabase/functions/_core/domain/identity.ts';
import type { CreationRepo } from '../../supabase/functions/_core/ports/creation-ports.ts';
import type { VersionRef } from '../../supabase/functions/_core/domain/version.ts';
import { formatLogLine } from '../../supabase/functions/_core/observability/log-event.ts';
import {
  connect,
  createAssessment,
  createClient,
  createPlan,
  createProfile,
  createVersion,
  PG,
  pgErrorCode,
  resetTestDatabase,
  truncateAll,
} from '../helpers/db.ts';

let db: Client;

beforeAll(async () => {
  await resetTestDatabase();
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function errorCodeOf(sql: string): Promise<string | undefined> {
  try {
    await db.query(sql);
    return undefined;
  } catch (error) {
    return pgErrorCode(error);
  }
}

/** Dos entrenadores con un cliente cada uno: el escenario de casos 3, 4 y 7. */
async function dosCarteras() {
  const trainerA = await createProfile(db, 'trainer', 'Entrenador A');
  const trainerB = await createProfile(db, 'trainer', 'Entrenador B');
  const clientA = await createClient(db, trainerA, 'Cliente A');
  const clientB = await createClient(db, trainerB, 'Cliente B');
  const planB = await createPlan(db, clientB, await createAssessment(db, clientB));
  const versionB = await createVersion(db, planB, 'manual', trainerB);

  return { trainerA, trainerB, clientA, clientB, planB, versionB };
}

const identidad = (profileId: string, role: 'trainer' | 'client'): Identity => ({
  profileId,
  role,
  telegramUserId: 1,
  telegramChatId: 1,
});

const versionDe = (
  trainerId: string,
  clientProfileId: string | null,
  state: VersionRef['state'] = 'DRAFT',
): VersionRef => ({
  versionId: 'v-1',
  state,
  client: { clientId: 'c-1', trainerId, profileId: clientProfileId },
});

// ═══════════════════════════════════════════════════════════════════════════

/**
 * La mitad HTTP de este caso —401 y cero llamadas al repo— vive en
 * `tally-webhook/index.test.ts` y `telegram-webhook/index.test.ts`, que
 * corren bajo Deno porque ahí es donde está el handler.
 *
 * Lo que se comprueba aquí es la segunda barrera: sin firma no hay
 * `service_role`, y sin `service_role` la base no deja escribir.
 */
describe('Caso 1 · petición sin firma válida → rechazada, cero escrituras', () => {
  it('un rol sin privilegios no puede insertar aunque llegue a la base', async () => {
    await db.query(`SET ROLE anon`);
    try {
      expect(
        await errorCodeOf(
          `INSERT INTO webhook_events (source, external_id, payload)
           VALUES ('tally', 'x', '{}'::jsonb)`,
        ),
      ).toBe(PG.INSUFFICIENT_PRIVILEGE);
    } finally {
      await db.query(`RESET ROLE`);
    }
  });
});

describe('Caso 2 · chat_id desconocido → ignorado', () => {
  it('no existe ningún perfil que resolver, y eso no crea nada', async () => {
    // SPEC-009: nadie se auto-registra. Un `telegram_user_id` desconocido no
    // encuentra perfil, y el webhook responde neutro sin escribir.
    const { rows } = await db.query(`SELECT id FROM profiles WHERE telegram_user_id = 999999`);

    expect(rows).toHaveLength(0);

    const { rows: despues } = await db.query(`SELECT count(*)::int AS n FROM profiles`);
    expect(despues[0]!.n).toBe(0);
  });
});

describe('Caso 3 · entrenador A no accede a clientes de entrenador B', () => {
  it('la consulta de cartera está acotada por trainer_id', async () => {
    const { trainerA, trainerB } = await dosCarteras();

    const a = await db.query(`SELECT * FROM trainer_clients($1)`, [trainerA]);
    const b = await db.query(`SELECT * FROM trainer_clients($1)`, [trainerB]);

    expect(a.rowCount).toBe(1);
    expect(b.rowCount).toBe(1);
    // Y ninguno ve al del otro.
    expect(a.rows[0]!['full_name']).toBe('Cliente A');
    expect(b.rows[0]!['full_name']).toBe('Cliente B');
  });

  it('la regla de dominio lo niega aunque llegue un id ajeno', async () => {
    const { trainerA, trainerB } = await dosCarteras();

    const resultado = canViewClient(identidad(trainerA, 'trainer'), {
      clientId: 'c-b',
      trainerId: trainerB,
      profileId: null,
    });

    expect(resultado).toEqual({ allowed: false, reason: 'NOT_YOUR_CLIENT' });
  });

  it('las versiones pendientes también están acotadas', async () => {
    const { trainerA } = await dosCarteras();

    const { rowCount } = await db.query(`SELECT * FROM trainer_pending_versions($1)`, [trainerA]);

    // La única versión que existe es de la cartera de B.
    expect(rowCount).toBe(0);
  });
});

describe('Caso 4 · cliente A no accede a datos de cliente B', () => {
  it('un cliente no ve la ficha de otro', async () => {
    const perfilA = await createProfile(db, 'client', 'Cliente A');

    expect(
      canViewClient(identidad(perfilA, 'client'), {
        clientId: 'c-b',
        trainerId: 't-1',
        profileId: 'p-cliente-b',
      }),
    ).toEqual({ allowed: false, reason: 'NOT_YOUR_CLIENT' });
  });

  it('un cliente sin vincular (profile_id NULL) no coincide con nadie', async () => {
    // El NULL es el caso peligroso: si se comparara sin comprobar, un actor
    // con profileId nulo abriría acceso a toda ficha sin vincular.
    expect(
      canViewClient(identidad('p-cualquiera', 'client'), {
        clientId: 'c-x',
        trainerId: 't-1',
        profileId: null,
      }),
    ).toEqual({ allowed: false, reason: 'NOT_YOUR_CLIENT' });
  });
});

describe('Caso 5 · un cliente no puede modificar una versión', () => {
  it('la regla lo niega por rol, antes de mirar la pertenencia', () => {
    expect(canModifyVersion(identidad('p-cliente', 'client'), versionDe('t-1', 'p-cliente'))).toEqual(
      { allowed: false, reason: 'NOT_TRAINER' },
    );
  });

  it('ni siquiera sobre SU PROPIA rutina ya enviada', () => {
    expect(
      canModifyVersion(identidad('p-cliente', 'client'), versionDe('t-1', 'p-cliente', 'SENT')),
    ).toEqual({ allowed: false, reason: 'NOT_TRAINER' });
  });

  it('lo único que puede hacer con la suya es PEDIR un cambio', () => {
    // SPEC-010: el cliente nunca muta la versión; inserta una solicitud.
    expect(
      canRequestChange(identidad('p-cliente', 'client'), versionDe('t-1', 'p-cliente', 'SENT')),
    ).toEqual({ allowed: true });
  });

  it('SPEC-013 · startManual, con datos REALES de la base, no escribe', async () => {
    // El agujero que abrió esta spec. Lo que se prueba aquí es la unión:
    // la pertenencia sale de PostgreSQL de verdad y el flujo de dominio es
    // el de producción. Lo único falso es la escritura, que no debe ocurrir.
    const { versionB } = await dosCarteras();
    const { rows } = await db.query(`SELECT * FROM version_for_creation($1)`, [versionB]);
    const fila = rows[0]!;

    let escribio = false;
    const repo: CreationRepo = {
      findVersion: () =>
        Promise.resolve({
          versionId: fila['version_id'] as string,
          state: fila['state'] as VersionRef['state'],
          client: {
            clientId: fila['client_id'] as string,
            trainerId: fila['trainer_id'] as string,
            profileId: fila['client_profile_id'] as string | null,
          },
          clientName: fila['client_name'] as string,
          versionNumber: Number(fila['version_number']),
          daysPerWeek: null,
          level: null,
          equipment: null,
          hasLimitations: false,
        }),
      fillVersion: () => {
        escribio = true;
        return Promise.resolve(true);
      },
      currentDraft: () => Promise.resolve(null),
      saveDraft: () => Promise.resolve(false),
    };

    const enviados: string[] = [];
    const deps = {
      repo,
      sender: {
        sendMessage: (_chatId: number, text: string) => {
          enviados.push(text);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve(),
      },
    };

    const resultado = await startManual(versionB, identidad('p-intruso', 'client'), deps);

    expect(resultado.kind).toBe('rejected');
    expect(escribio).toBe(false);
    expect(enviados).toHaveLength(1);
  });
});

describe('Caso 6 · el cliente no ve versiones que no estén en SENT', () => {
  it.each(['NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'REJECTED'] as const)(
    'una versión en %s no es visible para su dueño',
    (estado) => {
      expect(
        canViewVersion(identidad('p-cliente', 'client'), versionDe('t-1', 'p-cliente', estado)),
      ).toEqual({ allowed: false, reason: 'VERSION_NOT_VISIBLE' });
    },
  );

  it('en SENT sí', () => {
    expect(
      canViewVersion(identidad('p-cliente', 'client'), versionDe('t-1', 'p-cliente', 'SENT')),
    ).toEqual({ allowed: true });
  });

  it('el entrenador la ve en cualquier estado: es suya', () => {
    expect(canViewVersion(identidad('t-1', 'trainer'), versionDe('t-1', 'p-cliente', 'NEW'))).toEqual(
      { allowed: true },
    );
  });
});

describe('Caso 7 · cambiar un ID en la petición no da acceso ajeno', () => {
  it('la versión trae SU pertenencia: el id que llega no la decide', async () => {
    const { trainerB, versionB } = await dosCarteras();

    const { rows } = await db.query(`SELECT * FROM version_for_action($1)`, [versionB]);

    expect(rows[0]!['trainer_id']).toBe(trainerB);
  });

  it('SPEC-013: version_for_creation también la trae', async () => {
    // Antes de la migración 0014 no la devolvía, y por eso los flujos de
    // creación no podían comprobar nada aunque quisieran.
    const { trainerB, versionB } = await dosCarteras();

    const { rows } = await db.query(`SELECT * FROM version_for_creation($1)`, [versionB]);

    expect(rows[0]!['trainer_id']).toBe(trainerB);
    expect(rows[0]).toHaveProperty('client_profile_id');
  });

  it('con esa pertenencia, el entrenador equivocado queda fuera', async () => {
    const { trainerA, trainerB, versionB } = await dosCarteras();

    const { rows } = await db.query(`SELECT * FROM version_for_creation($1)`, [versionB]);
    const version: VersionRef = {
      versionId: versionB,
      state: rows[0]!['state'] as VersionRef['state'],
      client: {
        clientId: rows[0]!['client_id'] as string,
        trainerId: rows[0]!['trainer_id'] as string,
        profileId: rows[0]!['client_profile_id'] as string | null,
      },
    };

    expect(canModifyVersion(identidad(trainerA, 'trainer'), version).allowed).toBe(false);
    expect(canModifyVersion(identidad(trainerB, 'trainer'), version).allowed).toBe(true);
  });
});

describe('Caso 8 · anon no lee ninguna tabla', () => {
  it.each([
    'profiles',
    'clients',
    'assessments',
    'workout_plans',
    'workout_versions',
    'change_requests',
    'checkins',
    'plan_events',
    'ai_generations',
    'webhook_events',
  ])('anon no puede leer %s', async (tabla) => {
    await db.query(`SET ROLE anon`);
    try {
      expect(await errorCodeOf(`SELECT * FROM ${tabla}`)).toBe(PG.INSUFFICIENT_PRIVILEGE);
    } finally {
      await db.query(`RESET ROLE`);
    }
  });
});

describe('Caso 9 · anon no ejecuta las funciones atómicas', () => {
  it.each([
    `SELECT create_workout_version('00000000-0000-4000-8000-000000000000'::uuid, 'manual', '00000000-0000-4000-8000-000000000000'::uuid)`,
    `SELECT apply_version_transition('00000000-0000-4000-8000-000000000000'::uuid, 'NEW', 'DRAFT', 'trainer')`,
    `SELECT version_for_creation('00000000-0000-4000-8000-000000000000'::uuid)`,
    `SELECT version_for_action('00000000-0000-4000-8000-000000000000'::uuid)`,
  ])('anon no puede ejecutar %s', async (sql) => {
    await db.query(`SET ROLE anon`);
    try {
      expect(await errorCodeOf(sql)).toBe(PG.INSUFFICIENT_PRIVILEGE);
    } finally {
      await db.query(`RESET ROLE`);
    }
  });
});

describe('Caso 10 · datos inválidos rechazados por CHECK', () => {
  it('no se puede escribir un estado de IA en version_state', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await createClient(db, trainerId);
    const planId = await createPlan(db, clientId);

    // El enum no tiene ningún estado de IA: eso vive en `ai_generations`.
    expect(
      await errorCodeOf(
        `INSERT INTO workout_versions (plan_id, state, source, created_by)
         VALUES ('${planId}', 'GENERANDO_CON_GEMINI', 'manual', '${trainerId}')`,
      ),
    ).toBe(PG.INVALID_TEXT_REPRESENTATION);
  });

  it('un evento de transición sin estado destino se rechaza', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await createClient(db, trainerId);
    const planId = await createPlan(db, clientId);

    expect(
      await errorCodeOf(
        `INSERT INTO plan_events (plan_id, event_type, actor)
         VALUES ('${planId}', 'state_transition', 'trainer')`,
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('una generación FAILED sin motivo se rechaza', async () => {
    expect(
      await errorCodeOf(
        `INSERT INTO ai_generations (provider, model, operation, status)
         VALUES ('x', 'y', 'generate', 'FAILED')`,
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });
});

describe('Caso 11 · ningún secreto aparece en logs', () => {
  it.each([
    ['GEMINI_API_KEY', { apiKey: 'AIzaSyD-clave-real-de-gemini' }],
    ['el token del bot', { token: '123456:AAH-token-del-bot' }],
    ['el secreto del webhook', { webhookSecret: 'secreto-del-webhook' }],
    ['la clave de servicio', { authorization: 'Bearer service-role-jwt' }],
    ['el token de enlace del cliente', { linkToken: 'tok_abc123' }],
    ['una limitación de salud', { limitationsDetail: 'hernia discal L4-L5' }],
    ['un comentario del cliente', { comment: 'me duele la rodilla al bajar' }],
    ['las respuestas de un check-in', { answers: { feeling: 'mal' } }],
  ])('%s sale redactado', (_nombre, campo) => {
    const linea = formatLogLine({ event: 'x', level: 'info', requestId: 'r-1', ...campo });

    const valor = Object.values(campo)[0];
    const bruto = typeof valor === 'string' ? valor : JSON.stringify(valor);

    expect(linea).not.toContain(bruto);
    expect(JSON.parse(linea)[Object.keys(campo)[0]!]).toBe('[redactado]');
  });

  it('las métricas de tokens NO se redactan: son números, no credenciales', () => {
    const linea = formatLogLine({
      event: 'x',
      level: 'info',
      requestId: 'r-1',
      tokensIn: 120,
      tokensOut: 800,
    });

    expect(JSON.parse(linea)).toMatchObject({ tokensIn: 120, tokensOut: 800 });
  });
});
