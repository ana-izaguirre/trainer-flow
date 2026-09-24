/**
 * SPEC-002 §11 — la consulta que encuentra generaciones atascadas.
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connect,
  createAssessment,
  createPlan,
  createProfile,
  createVersion,
  resetTestDatabase,
  transition,
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

let tokenSeq = 0;

async function nuevoCliente(trainerId: string, nombre = 'Cliente'): Promise<string> {
  tokenSeq += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, $2, $3) RETURNING id`,
    [trainerId, nombre, `token_atascada_${String(tokenSeq).padStart(10, '0')}`],
  );
  return rows[0]!.id;
}

/** Una versión en GENERATING desde hace `minutosAtras` minutos. */
async function generacionAtascada(
  trainerId: string,
  clientId: string,
  minutosAtras: number,
): Promise<string> {
  const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
  const versionId = await createVersion(db, planId, 'ai', trainerId, null);
  await transition(db, versionId, 'NEW', 'GENERATING');

  // `updated_at` lo mantiene un trigger (igual que en trainer-queries.test.ts):
  // hay que apagarlo un momento para simular el paso del tiempo.
  await db.query(`ALTER TABLE workout_versions DISABLE TRIGGER workout_versions_set_updated_at`);
  await db.query(
    `UPDATE workout_versions SET updated_at = now() - interval '${minutosAtras} minutes' WHERE id = $1`,
    [versionId],
  );
  await db.query(`ALTER TABLE workout_versions ENABLE TRIGGER workout_versions_set_updated_at`);

  return versionId;
}

const stale = async (minMinutes: number) =>
  (await db.query(`SELECT * FROM stale_generating_versions($1)`, [minMinutes])).rows;

// ---------------------------------------------------------------------------

describe('stale_generating_versions', () => {
  it('CA-10 · trae una GENERATING de hace más del umbral', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Ana');
    const v = await generacionAtascada(t, c, 12);

    const rows = await stale(5);

    expect(rows).toHaveLength(1);
    expect(rows[0].version_id).toBe(v);
    expect(rows[0].client_name).toBe('Ana');
    expect(rows[0].minutes_stuck).toBeGreaterThanOrEqual(12);
  });

  it('no trae una que todavía está dentro del margen', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Luis');
    await generacionAtascada(t, c, 2);

    expect(await stale(5)).toHaveLength(0);
  });

  it('no trae una versión en DRAFT, aunque sea vieja', async () => {
    // El filtro es por estado, no solo por antigüedad: una GENERATING
    // atascada es un bug, un DRAFT viejo es solo un entrenador ocupado.
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Marta');
    const planId = await createPlan(db, c, await createAssessment(db, c));
    const versionId = await createVersion(db, planId, 'manual', t, {
      summary: 'x',
      days: [],
      warnings: [],
    });

    await db.query(`ALTER TABLE workout_versions DISABLE TRIGGER workout_versions_set_updated_at`);
    await db.query(
      `UPDATE workout_versions SET updated_at = now() - interval '1 day' WHERE id = $1`,
      [versionId],
    );
    await db.query(`ALTER TABLE workout_versions ENABLE TRIGGER workout_versions_set_updated_at`);

    expect(await stale(5)).toHaveLength(0);
  });

  it('resuelve el chat_id del entrenador igual que las demás consultas', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos');
    await generacionAtascada(t, c, 30);

    const rows = await stale(5);

    expect(rows[0]!.trainer_chat_id).not.toBeNull();
  });

  it('trae las atascadas de TODOS los entrenadores: no filtra por trainer_id, a propósito', async () => {
    // A diferencia de las consultas de SPEC-007, esta la usa un cron que
    // corre para todo el sistema: no recibe trainer_id porque tiene que
    // barrer a todos, no a uno.
    const a = await createProfile(db, 'trainer');
    const b = await createProfile(db, 'trainer');
    await generacionAtascada(a, await nuevoCliente(a, 'Cliente de A'), 10);
    await generacionAtascada(b, await nuevoCliente(b, 'Cliente de B'), 10);

    const rows = await stale(5);

    expect(rows.map((r) => r.client_name).toSorted()).toEqual(['Cliente de A', 'Cliente de B']);
  });
});
