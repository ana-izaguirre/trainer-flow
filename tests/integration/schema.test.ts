/**
 * SPEC-000 — Criterios de aceptación del esquema.
 *
 * Cada `describe` corresponde a un criterio de la spec.
 * Requiere un PostgreSQL accesible: ver README, sección de puesta en marcha.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  PG,
  connect,
  createAssessment,
  createClient,
  createPlan,
  createTrainer,
  pgErrorCode,
  resetTestDatabase,
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

/** Ejecuta una consulta y devuelve el código de error de PostgreSQL, o null. */
async function errorCodeOf(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (error) {
    return pgErrorCode(error) ?? null;
  }
}

// ---------------------------------------------------------------------------

describe('CA-1 — el esquema se crea sin error', () => {
  it('crea exactamente las 8 tablas', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    expect(rows.map((r) => r.tablename)).toEqual([
      'ai_usage',
      'assessments',
      'checkins',
      'clients',
      'plan_events',
      'trainers',
      'webhook_events',
      'workout_plans',
    ]);
  });

  it('crea el enum plan_state con los 10 estados en orden', async () => {
    const { rows } = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'plan_state' ORDER BY e.enumsortorder`,
    );

    expect(rows.map((r) => r.enumlabel)).toEqual([
      'NEW',
      'GENERATING',
      'DRAFT',
      'TRAINER_REVIEW',
      'EDITING',
      'APPROVED',
      'SENT',
      'REJECTED',
      'FAILED',
      'MANUAL',
    ]);
  });

  it('crea el índice parcial de rutinas pendientes de revisión', async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'workout_plans' AND indexname = 'workout_plans_pending_review_idx'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain("TRAINER_REVIEW");
  });
});

// ---------------------------------------------------------------------------

describe('CA-2 — idempotencia de webhooks', () => {
  it('rechaza el mismo (source, external_id) por segunda vez', async () => {
    await db.query(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('tally', 'evt_1', '{}'::jsonb)`,
    );

    const code = await errorCodeOf(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('tally', 'evt_1', '{}'::jsonb)`,
    );

    expect(code).toBe(PG.UNIQUE_VIOLATION);
  });

  it('permite el mismo external_id si el origen es distinto', async () => {
    await db.query(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('tally', 'evt_1', '{}'::jsonb)`,
    );

    const code = await errorCodeOf(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('telegram', 'evt_1', '{}'::jsonb)`,
    );

    expect(code).toBeNull();
  });

  it('rechaza un origen desconocido', async () => {
    const code = await errorCodeOf(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('whatsapp', 'evt_1', '{}'::jsonb)`,
    );

    expect(code).toBe(PG.CHECK_VIOLATION);
  });
});

// ---------------------------------------------------------------------------

describe('CA-3 — los CHECK rechazan datos inválidos', () => {
  let clientId: string;

  beforeEach(async () => {
    const trainerId = await createTrainer(db);
    clientId = await createClient(db, trainerId);
  });

  const insertAssessment = (overrides: Record<string, unknown>) => {
    const base = {
      goal: 'Ganancia muscular',
      level: 'intermediate',
      days_per_week: 4,
      session_minutes: 60,
      equipment: 'Gimnasio',
      has_limitations: false,
      limitations_detail: null,
      ...overrides,
    };

    return errorCodeOf(
      `INSERT INTO assessments (
         client_id, raw_payload, goal, level, days_per_week,
         session_minutes, equipment, has_limitations, limitations_detail
       ) VALUES ($1, '{}'::jsonb, $2, $3, $4, $5, $6, $7, $8)`,
      [
        clientId,
        base.goal,
        base.level,
        base.days_per_week,
        base.session_minutes,
        base.equipment,
        base.has_limitations,
        base.limitations_detail,
      ],
    );
  };

  it('rechaza days_per_week = 9', async () => {
    expect(await insertAssessment({ days_per_week: 9 })).toBe(PG.CHECK_VIOLATION);
  });

  it('rechaza days_per_week = 0', async () => {
    expect(await insertAssessment({ days_per_week: 0 })).toBe(PG.CHECK_VIOLATION);
  });

  it('acepta los extremos válidos de days_per_week', async () => {
    expect(await insertAssessment({ days_per_week: 1 })).toBeNull();
    expect(await insertAssessment({ days_per_week: 7 })).toBeNull();
  });

  it('rechaza session_minutes fuera del rango 15..180', async () => {
    expect(await insertAssessment({ session_minutes: 10 })).toBe(PG.CHECK_VIOLATION);
    expect(await insertAssessment({ session_minutes: 181 })).toBe(PG.CHECK_VIOLATION);
  });

  it('rechaza un nivel fuera del conjunto permitido', async () => {
    expect(await insertAssessment({ level: 'experto' })).toBe(PG.CHECK_VIOLATION);
  });

  it('rechaza detalle de limitaciones sin limitaciones declaradas', async () => {
    expect(
      await insertAssessment({ has_limitations: false, limitations_detail: 'hombro' }),
    ).toBe(PG.CHECK_VIOLATION);
  });
});

