/**
 * SPEC-030 regla 13 — el aviso de enlace sin abrir a las 48 horas.
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

async function nuevoCliente(trainerId: string, nombre: string, vinculado = false): Promise<string> {
  tokenSeq += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, $2, $3) RETURNING id`,
    [trainerId, nombre, `token_recordatorio_${String(tokenSeq).padStart(9, '0')}`],
  );
  const clientId = rows[0]!.id;

  if (vinculado) {
    const profileId = await createProfile(db, 'client', nombre);
    await db.query(`UPDATE clients SET profile_id = $1, linked_at = now() WHERE id = $2`, [
      profileId,
      clientId,
    ]);
  }

  return clientId;
}

/** Una versión APPROVED, "aprobada" hace `horasAtras` horas. */
async function aprobadaHace(trainerId: string, clientId: string, horasAtras: number): Promise<string> {
  const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
  const versionId = await createVersion(db, planId, 'ai', trainerId, {
    summary: 'Fuerza',
    days: [],
    warnings: [],
  });
  await transition(db, versionId, 'DRAFT', 'APPROVED');

  // `updated_at` lo mantiene un trigger (igual que en sweep-generating.test.ts).
  await db.query(`ALTER TABLE workout_versions DISABLE TRIGGER workout_versions_set_updated_at`);
  await db.query(
    `UPDATE workout_versions SET updated_at = now() - interval '${horasAtras} hours' WHERE id = $1`,
    [versionId],
  );
  await db.query(`ALTER TABLE workout_versions ENABLE TRIGGER workout_versions_set_updated_at`);

  return versionId;
}

const candidatas = async (minHoras: number) =>
  (await db.query(`SELECT * FROM versions_awaiting_link_reminder($1)`, [minHoras])).rows;

// ---------------------------------------------------------------------------

describe('versions_awaiting_link_reminder', () => {
  it('CA-13 · trae una APPROVED sin vincular, aprobada hace más del umbral', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Ana');
    const v = await aprobadaHace(t, c, 50);

    const rows = await candidatas(48);

    expect(rows).toHaveLength(1);
    expect(rows[0].version_id).toBe(v);
    expect(rows[0].client_name).toBe('Ana');
    expect(rows[0].trainer_chat_id).not.toBeNull();
  });

  it('no trae una que todavía está dentro de las 48 horas', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Luis');
    await aprobadaHace(t, c, 10);

    expect(await candidatas(48)).toHaveLength(0);
  });

  it('no trae una ya vinculada, aunque esté APPROVED y sea vieja', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Marta', true);
    await aprobadaHace(t, c, 72);

    expect(await candidatas(48)).toHaveLength(0);
  });

  it('no trae un DRAFT ni una SENT, solo APPROVED', async () => {
    const t = await createProfile(db, 'trainer');

    const cDraft = await nuevoCliente(t, 'Borrador');
    const planDraft = await createPlan(db, cDraft, await createAssessment(db, cDraft));
    const vDraft = await createVersion(db, planDraft, 'ai', t, { summary: 'x', days: [], warnings: [] });
    await db.query(`ALTER TABLE workout_versions DISABLE TRIGGER workout_versions_set_updated_at`);
    await db.query(`UPDATE workout_versions SET updated_at = now() - interval '72 hours' WHERE id = $1`, [
      vDraft,
    ]);
    await db.query(`ALTER TABLE workout_versions ENABLE TRIGGER workout_versions_set_updated_at`);

    const cSent = await nuevoCliente(t, 'Enviada');
    const vSent = await aprobadaHace(t, cSent, 72);
    await transition(db, vSent, 'APPROVED', 'SENT', 'system');

    expect(await candidatas(48)).toHaveLength(0);
  });

  it('una versión ya avisada no vuelve a salir', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos');
    const v = await aprobadaHace(t, c, 72);

    await db.query(`SELECT mark_link_reminded($1)`, [v]);

    expect(await candidatas(48)).toHaveLength(0);
  });

  it('trae las de TODOS los entrenadores: no filtra por trainer_id, a propósito', async () => {
    // Igual que stale_generating_versions: la usa un cron que barre todo el
    // sistema, no un entrenador puntual.
    const a = await createProfile(db, 'trainer', 'A');
    const b = await createProfile(db, 'trainer', 'B');
    await aprobadaHace(a, await nuevoCliente(a, 'Cliente de A'), 72);
    await aprobadaHace(b, await nuevoCliente(b, 'Cliente de B'), 72);

    const rows = await candidatas(48);

    expect(rows.map((r) => r.client_name).toSorted()).toEqual(['Cliente de A', 'Cliente de B']);
  });
});

describe('mark_link_reminded', () => {
  it('un solo aviso: la segunda llamada no pisa la fecha de la primera', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Ana');
    const v = await aprobadaHace(t, c, 72);

    await db.query(`SELECT mark_link_reminded($1)`, [v]);
    const { rows: primera } = await db.query(
      `SELECT link_reminder_sent_at FROM workout_versions WHERE id = $1`,
      [v],
    );

    await db.query(`SELECT mark_link_reminded($1)`, [v]);
    const { rows: segunda } = await db.query(
      `SELECT link_reminder_sent_at FROM workout_versions WHERE id = $1`,
      [v],
    );

    expect(primera[0].link_reminder_sent_at).not.toBeNull();
    expect(segunda[0].link_reminder_sent_at).toEqual(primera[0].link_reminder_sent_at);
  });
});
