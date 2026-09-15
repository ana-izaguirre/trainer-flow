import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * URL de administración: sirve para crear y borrar la base de tests.
 * Apunta a `postgres`, no a la base de tests.
 */
const ADMIN_URL =
  process.env['TEST_ADMIN_DATABASE_URL'] ??
  'postgresql://trainerflow:trainerflow@127.0.0.1:5432/postgres';

const TEST_DB = process.env['TEST_DATABASE_NAME'] ?? 'trainerflow_test';

export const TEST_DATABASE_URL = ADMIN_URL.replace(/\/postgres$/, `/${TEST_DB}`);

/**
 * Archivos que se aplican, en orden, sobre una base limpia.
 *
 * `00-supabase-roles.sql` NO es una migración: reproduce los roles que un
 * proyecto de Supabase trae de fábrica, para que RLS se pueda verificar igual
 * que en producción.
 */
const SETUP_FILES = [
  'tests/sql/00-supabase-roles.sql',
  'supabase/migrations/0001_initial_schema.sql',
  'supabase/migrations/0002_rls_policies.sql',
] as const;

/**
 * Ejecuta una o varias sentencias sobre una conexión nueva.
 *
 * Cada sentencia va en su propia consulta: `pg` agrupa varias sentencias en
 * una transacción implícita, y DROP/CREATE DATABASE no pueden correr ahí.
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

/**
 * Recrea la base de tests desde cero y aplica todas las migraciones.
 *
 * Equivale a `supabase db reset`, que es lo que verifica CA-1.
 */
export async function resetTestDatabase(): Promise<void> {
  await run(ADMIN_URL, [
    `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`,
    `CREATE DATABASE ${TEST_DB}`,
  ]);

  const setupSql = SETUP_FILES.map((file) => readFileSync(resolve(ROOT, file), 'utf8'));
  await run(TEST_DATABASE_URL, setupSql);
}

/** Abre una conexión a la base de tests. Recuerda cerrarla. */
export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}

/** Vacía todas las tablas conservando el esquema. */
export async function truncateAll(client: Client): Promise<void> {
  await client.query(`
    TRUNCATE trainers, clients, assessments, workout_plans,
             plan_events, checkins, webhook_events, ai_usage
    RESTART IDENTITY CASCADE;
  `);
}

/** Código de error de PostgreSQL de una excepción de `pg`. */
export function pgErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** Códigos de error de PostgreSQL usados en los tests. */
export const PG = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;

// -----------------------------------------------------------------------------
// Constructores de datos de prueba
// -----------------------------------------------------------------------------

export async function createTrainer(client: Client, chatId = 111_000): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO trainers (full_name, telegram_chat_id)
     VALUES ('Entrenador de prueba', $1) RETURNING id`,
    [chatId],
  );
  return rows[0]!.id;
}

export async function createClient(
  client: Client,
  trainerId: string,
  name = 'Carlos Pérez',
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, email, link_token)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [trainerId, name, `${name.split(' ')[0]!.toLowerCase()}@example.com`, randomToken()],
  );
  return rows[0]!.id;
}

export async function createAssessment(client: Client, clientId: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
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
  client: Client,
  clientId: string,
  assessmentId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO workout_plans (client_id, assessment_id) VALUES ($1, $2) RETURNING id`,
    [clientId, assessmentId],
  );
  return rows[0]!.id;
}

function randomToken(): string {
  return Array.from({ length: 32 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
  ).join('');
}
