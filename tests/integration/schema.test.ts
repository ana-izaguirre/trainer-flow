/**
 * SPEC-000 — Criterios de aceptación del esquema.
 *
 * Requiere un PostgreSQL accesible. Ver README.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  PG,
  SAMPLE_CONTENT,
  connect,
  createAssessment,
  createClient,
  createPlan,
  createProfile,
  createVersion,
  pgErrorCode,
  resetTestDatabase,
  sendVersion,
  transition,
  truncateAll,
} from '../helpers/db.ts';

let db: Client;

beforeAll(async () => {
  await resetTestDatabase();
  db = await connect();
}, 60_000);

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function errorCodeOf(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return pgErrorCode(error) ?? null;
  }
}

/** Entrenador + cliente + plan listos para usar. */
async function setupPlan(): Promise<{ trainerId: string; clientId: string; planId: string }> {
  const trainerId = await createProfile(db, 'trainer');
  const clientId = await createClient(db, trainerId);
  const planId = await createPlan(db, clientId);
  return { trainerId, clientId, planId };
}

// ---------------------------------------------------------------------------

describe('CA-1 — el esquema se crea sin error', () => {
  it('crea exactamente las 10 tablas', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([
      'ai_generations',
      'assessments',
      'change_requests',
      'checkins',
      'clients',
      'plan_events',
      'profiles',
      'webhook_events',
      'workout_plans',
      'workout_versions',
    ]);
  });

  it('el enum de dominio tiene 6 estados y NINGUNO es de IA', async () => {
    const { rows } = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'version_state' ORDER BY e.enumsortorder`,
    );

    const states = rows.map((r) => r.enumlabel);
    expect(states).toEqual(['NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED']);

    // El punto §1: la IA no contamina el dominio.
    expect(states).not.toContain('FAILED');
    expect(states).not.toContain('MANUAL');
  });

  it('crea los enums de rol, origen y motivo de cambio', async () => {
    const { rows } = await db.query<{ typname: string }>(
      `SELECT typname FROM pg_type WHERE typname IN
       ('user_role', 'version_source', 'change_reason') ORDER BY typname`,
    );

    expect(rows.map((r) => r.typname)).toEqual([
      'change_reason',
      'user_role',
      'version_source',
    ]);
  });

  it('crea las dos funciones atómicas', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE proname IN
       ('create_workout_version', 'apply_version_transition') ORDER BY proname`,
    );

    expect(rows.map((r) => r.proname)).toEqual([
      'apply_version_transition',
      'create_workout_version',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('CA-2 — idempotencia', () => {
  it('rechaza el mismo (source, external_id) por segunda vez', async () => {
    await db.query(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('tally', 'evt_1', '{}'::jsonb)`,
    );

    expect(
      await errorCodeOf(
        `INSERT INTO webhook_events (source, external_id, payload)
         VALUES ('tally', 'evt_1', '{}'::jsonb)`,
      ),
    ).toBe(PG.UNIQUE_VIOLATION);
  });

  it('permite el mismo external_id si el origen es distinto', async () => {
    await db.query(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('tally', 'evt_1', '{}'::jsonb)`,
    );

    expect(
      await errorCodeOf(
        `INSERT INTO webhook_events (source, external_id, payload)
         VALUES ('telegram', 'evt_1', '{}'::jsonb)`,
      ),
    ).toBeNull();
  });

  it('no permite dos versiones con el mismo número en un plan', async () => {
    const { trainerId, planId } = await setupPlan();
    await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    expect(
      await errorCodeOf(
        `INSERT INTO workout_versions (plan_id, version_number, source, created_by, content)
         VALUES ($1, 1, 'manual', $2, '{}'::jsonb)`,
        [planId, trainerId],
      ),
    ).toBe(PG.UNIQUE_VIOLATION);
  });
});

// ---------------------------------------------------------------------------

describe('CA-3 — los CHECK rechazan datos inválidos', () => {
  let clientId: string;

  beforeEach(async () => {
    const trainerId = await createProfile(db, 'trainer');
    clientId = await createClient(db, trainerId);
  });

  const insertAssessment = (overrides: Record<string, unknown> = {}) => {
    const v = {
      level: 'intermediate',
      days_per_week: 4,
      session_minutes: 60,
      has_limitations: false,
      limitations_detail: null,
      ...overrides,
    };
    return errorCodeOf(
      `INSERT INTO assessments (client_id, raw_payload, goal, level, days_per_week,
         session_minutes, equipment, has_limitations, limitations_detail)
       VALUES ($1, '{}'::jsonb, 'Objetivo', $2, $3, $4, 'Gimnasio', $5, $6)`,
      [clientId, v.level, v.days_per_week, v.session_minutes, v.has_limitations, v.limitations_detail],
    );
  };

  it('rechaza days_per_week fuera de 1..7', async () => {
    expect(await insertAssessment({ days_per_week: 9 })).toBe(PG.CHECK_VIOLATION);
    expect(await insertAssessment({ days_per_week: 0 })).toBe(PG.CHECK_VIOLATION);
  });

  it('acepta los extremos válidos', async () => {
    expect(await insertAssessment({ days_per_week: 1 })).toBeNull();
    expect(await insertAssessment({ days_per_week: 7 })).toBeNull();
  });

  it('rechaza session_minutes fuera de 15..180', async () => {
    expect(await insertAssessment({ session_minutes: 10 })).toBe(PG.CHECK_VIOLATION);
    expect(await insertAssessment({ session_minutes: 181 })).toBe(PG.CHECK_VIOLATION);
  });

  it('rechaza un nivel desconocido', async () => {
    expect(await insertAssessment({ level: 'experto' })).toBe(PG.CHECK_VIOLATION);
  });

  it('rechaza detalle de limitaciones sin limitaciones declaradas', async () => {
    expect(
      await insertAssessment({ has_limitations: false, limitations_detail: 'hombro' }),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('rechaza un comentario de solicitud de más de 500 caracteres', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const c = await createClient(db, trainerId, 'Otro');
    const planId = await createPlan(db, c);
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    expect(
      await errorCodeOf(
        `INSERT INTO change_requests (version_id, client_id, reason, comment)
         VALUES ($1, $2, 'too_hard', $3)`,
        [versionId, c, 'x'.repeat(501)],
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });
});

// ---------------------------------------------------------------------------

describe('CA-4 — borrar un cliente arrastra sus datos', () => {
  it('borra en cascada evaluaciones, planes, versiones y eventos', async () => {
    const { trainerId, clientId, planId } = await setupPlan();
    await createAssessment(db, clientId);
    await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);

    for (const table of ['assessments', 'workout_plans', 'workout_versions', 'plan_events']) {
      const { rows } = await db.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
      expect(rows[0]!.count, `${table} debería quedar vacía`).toBe('0');
    }
  });
});

// ---------------------------------------------------------------------------

describe('CA-5 — un entrenador con clientes no se puede borrar', () => {
  it('impide el borrado con ON DELETE RESTRICT', async () => {
    const trainerId = await createProfile(db, 'trainer');
    await createClient(db, trainerId);

    expect(await errorCodeOf(`DELETE FROM profiles WHERE id = $1`, [trainerId])).toBe(
      PG.FOREIGN_KEY_VIOLATION,
    );
  });

  it('permite borrar un perfil sin clientes', async () => {
    const id = await createProfile(db, 'trainer');
    expect(await errorCodeOf(`DELETE FROM profiles WHERE id = $1`, [id])).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('CA-6 — anon no obtiene ningún dato', () => {
  beforeEach(async () => {
    const trainerId = await createProfile(db, 'trainer');
    await createClient(db, trainerId);
  });

  it('deniega el acceso por falta de privilegios (defensa en profundidad)', async () => {
    await db.query(`SET ROLE anon`);
    try {
      expect(await errorCodeOf(`SELECT * FROM clients`)).toBe(PG.INSUFFICIENT_PRIVILEGE);
    } finally {
      await db.query(`RESET ROLE`);
    }
  });

  it('devuelve cero filas por RLS aunque tuviera privilegios de lectura', async () => {
    // Se conceden privilegios a propósito para aislar el efecto de RLS: sin
    // esto, el revoke de la migración 0002 falla antes y RLS nunca se evalúa,
    // así que el test no probaría lo que dice probar.
    await db.query(`GRANT SELECT ON clients TO anon`);
    try {
      await db.query(`SET ROLE anon`);
      const { rows } = await db.query(`SELECT * FROM clients`);
      expect(rows).toHaveLength(0);
    } finally {
      await db.query(`RESET ROLE`);
      await db.query(`REVOKE SELECT ON clients FROM anon`);
    }
  });

  it('tiene RLS activo y cero políticas en las 10 tablas', async () => {
    const { rows } = await db.query<{ tablename: string; rls: boolean; policies: string }>(
      `SELECT t.tablename, c.relrowsecurity AS rls,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = t.tablename) AS policies
       FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
       WHERE t.schemaname = 'public'`,
    );

    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.rls, `${row.tablename} debe tener RLS activo`).toBe(true);
      expect(row.policies, `${row.tablename} debe denegar por defecto`).toBe('0');
    }
  });

  it('anon no puede ejecutar las funciones atómicas', async () => {
    await db.query(`SET ROLE anon`);
    try {
      expect(
        await errorCodeOf(
          `SELECT create_workout_version($1, 'manual', $1)`,
          ['00000000-0000-0000-0000-000000000000'],
        ),
      ).toBe(PG.INSUFFICIENT_PRIVILEGE);
    } finally {
      await db.query(`RESET ROLE`);
    }
  });
});

// ---------------------------------------------------------------------------

describe('los roles se validan en la base de datos, no solo en código', () => {
  it('no se puede asignar el perfil de un cliente como entrenador', async () => {
    const clientProfile = await createProfile(db, 'client');

    expect(
      await errorCodeOf(
        `INSERT INTO clients (trainer_id, full_name, link_token)
         VALUES ($1, 'X', 'token_de_32_caracteres_exactos__')`,
        [clientProfile],
      ),
    ).toBe(PG.FOREIGN_KEY_VIOLATION);
  });

  it('no se puede vincular un perfil de entrenador como cliente', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const otherTrainer = await createProfile(db, 'trainer', 'Otro');
    const clientId = await createClient(db, trainerId);

    expect(
      await errorCodeOf(
        `UPDATE clients SET profile_id = $1, linked_at = now() WHERE id = $2`,
        [otherTrainer, clientId],
      ),
    ).toBe(PG.FOREIGN_KEY_VIOLATION);
  });

  it('vincular un perfil de cliente sí funciona', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientProfile = await createProfile(db, 'client');
    const clientId = await createClient(db, trainerId);

    expect(
      await errorCodeOf(
        `UPDATE clients SET profile_id = $1, linked_at = now() WHERE id = $2`,
        [clientProfile, clientId],
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('la IA es una capacidad, no la dueña del dominio', () => {
  it('un plan puede existir sin evaluación (rutina manual)', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await createClient(db, trainerId);

    const { rows } = await db.query<{ assessment_id: string | null }>(
      `INSERT INTO workout_plans (client_id) VALUES ($1) RETURNING assessment_id`,
      [clientId],
    );

    expect(rows[0]!.assessment_id).toBeNull();
  });

  it('una versión manual con contenido nace en DRAFT, sin pasar por la IA', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    const { rows } = await db.query<{ state: string; source: string }>(
      `SELECT state, source FROM workout_versions WHERE id = $1`,
      [versionId],
    );

    expect(rows[0]).toMatchObject({ state: 'DRAFT', source: 'manual' });

    const { rows: gens } = await db.query(`SELECT * FROM ai_generations`);
    expect(gens, 'una rutina manual no toca la IA').toHaveLength(0);
  });

  it('una versión de IA sin contenido nace en NEW', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'ai', trainerId);

    const { rows } = await db.query<{ state: string }>(
      `SELECT state FROM workout_versions WHERE id = $1`,
      [versionId],
    );

    expect(rows[0]!.state).toBe('NEW');
  });

  it('una plantilla exige template_id, y los otros orígenes lo prohíben', async () => {
    const { trainerId, planId } = await setupPlan();

    expect(
      await errorCodeOf(
        `INSERT INTO workout_versions (plan_id, version_number, source, created_by, content)
         VALUES ($1, 10, 'template', $2, '{}'::jsonb)`,
        [planId, trainerId],
      ),
    ).toBe(PG.CHECK_VIOLATION);

    expect(
      await errorCodeOf(
        `INSERT INTO workout_versions (plan_id, version_number, source, created_by, content, template_id)
         VALUES ($1, 11, 'manual', $2, '{}'::jsonb, 'full-body-3d')`,
        [planId, trainerId],
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('el fallo de la IA se registra en ai_generations, no en el enum del dominio', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'ai', trainerId);

    await db.query(
      `INSERT INTO ai_generations (provider, model, operation, version_id, status, failure_reason)
       VALUES ('gemini', 'gemini-flash-latest', 'generate', $1, 'FAILED', 'RATE_LIMITED')`,
      [versionId],
    );

    // La versión vuelve a NEW: el entrenador continúa por plantilla o manual.
    expect(await transition(db, versionId, 'NEW', 'NEW', 'system')).toBe(true);

    const { rows } = await db.query<{ failure_reason: string }>(
      `SELECT failure_reason FROM ai_generations WHERE version_id = $1`,
      [versionId],
    );
    expect(rows[0]!.failure_reason).toBe('RATE_LIMITED');
  });

  it('un fallo exige motivo, y un éxito no puede tenerlo', async () => {
    expect(
      await errorCodeOf(
        `INSERT INTO ai_generations (provider, model, operation, status)
         VALUES ('gemini', 'm', 'generate', 'FAILED')`,
      ),
    ).toBe(PG.CHECK_VIOLATION);

    expect(
      await errorCodeOf(
        `INSERT INTO ai_generations (provider, model, operation, status, failure_reason)
         VALUES ('gemini', 'm', 'generate', 'SUCCEEDED', 'algo')`,
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });
});

// ---------------------------------------------------------------------------

describe('versionado: una rutina enviada no se sobrescribe (§7)', () => {
  it('crear v2 deja v1 intacta, con su contenido y su estado', async () => {
    const { trainerId, planId } = await setupPlan();

    const v1 = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
    await sendVersion(db, v1);

    const before = await db.query<{ content: unknown; state: string; sent_at: Date }>(
      `SELECT content, state, sent_at FROM workout_versions WHERE id = $1`,
      [v1],
    );

    const v2 = await createVersion(db, planId, 'manual', trainerId, {
      ...SAMPLE_CONTENT,
      summary: 'Versión revisada',
    });

    const after = await db.query<{ content: unknown; state: string; sent_at: Date }>(
      `SELECT content, state, sent_at FROM workout_versions WHERE id = $1`,
      [v1],
    );

    expect(after.rows[0]!.content).toEqual(before.rows[0]!.content);
    expect(after.rows[0]!.state).toBe('SENT');
    expect(after.rows[0]!.sent_at).toEqual(before.rows[0]!.sent_at);

    const { rows } = await db.query<{ version_number: number }>(
      `SELECT version_number FROM workout_versions WHERE id = $1`,
      [v2],
    );
    expect(rows[0]!.version_number).toBe(2);
  });

  it('current_version_id apunta a la versión más reciente', async () => {
    const { trainerId, planId } = await setupPlan();
    await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
    const v2 = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    const { rows } = await db.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM workout_plans WHERE id = $1`,
      [planId],
    );

    expect(rows[0]!.current_version_id).toBe(v2);
  });

  it('una solicitud de cambio no muta la versión', async () => {
    const { trainerId, clientId, planId } = await setupPlan();
    const v1 = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
    await sendVersion(db, v1);

    const before = await db.query<{ updated_at: Date; state: string }>(
      `SELECT updated_at, state FROM workout_versions WHERE id = $1`,
      [v1],
    );

    await db.query(
      `INSERT INTO change_requests (version_id, client_id, reason, comment)
       VALUES ($1, $2, 'too_hard', 'Muy exigente la semana 1')`,
      [v1, clientId],
    );

    const after = await db.query<{ updated_at: Date; state: string }>(
      `SELECT updated_at, state FROM workout_versions WHERE id = $1`,
      [v1],
    );

    expect(after.rows[0]!.updated_at).toEqual(before.rows[0]!.updated_at);
    expect(after.rows[0]!.state).toBe('SENT');
  });

  it('una versión revisable o enviada exige contenido', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'ai', trainerId);

    expect(
      await errorCodeOf(`UPDATE workout_versions SET state = 'DRAFT' WHERE id = $1`, [versionId]),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('SENT exige sent_at', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    expect(
      await errorCodeOf(`UPDATE workout_versions SET state = 'SENT' WHERE id = $1`, [versionId]),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('rechaza la sexta edición', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    expect(
      await errorCodeOf(`UPDATE workout_versions SET edit_count = 5 WHERE id = $1`, [versionId]),
    ).toBeNull();
    expect(
      await errorCodeOf(`UPDATE workout_versions SET edit_count = 6 WHERE id = $1`, [versionId]),
    ).toBe(PG.CHECK_VIOLATION);
  });
});

// ---------------------------------------------------------------------------

describe('operaciones atómicas', () => {
  it('numera las versiones de forma correlativa', async () => {
    const { trainerId, planId } = await setupPlan();

    for (const expected of [1, 2, 3]) {
      const id = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
      const { rows } = await db.query<{ version_number: number }>(
        `SELECT version_number FROM workout_versions WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.version_number).toBe(expected);
    }
  });

  it('cada transición deja su rastro en el audit trail', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
    await sendVersion(db, versionId);

    const { rows } = await db.query<{ from_state: string | null; to_state: string; actor: string }>(
      `SELECT from_state, to_state, actor FROM plan_events
       WHERE version_id = $1 ORDER BY id`,
      [versionId],
    );

    expect(rows).toEqual([
      { from_state: null, to_state: 'DRAFT', actor: 'trainer' },
      { from_state: 'DRAFT', to_state: 'APPROVED', actor: 'trainer' },
      { from_state: 'APPROVED', to_state: 'SENT', actor: 'system' },
    ]);
  });

  it('la guarda de concurrencia impide aplicar dos veces la misma acción', async () => {
    const { trainerId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    // Primera pulsación de "Aprobar".
    expect(await transition(db, versionId, 'DRAFT', 'APPROVED')).toBe(true);
    // Segunda pulsación: el estado ya cambió, no se pisa.
    expect(await transition(db, versionId, 'DRAFT', 'APPROVED')).toBe(false);

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*) FROM plan_events WHERE version_id = $1 AND to_state = 'APPROVED'`,
      [versionId],
    );
    expect(rows[0]!.count, 'solo debe registrarse una aprobación').toBe('1');
  });

  it('falla al crear una versión sobre un plan inexistente', async () => {
    const trainerId = await createProfile(db, 'trainer');

    expect(
      await errorCodeOf(`SELECT create_workout_version($1, 'manual', $2, '{}'::jsonb)`, [
        '00000000-0000-0000-0000-000000000000',
        trainerId,
      ]),
    ).toBe(PG.FOREIGN_KEY_VIOLATION);
  });
});

// ---------------------------------------------------------------------------

describe('invariantes de clients y checkins', () => {
  it('la vinculación a Telegram es atómica', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientProfile = await createProfile(db, 'client');
    const clientId = await createClient(db, trainerId);

    expect(
      await errorCodeOf(`UPDATE clients SET profile_id = $1 WHERE id = $2`, [
        clientProfile,
        clientId,
      ]),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('un link_token demasiado corto se rechaza', async () => {
    const trainerId = await createProfile(db, 'trainer');

    expect(
      await errorCodeOf(
        `INSERT INTO clients (trainer_id, full_name, link_token) VALUES ($1, 'A', 'corto')`,
        [trainerId],
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('dos clientes con el mismo nombre conviven como clientes distintos', async () => {
    // SPEC-001: el formulario es onboarding. Cada envío crea un cliente nuevo.
    // Fusionarlos por nombre metería la lesión de un Carlos en la rutina del
    // otro, y en silencio. Un duplicado que se ve es mejor que eso.
    const trainerId = await createProfile(db, 'trainer');

    for (const token of ['token_de_32_caracteres_exactos_a', 'token_de_32_caracteres_exactos_b']) {
      await db.query(
        `INSERT INTO clients (trainer_id, full_name, link_token) VALUES ($1, 'Carlos Pérez', $2)`,
        [trainerId, token],
      );
    }

    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*) FROM clients WHERE full_name = 'Carlos Pérez'`,
    );
    expect(rows[0]!.count).toBe('2');
  });

  it('correr el cron dos veces no duplica el check-in de la semana', async () => {
    const { trainerId, clientId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
    await sendVersion(db, versionId);

    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number) VALUES ($1, $2, 1)`,
      [clientId, versionId],
    );

    expect(
      await errorCodeOf(
        `INSERT INTO checkins (client_id, version_id, week_number) VALUES ($1, $2, 1)`,
        [clientId, versionId],
      ),
    ).toBe(PG.UNIQUE_VIOLATION);
  });

  it('un check-in COMPLETED exige completed_at', async () => {
    const { trainerId, clientId, planId } = await setupPlan();
    const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);

    expect(
      await errorCodeOf(
        `INSERT INTO checkins (client_id, version_id, week_number, state)
         VALUES ($1, $2, 1, 'COMPLETED')`,
        [clientId, versionId],
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });
});
