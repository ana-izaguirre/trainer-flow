import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const ROOT = resolve(import.meta.dirname, '../..');

const ADMIN_URL =
  process.env['TEST_ADMIN_DATABASE_URL'] ??
  'postgresql://trainerflow:trainerflow@127.0.0.1:5432/postgres';

const TEST_DB = process.env['TEST_DATABASE_NAME'] ?? 'trainerflow_test';

export const TEST_DATABASE_URL = ADMIN_URL.replace(/\/postgres$/, `/${TEST_DB}`);

/**
 * Archivos que se aplican, en orden, sobre una base limpia.
 *
 * `00-supabase-roles.sql` NO es una migración: reproduce los roles que un
 * proyecto de Supabase trae de fábrica, para poder verificar RLS igual que en
 * producción.
 */
const SETUP_FILES = [
  'tests/sql/00-supabase-roles.sql',
  'supabase/migrations/0001_initial_schema.sql',
  'supabase/migrations/0002_rls_policies.sql',
  'supabase/migrations/0003_functions.sql',
  'supabase/migrations/0004_client_telegram_handle.sql',
  'supabase/migrations/0005_drop_client_telegram_handle.sql',
  'supabase/migrations/0006_ingest_assessment.sql',
  'supabase/migrations/0007_version_for_generation.sql',
  'supabase/migrations/0008_version_for_generation_client.sql',
] as const;

/**
 * Ejecuta sentencias sobre una conexión nueva.
 *
 * Cada una va en su propia consulta: `pg` agrupa varias sentencias en una
 * transacción implícita, y DROP/CREATE DATABASE no pueden correr ahí.
 */
async function run(url: string, statements: readonly string[]): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    await client.end();
  }
}

/** Recrea la base desde cero y aplica todas las migraciones (CA-1). */
export async function resetTestDatabase(): Promise<void> {
  await run(ADMIN_URL, [
    `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`,
    `CREATE DATABASE ${TEST_DB}`,
  ]);

  const setupSql = SETUP_FILES.map((file) => readFileSync(resolve(ROOT, file), 'utf8'));
  await run(TEST_DATABASE_URL, setupSql);
}

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}

export async function truncateAll(client: Client): Promise<void> {
  await client.query(`
    TRUNCATE profiles, clients, assessments, workout_plans, workout_versions,
             change_requests, ai_generations, plan_events, checkins, webhook_events
    RESTART IDENTITY CASCADE;
  `);
}

export function pgErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;

/** Contenido mínimo válido de un Workout, para los tests de esquema. */
export const SAMPLE_CONTENT = {
  summary: 'Rutina de prueba',
  days: [{ dayNumber: 1, focus: 'Empuje', exercises: [] }],
  warnings: [],
} as const;

// -----------------------------------------------------------------------------
// Constructores de datos de prueba
// -----------------------------------------------------------------------------

let telegramIdSeq = 1_000;

export async function createProfile(
  db: Client,
  role: 'trainer' | 'client',
  fullName = role === 'trainer' ? 'Entrenador' : 'Cliente',
): Promise<string> {
  const telegramId = ++telegramIdSeq;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO profiles (telegram_user_id, telegram_chat_id, role, full_name)
     VALUES ($1, $1, $2, $3) RETURNING id`,
    [telegramId, role, fullName],
  );
  return rows[0]!.id;
}

export async function createClient(
  db: Client,
  trainerId: string,
  name = 'Carlos Pérez',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, $2, $3) RETURNING id`,
    [trainerId, name, randomToken()],
  );
  return rows[0]!.id;
}

export async function createAssessment(db: Client, clientId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO assessments (
       client_id, raw_payload, goal, level, days_per_week,
       session_minutes, equipment, has_limitations, limitations_detail
     ) VALUES ($1, '{"origen":"test"}'::jsonb, 'Ganancia muscular', 'intermediate',
               4, 60, 'Gimnasio', true, 'Molestia de hombro')
     RETURNING id`,
    [clientId],
  );
  return rows[0]!.id;
}

export async function createPlan(
  db: Client,
  clientId: string,
  assessmentId: string | null = null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO workout_plans (client_id, assessment_id) VALUES ($1, $2) RETURNING id`,
    [clientId, assessmentId],
  );
  return rows[0]!.id;
}

/** Invoca la función atómica `create_workout_version`. */
export async function createVersion(
  db: Client,
  planId: string,
  source: 'ai' | 'template' | 'manual',
  createdBy: string,
  content: unknown = null,
  templateId: string | null = null,
): Promise<string> {
  const { rows } = await db.query<{ create_workout_version: string }>(
    `SELECT create_workout_version($1, $2, $3, $4, $5)`,
    [planId, source, createdBy, content === null ? null : JSON.stringify(content), templateId],
  );
  return rows[0]!.create_workout_version;
}

/** Invoca la función atómica `apply_version_transition`. */
export async function transition(
  db: Client,
  versionId: string,
  expected: string,
  next: string,
  actor = 'trainer',
): Promise<boolean> {
  const { rows } = await db.query<{ apply_version_transition: boolean }>(
    `SELECT apply_version_transition($1, $2, $3, $4)`,
    [versionId, expected, next, actor],
  );
  return rows[0]!.apply_version_transition;
}

/** Lleva una versión hasta SENT por el camino legítimo. */
export async function sendVersion(db: Client, versionId: string): Promise<void> {
  await transition(db, versionId, 'DRAFT', 'APPROVED', 'trainer');
  await transition(db, versionId, 'APPROVED', 'SENT', 'system');
}

function randomToken(): string {
  return Array.from({ length: 32 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
  ).join('');
}

/** Guarda el contenido editado de una versión, como haría el handler. */
export async function saveVersionContent(
  db: Client,
  versionId: string,
  content: unknown,
): Promise<void> {
  await db.query(`UPDATE workout_versions SET content = $2 WHERE id = $1`, [
    versionId,
    JSON.stringify(content),
  ]);
}

/** Vincula un cliente a un perfil de Telegram, como hace el deep link. */
export async function linkClient(
  db: Client,
  clientId: string,
  profileId: string,
): Promise<void> {
  await db.query(
    `UPDATE clients SET profile_id = $2, linked_at = now() WHERE id = $1`,
    [clientId, profileId],
  );
}

/** El estado actual de una versión, tal como está en la base de datos. */
export async function readVersion(
  db: Client,
  versionId: string,
): Promise<{ state: string; content: unknown; sent_at: Date | null; version_number: number }> {
  const { rows } = await db.query<{
    state: string;
    content: unknown;
    sent_at: Date | null;
    version_number: number;
  }>(
    `SELECT state, content, sent_at, version_number FROM workout_versions WHERE id = $1`,
    [versionId],
  );
  return rows[0]!;
}