// ---------------------------------------------------------------------------

describe('CA-4 — borrar un cliente arrastra sus datos', () => {
  it('borra en cascada evaluaciones, rutinas y eventos', async () => {
    const trainerId = await createTrainer(db);
    const clientId = await createClient(db, trainerId);
    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);

    await db.query(
      `INSERT INTO plan_events (plan_id, from_state, to_state, actor)
       VALUES ($1, NULL, 'NEW', 'system')`,
      [planId],
    );

    await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);

    for (const table of ['assessments', 'workout_plans', 'plan_events']) {
      const { rows } = await db.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
      expect(rows[0]!.count, `${table} debería quedar vacía`).toBe('0');
    }
  });
});

// ---------------------------------------------------------------------------

describe('CA-5 — un entrenador con clientes no se puede borrar', () => {
  it('impide el borrado con ON DELETE RESTRICT', async () => {
    const trainerId = await createTrainer(db);
    await createClient(db, trainerId);

    const code = await errorCodeOf(`DELETE FROM trainers WHERE id = $1`, [trainerId]);

    expect(code).toBe(PG.FOREIGN_KEY_VIOLATION);
  });

  it('permite borrar un entrenador sin clientes', async () => {
    const trainerId = await createTrainer(db);

    expect(await errorCodeOf(`DELETE FROM trainers WHERE id = $1`, [trainerId])).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('CA-6 — anon no obtiene ningún dato', () => {
  beforeEach(async () => {
    const trainerId = await createTrainer(db);
    await createClient(db, trainerId);
  });

  it('deniega el acceso por falta de privilegios (defensa en profundidad)', async () => {
    await db.query(`SET ROLE anon`);
    try {
      const code = await errorCodeOf(`SELECT * FROM clients`);
      expect(code).toBe(PG.INSUFFICIENT_PRIVILEGE);
    } finally {
      await db.query(`RESET ROLE`);
    }
  });

  it('devuelve cero filas por RLS aunque tuviera privilegios de lectura', async () => {
    // Se conceden privilegios a propósito para aislar el efecto de RLS:
    // sin esto, el `revoke` de la migración 0002 falla antes y RLS nunca
    // llega a evaluarse, así que el test no probaría lo que dice probar.
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

  it('tiene RLS activo y cero políticas en las 8 tablas', async () => {
    const { rows } = await db.query<{ tablename: string; rowsecurity: boolean; policies: string }>(
      `SELECT t.tablename, c.relrowsecurity AS rowsecurity,
              (SELECT count(*) FROM pg_policies p WHERE p.tablename = t.tablename) AS policies
       FROM pg_tables t
       JOIN pg_class c ON c.relname = t.tablename
       WHERE t.schemaname = 'public'`,
    );

    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.rowsecurity, `${row.tablename} debe tener RLS activo`).toBe(true);
      expect(row.policies, `${row.tablename} debe denegar por defecto`).toBe('0');
    }
  });
});

// ---------------------------------------------------------------------------
// Invariantes que sostienen specs posteriores.
// ---------------------------------------------------------------------------

describe('invariantes de workout_plans', () => {
  let clientId: string;
  let assessmentId: string;

  beforeEach(async () => {
    const trainerId = await createTrainer(db);
    clientId = await createClient(db, trainerId);
    assessmentId = await createAssessment(db, clientId);
  });

  it('un plan nace en NEW, versión 1 y sin ediciones', async () => {
    const planId = await createPlan(db, clientId, assessmentId);
    const { rows } = await db.query<{ state: string; version: number; edit_count: number }>(
      `SELECT state, version, edit_count FROM workout_plans WHERE id = $1`,
      [planId],
    );

    expect(rows[0]).toMatchObject({ state: 'NEW', version: 1, edit_count: 0 });
  });

  it('un plan en TRAINER_REVIEW no puede estar sin contenido', async () => {
    const planId = await createPlan(db, clientId, assessmentId);

    const code = await errorCodeOf(
      `UPDATE workout_plans SET state = 'TRAINER_REVIEW' WHERE id = $1`,
      [planId],
    );

    expect(code).toBe(PG.CHECK_VIOLATION);
  });

  it('un plan en SENT exige sent_at (SPEC-006 lo necesita para week_number)', async () => {
    const planId = await createPlan(db, clientId, assessmentId);
    await db.query(`UPDATE workout_plans SET content = '{}'::jsonb WHERE id = $1`, [planId]);

    expect(
      await errorCodeOf(`UPDATE workout_plans SET state = 'SENT' WHERE id = $1`, [planId]),
    ).toBe(PG.CHECK_VIOLATION);

    expect(
      await errorCodeOf(
        `UPDATE workout_plans SET state = 'SENT', sent_at = now() WHERE id = $1`,
        [planId],
      ),
    ).toBeNull();
  });

  it('rechaza la sexta edición (SPEC-004, regla 9)', async () => {
    const planId = await createPlan(db, clientId, assessmentId);

    expect(
      await errorCodeOf(`UPDATE workout_plans SET edit_count = 5 WHERE id = $1`, [planId]),
    ).toBeNull();

    expect(
      await errorCodeOf(`UPDATE workout_plans SET edit_count = 6 WHERE id = $1`, [planId]),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('actualiza updated_at automáticamente', async () => {
    const planId = await createPlan(db, clientId, assessmentId);
    const before = await db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM workout_plans WHERE id = $1`,
      [planId],
    );

    await db.query(`UPDATE workout_plans SET failure_reason = 'prueba' WHERE id = $1`, [planId]);

    const after = await db.query<{ updated_at: Date }>(
      `SELECT updated_at FROM workout_plans WHERE id = $1`,
      [planId],
    );

    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0]!.updated_at.getTime(),
    );
  });
});

describe('invariantes de clients', () => {
  it('la vinculación a Telegram es atómica', async () => {
    const trainerId = await createTrainer(db);
    const clientId = await createClient(db, trainerId);

    // chat_id sin fecha de vinculación: inconsistente.
    expect(
      await errorCodeOf(`UPDATE clients SET telegram_chat_id = 999 WHERE id = $1`, [clientId]),
    ).toBe(PG.CHECK_VIOLATION);

    // Ambos a la vez: correcto.
    expect(
      await errorCodeOf(
        `UPDATE clients SET telegram_chat_id = 999, linked_at = now() WHERE id = $1`,
        [clientId],
      ),
    ).toBeNull();
  });

  it('un link_token no se puede repetir', async () => {
    const trainerId = await createTrainer(db);
    await db.query(
      `INSERT INTO clients (trainer_id, full_name, link_token) VALUES ($1, 'A', 'token_de_32_caracteres_exactos__')`,
      [trainerId],
    );

    expect(
      await errorCodeOf(
        `INSERT INTO clients (trainer_id, full_name, link_token) VALUES ($1, 'B', 'token_de_32_caracteres_exactos__')`,
        [trainerId],
      ),
    ).toBe(PG.UNIQUE_VIOLATION);
  });

  it('un link_token demasiado corto se rechaza', async () => {
    const trainerId = await createTrainer(db);

    expect(
      await errorCodeOf(
        `INSERT INTO clients (trainer_id, full_name, link_token) VALUES ($1, 'A', 'corto')`,
        [trainerId],
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('el mismo email no se repite dentro de un entrenador, sin distinguir mayúsculas', async () => {
    const trainerId = await createTrainer(db);
    await db.query(
      `INSERT INTO clients (trainer_id, full_name, email, link_token)
       VALUES ($1, 'Carlos', 'carlos@example.com', 'token_de_32_caracteres_exactos_a')`,
      [trainerId],
    );

    expect(
      await errorCodeOf(
        `INSERT INTO clients (trainer_id, full_name, email, link_token)
         VALUES ($1, 'Carlos B', 'CARLOS@EXAMPLE.COM', 'token_de_32_caracteres_exactos_b')`,
        [trainerId],
      ),
    ).toBe(PG.UNIQUE_VIOLATION);
  });
});

describe('invariantes de checkins', () => {
  it('correr el cron dos veces no duplica el check-in de la semana', async () => {
    const trainerId = await createTrainer(db);
    const clientId = await createClient(db, trainerId);
    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);

    await db.query(
      `INSERT INTO checkins (client_id, plan_id, week_number) VALUES ($1, $2, 1)`,
      [clientId, planId],
    );

    const code = await errorCodeOf(
      `INSERT INTO checkins (client_id, plan_id, week_number) VALUES ($1, $2, 1)`,
      [clientId, planId],
    );

    expect(code).toBe(PG.UNIQUE_VIOLATION);
  });

  it('un check-in COMPLETED exige completed_at', async () => {
    const trainerId = await createTrainer(db);
    const clientId = await createClient(db, trainerId);
    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);

    const code = await errorCodeOf(
      `INSERT INTO checkins (client_id, plan_id, week_number, state)
       VALUES ($1, $2, 1, 'COMPLETED')`,
      [clientId, planId],
    );

    expect(code).toBe(PG.CHECK_VIOLATION);
  });
});

describe('invariantes de plan_events', () => {
  it('rechaza un actor desconocido', async () => {
    const trainerId = await createTrainer(db);
    const clientId = await createClient(db, trainerId);
    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);

    expect(
      await errorCodeOf(
        `INSERT INTO plan_events (plan_id, to_state, actor) VALUES ($1, 'NEW', 'hacker')`,
        [planId],
      ),
    ).toBe(PG.CHECK_VIOLATION);
  });

  it('acepta from_state nulo en la creación', async () => {
    const trainerId = await createTrainer(db);
    const clientId = await createClient(db, trainerId);
    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);

    expect(
      await errorCodeOf(
        `INSERT INTO plan_events (plan_id, from_state, to_state, actor)
         VALUES ($1, NULL, 'NEW', 'system')`,
        [planId],
      ),
    ).toBeNull();
  });
});
