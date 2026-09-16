/**
 * SPEC-001 S-14 — `ingest_assessment` contra PostgreSQL.
 *
 * Un envío del formulario produce cuatro filas en tres tablas. Lo que estos
 * tests protegen no es que se creen, sino que se creen **todas o ninguna**:
 * un cliente sin plan no falla en ningún sitio, simplemente no tiene rutina,
 * y nadie se entera hasta que el entrenador la abre.
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connect,
  createProfile,
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

interface Ids {
  client_id: string;
  assessment_id: string;
  plan_id: string;
  version_id: string;
}

async function ingest(trainerId: string, overrides: Record<string, unknown> = {}): Promise<Ids> {
  const valores = {
    nombre: 'Carlos Pérez',
    token: 'token_de_32_caracteres_exactos_a',
    goal: 'Fuerza',
    level: 'beginner',
    dias: 4,
    minutos: 60,
    equipamiento: 'Mancuernas',
    limitaciones: false,
    detalle: null,
    ...overrides,
  };

  const { rows } = await db.query<Ids>(
    `SELECT * FROM ingest_assessment(
       $1, $2, $3, '{"origen":"test"}'::jsonb, $4, $5, $6, $7, $8, $9, $10
     )`,
    [
      trainerId,
      valores.nombre,
      valores.token,
      valores.goal,
      valores.level,
      valores.dias,
      valores.minutos,
      valores.equipamiento,
      valores.limitaciones,
      valores.detalle,
    ],
  );

  return rows[0]!;
}

async function contar(tabla: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(`SELECT count(*) FROM ${tabla}`);
  return Number(rows[0]!.count);
}

// ---------------------------------------------------------------------------

describe('ingest_assessment', () => {
  it('crea cliente, evaluación, plan y primera versión', async () => {
    const trainerId = await createProfile(db, 'trainer');

    const ids = await ingest(trainerId);

    expect(ids.client_id).toBeTruthy();
    expect(ids.assessment_id).toBeTruthy();
    expect(ids.plan_id).toBeTruthy();
    expect(ids.version_id).toBeTruthy();

    expect(await contar('clients')).toBe(1);
    expect(await contar('assessments')).toBe(1);
    expect(await contar('workout_plans')).toBe(1);
    expect(await contar('workout_versions')).toBe(1);
  });

  it('la primera versión nace en NEW, sin contenido y con source=ai', async () => {
    // SPEC-001 regla 7. `NEW` y no `DRAFT` porque la IA todavía no corrió, y
    // puede no correr nunca: desde NEW se puede cargar una plantilla.
    const trainerId = await createProfile(db, 'trainer');
    const ids = await ingest(trainerId);

    const { rows } = await db.query<{ state: string; source: string; content: unknown }>(
      `SELECT state, source, content FROM workout_versions WHERE id = $1`,
      [ids.version_id],
    );

    expect(rows[0]).toMatchObject({ state: 'NEW', source: 'ai', content: null });
  });

  it('registra exactamente un evento NULL → NEW', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const ids = await ingest(trainerId);

    const { rows } = await db.query<{ from_state: string | null; to_state: string }>(
      `SELECT from_state, to_state FROM plan_events WHERE plan_id = $1`,
      [ids.plan_id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_state: null, to_state: 'NEW' });
  });

  it('el plan queda apuntando a su versión vigente', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const ids = await ingest(trainerId);

    const { rows } = await db.query<{ current_version_id: string; assessment_id: string }>(
      `SELECT current_version_id, assessment_id FROM workout_plans WHERE id = $1`,
      [ids.plan_id],
    );

    expect(rows[0]!.current_version_id).toBe(ids.version_id);
    expect(rows[0]!.assessment_id).toBe(ids.assessment_id);
  });

  it('dos envíos con el mismo nombre crean dos clientes distintos', async () => {
    // SPEC-001 regla 4: el formulario es onboarding. Fusionarlos metería la
    // lesión de un «Carlos» en la rutina del otro, y en silencio.
    const trainerId = await createProfile(db, 'trainer');

    const a = await ingest(trainerId, { token: 'token_de_32_caracteres_exactos_a' });
    const b = await ingest(trainerId, { token: 'token_de_32_caracteres_exactos_b' });

    expect(a.client_id).not.toBe(b.client_id);
    expect(await contar('clients')).toBe(2);
  });

  it.each([
    ['un nivel inválido', { level: 'experto' }, PG.CHECK_VIOLATION],
    ['9 días por semana', { dias: 9 }, PG.CHECK_VIOLATION],
    ['200 minutos por sesión', { minutos: 200 }, PG.CHECK_VIOLATION],
    ['un detalle sin limitaciones declaradas', { detalle: 'rodilla' }, PG.CHECK_VIOLATION],
    ['un link_token demasiado corto', { token: 'corto' }, PG.CHECK_VIOLATION],
  ])('%s revierte TODO', async (_nombre, overrides, codigo) => {
    // Es el punto de que esto sea una función SQL: sin ella, los INSERT irían
    // uno a uno desde TypeScript y el cliente ya estaría creado cuando falla
    // la evaluación.
    const trainerId = await createProfile(db, 'trainer');

    let code: string | undefined;
    try {
      await ingest(trainerId, overrides);
    } catch (error) {
      code = pgErrorCode(error);
    }

    expect(code).toBe(codigo);
    expect(await contar('clients')).toBe(0);
    expect(await contar('assessments')).toBe(0);
    expect(await contar('workout_plans')).toBe(0);
    expect(await contar('workout_versions')).toBe(0);
  });

  it('un entrenador que no existe lo rechaza la FK', async () => {
    let code: string | undefined;
    try {
      await ingest('00000000-0000-0000-0000-000000000000');
    } catch (error) {
      code = pgErrorCode(error);
    }

    expect(code).toBe(PG.FOREIGN_KEY_VIOLATION);
    expect(await contar('clients')).toBe(0);
  });

  it('un perfil de cliente no puede pasar como entrenador', async () => {
    // La FK compuesta contra profiles (id, role) lo hace imposible, no solo
    // improbable (CA-10 de SPEC-000).
    const clientProfile = await createProfile(db, 'client');

    let code: string | undefined;
    try {
      await ingest(clientProfile);
    } catch (error) {
      code = pgErrorCode(error);
    }

    expect(code).toBe(PG.FOREIGN_KEY_VIOLATION);
    expect(await contar('clients')).toBe(0);
  });

  it('anon no puede invocarla', async () => {
    const trainerId = await createProfile(db, 'trainer');
    await db.query('SET ROLE anon');

    let code: string | undefined;
    try {
      await ingest(trainerId);
    } catch (error) {
      code = pgErrorCode(error);
    } finally {
      await db.query('RESET ROLE');
    }

    expect(code).toBe(PG.INSUFFICIENT_PRIVILEGE);
  });
});
