/**
 * SPEC-006 — El check-in semanal contra PostgreSQL.
 *
 * ┌─ CA-2 ES LA RAZÓN DE ESTE ARCHIVO ─────────────────────────────────────┐
 * │ «Correr el cron dos veces no duplica» no lo garantiza el código que    │
 * │ decide a quién preguntar: lo garantiza el                              │
 * │ `UNIQUE (client_id, version_id, week_number)`. Eso solo se puede       │
 * │ comprobar con una base de datos de verdad delante.                     │
 * └────────────────────────────────────────────────────────────────────────┘
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

interface Escenario {
  trainerId: string;
  clientId: string;
  versionId: string;
  profileId: string | null;
}

/** Un cliente con rutina entregada, vinculado salvo que se diga lo contrario. */
async function escenario(opciones: { vinculado?: boolean; conEvaluacion?: boolean } = {}) {
  const trainerId = await createProfile(db, 'trainer');

  const { rows: clientRows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, 'Carlos Pérez', $2) RETURNING id`,
    [trainerId, `token_${Math.random().toString(36).slice(2)}_relleno_x`],
  );
  const clientId = clientRows[0]!.id;

  let profileId: string | null = null;
  if (opciones.vinculado !== false) {
    profileId = await createProfile(db, 'client', 'Carlos Pérez');
    await db.query(`UPDATE clients SET profile_id = $1, linked_at = now() WHERE id = $2`, [
      profileId,
      clientId,
    ]);
  }

  const assessmentId =
    opciones.conEvaluacion === false ? null : await createAssessment(db, clientId);
  const planId = await createPlan(db, clientId, assessmentId);
  const versionId = await createVersion(db, planId, 'ai', trainerId, {
    summary: 'Fuerza',
    days: [],
    warnings: [],
  });

  await transition(db, versionId, 'DRAFT', 'APPROVED');
  await transition(db, versionId, 'APPROVED', 'SENT', 'system');

  return { trainerId, clientId, versionId, profileId } satisfies Escenario;
}

/** Retrasa la entrega para simular que pasaron semanas. */
async function entregadaHace(versionId: string, dias: number) {
  await db.query(`UPDATE workout_versions SET sent_at = now() - ($2 || ' days')::interval
                   WHERE id = $1`, [versionId, String(dias)]);
}

async function crearCheckin(clientId: string, versionId: string, semana: number): Promise<string> {
  const { rows } = await db.query<{ create_checkin: string }>(
    `SELECT create_checkin($1, $2, $3::smallint)`,
    [clientId, versionId, semana],
  );
  return rows[0]!.create_checkin;
}

// ---------------------------------------------------------------------------

describe('checkin_candidates', () => {
  it('trae al cliente con rutina entregada', async () => {
    const { clientId, versionId } = await escenario();
    await entregadaHace(versionId, 8);

    const { rows } = await db.query(`SELECT * FROM checkin_candidates()`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      client_id: clientId,
      client_name: 'Carlos Pérez',
      state: 'SENT',
      last_week_sent: 0,
    });
  });

  it('CA-6 · una rutina que NO se entregó no es candidata', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { rows: c } = await db.query<{ id: string }>(
      `INSERT INTO clients (trainer_id, full_name, link_token)
       VALUES ($1, 'Carlos', 'token_de_32_caracteres_exactos_a') RETURNING id`,
      [trainerId],
    );
    const planId = await createPlan(db, c[0]!.id, await createAssessment(db, c[0]!.id));
    await createVersion(db, planId, 'ai', trainerId, { summary: 'x', days: [], warnings: [] });

    const { rows } = await db.query(`SELECT * FROM checkin_candidates()`);

    expect(rows).toHaveLength(0);
  });

  it('un cliente sin vincular sale con chat NULL, no desaparece', async () => {
    // Que no haya dónde preguntarle lo decide el dominio, no el join.
    const { versionId } = await escenario({ vinculado: false });
    await entregadaHace(versionId, 8);

    const { rows } = await db.query(`SELECT * FROM checkin_candidates()`);

    expect(rows).toHaveLength(1);
    expect(rows[0].client_chat_id).toBeNull();
  });

  it('`last_week_sent` cuenta solo los que SALIERON', async () => {
    // Un envío que falló deja la fila sin `sent_at`, y esa semana se reintenta.
    const { clientId, versionId } = await escenario();
    await entregadaHace(versionId, 8);
    await crearCheckin(clientId, versionId, 1);

    const { rows: sinEnviar } = await db.query(`SELECT * FROM checkin_candidates()`);
    expect(sinEnviar[0].last_week_sent).toBe(0);

    await db.query(`UPDATE checkins SET sent_at = now() WHERE client_id = $1`, [clientId]);

    const { rows: enviado } = await db.query(`SELECT * FROM checkin_candidates()`);
    expect(enviado[0].last_week_sent).toBe(1);
  });

  it('una sola fila por cliente aunque tenga varias versiones', async () => {
    // Se mira la versión VIGENTE. Si no, tres entregas serían tres check-ins.
    const { clientId, versionId } = await escenario();
    await entregadaHace(versionId, 20);

    const { rows: plan } = await db.query<{ id: string }>(
      `SELECT id FROM workout_plans WHERE client_id = $1`,
      [clientId],
    );
    const trainerId = (await db.query<{ trainer_id: string }>(
      `SELECT trainer_id FROM clients WHERE id = $1`,
      [clientId],
    )).rows[0]!.trainer_id;

    const segunda = await createVersion(db, plan[0]!.id, 'ai', trainerId, {
      summary: 'v2',
      days: [],
      warnings: [],
    });
    await transition(db, segunda, 'DRAFT', 'APPROVED');
    await transition(db, segunda, 'APPROVED', 'SENT', 'system');

    const { rows } = await db.query(`SELECT * FROM checkin_candidates()`);

    expect(rows).toHaveLength(1);
    expect(rows[0].version_id).toBe(segunda);
  });
});

describe('create_checkin', () => {
  it('CA-1 · crea el de la semana en PENDING', async () => {
    const { clientId, versionId } = await escenario();

    const checkinId = await crearCheckin(clientId, versionId, 1);

    const { rows } = await db.query(`SELECT state, week_number FROM checkins WHERE id = $1`, [
      checkinId,
    ]);
    expect(rows[0]).toEqual({ state: 'PENDING', week_number: 1 });
  });

  it('CA-2 · llamarla dos veces NO duplica', async () => {
    // La garantía es el UNIQUE, no una comprobación previa: dos ejecuciones
    // simultáneas la pasarían las dos.
    const { clientId, versionId } = await escenario();

    const primero = await crearCheckin(clientId, versionId, 1);
    const segundo = await crearCheckin(clientId, versionId, 1);

    expect(segundo).toBe(primero);
    const { rows } = await db.query(`SELECT count(*) FROM checkins`);
    expect(rows[0].count).toBe('1');
  });

  it('regla 8 · un check-in sin responder no bloquea el siguiente', async () => {
    const { clientId, versionId } = await escenario();

    const semana1 = await crearCheckin(clientId, versionId, 1);
    const semana2 = await crearCheckin(clientId, versionId, 2);

    expect(semana2).not.toBe(semana1);
    const { rows } = await db.query(`SELECT count(*) FROM checkins`);
    expect(rows[0].count).toBe('2');
  });
});

describe('checkin_for_reply', () => {
  it('trae el DUEÑO, que es lo único que autoriza la respuesta', async () => {
    // CA-7.
    const { clientId, versionId, profileId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);

    const { rows } = await db.query(`SELECT * FROM checkin_for_reply($1)`, [checkinId]);

    expect(rows[0]).toMatchObject({
      checkin_id: checkinId,
      client_profile_id: profileId,
      client_name: 'Carlos Pérez',
      state: 'PENDING',
      days_per_week: 4,
    });
  });

  it('una rutina sin evaluación no tiene total de días', async () => {
    const { clientId, versionId } = await escenario({ conEvaluacion: false });
    const checkinId = await crearCheckin(clientId, versionId, 1);

    const { rows } = await db.query(`SELECT * FROM checkin_for_reply($1)`, [checkinId]);

    expect(rows[0].days_per_week).toBeNull();
    expect(rows[0].client_name).toBe('Carlos Pérez');
  });

  it('un id inventado no devuelve nada', async () => {
    const { rows } = await db.query(`SELECT * FROM checkin_for_reply($1)`, [
      '00000000-0000-0000-0000-000000000000',
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('open_checkin_for_profile', () => {
  it('encuentra el que espera una molestia por escrito', async () => {
    const { clientId, versionId, profileId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);
    await db.query(`SELECT mark_checkin_sent($1)`, [checkinId]);

    const { rows } = await db.query(`SELECT * FROM open_checkin_for_profile($1)`, [profileId]);

    expect(rows[0].checkin_id).toBe(checkinId);
  });

  it('uno que aún no salió no cuenta', async () => {
    // Si no, un texto del cliente se atribuiría a un check-in que no ha visto.
    const { clientId, versionId, profileId } = await escenario();
    await crearCheckin(clientId, versionId, 1);

    const { rows } = await db.query(`SELECT * FROM open_checkin_for_profile($1)`, [profileId]);

    expect(rows).toHaveLength(0);
  });

  it('uno ya cerrado tampoco', async () => {
    const { clientId, versionId, profileId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);
    await db.query(`SELECT mark_checkin_sent($1)`, [checkinId]);
    await db.query(`SELECT save_checkin_answers($1, $2::jsonb, true)`, [
      checkinId,
      JSON.stringify({ sessions: 3, feeling: 'good', discomfort: '' }),
    ]);

    const { rows } = await db.query(`SELECT * FROM open_checkin_for_profile($1)`, [profileId]);

    expect(rows).toHaveLength(0);
  });
});

describe('save_checkin_answers', () => {
  it('CA-3 · con las tres respuestas pasa a COMPLETED', async () => {
    const { clientId, versionId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);

    await db.query(`SELECT save_checkin_answers($1, $2::jsonb, true)`, [
      checkinId,
      JSON.stringify({ sessions: 3, feeling: 'good', discomfort: 'hombro' }),
    ]);

    const { rows } = await db.query(
      `SELECT state, completed_at, answers FROM checkins WHERE id = $1`,
      [checkinId],
    );
    expect(rows[0].state).toBe('COMPLETED');
    expect(rows[0].completed_at).not.toBeNull();
    expect(rows[0].answers).toMatchObject({ sessions: 3, discomfort: 'hombro' });
  });

  it('una respuesta parcial guarda y sigue PENDING', async () => {
    const { clientId, versionId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);

    await db.query(`SELECT save_checkin_answers($1, $2::jsonb, false)`, [
      checkinId,
      JSON.stringify({ sessions: 2, feeling: null, discomfort: null }),
    ]);

    const { rows } = await db.query(
      `SELECT state, completed_at, answers FROM checkins WHERE id = $1`,
      [checkinId],
    );
    expect(rows[0].state).toBe('PENDING');
    expect(rows[0].completed_at).toBeNull();
    expect(rows[0].answers).toMatchObject({ sessions: 2 });
  });
});

describe('checkins_to_remind y las marcas', () => {
  it('trae los enviados sin responder', async () => {
    const { clientId, versionId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);
    await db.query(`SELECT mark_checkin_sent($1)`, [checkinId]);

    const { rows } = await db.query(`SELECT * FROM checkins_to_remind()`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ checkin_id: checkinId, reminder_sent_at: null });
  });

  it('CA-5 · uno ya recordado desaparece de la lista', async () => {
    const { clientId, versionId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);
    await db.query(`SELECT mark_checkin_sent($1)`, [checkinId]);
    await db.query(`SELECT mark_checkin_reminded($1)`, [checkinId]);

    const { rows } = await db.query(`SELECT * FROM checkins_to_remind()`);

    expect(rows).toHaveLength(0);
  });

  it('marcar dos veces NO reescribe la fecha', async () => {
    const { clientId, versionId } = await escenario();
    const checkinId = await crearCheckin(clientId, versionId, 1);

    await db.query(`SELECT mark_checkin_sent($1)`, [checkinId]);
    const { rows: antes } = await db.query(`SELECT sent_at FROM checkins WHERE id = $1`, [
      checkinId,
    ]);
    await db.query(`SELECT mark_checkin_sent($1)`, [checkinId]);
    const { rows: despues } = await db.query(`SELECT sent_at FROM checkins WHERE id = $1`, [
      checkinId,
    ]);

    expect(despues[0].sent_at).toEqual(antes[0].sent_at);
  });
});
