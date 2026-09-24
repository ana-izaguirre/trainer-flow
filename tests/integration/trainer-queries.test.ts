/**
 * SPEC-007 — Las consultas del entrenador contra PostgreSQL.
 *
 * ┌─ LO QUE MÁS IMPORTA ───────────────────────────────────────────────────┐
 * │ Que el filtro por `trainer_id` esté en el WHERE. Un entrenador no      │
 * │ puede ver a los clientes de otro ni por un error del código de arriba, │
 * │ porque la consulta nunca se los trae (§7, CA-4 de SPEC-009).           │
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

let tokenSeq = 0;

async function nuevoCliente(trainerId: string, nombre: string, vinculado = true): Promise<string> {
  tokenSeq += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, $2, $3) RETURNING id`,
    [trainerId, nombre, `token_de_prueba_numero_${String(tokenSeq).padStart(10, '0')}`],
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

/** Un cliente con plan y versión en el estado que se pida. */
async function conRutina(
  trainerId: string,
  clientId: string,
  estado: 'DRAFT' | 'SENT' = 'SENT',
): Promise<string> {
  const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
  const versionId = await createVersion(db, planId, 'ai', trainerId, {
    summary: 'Fuerza',
    days: [],
    warnings: [],
  });

  if (estado === 'SENT') {
    await transition(db, versionId, 'DRAFT', 'APPROVED');
    await transition(db, versionId, 'APPROVED', 'SENT', 'system');
  }

  return versionId;
}

const clientes = async (trainerId: string) =>
  (await db.query(`SELECT * FROM trainer_clients($1)`, [trainerId])).rows;

// ---------------------------------------------------------------------------

describe('🔴 el aislamiento entre entrenadores', () => {
  it('un entrenador NO ve a los clientes de otro', async () => {
    // SPEC-009 CA-3. El filtro está en el WHERE, no en el código de arriba.
    const a = await createProfile(db, 'trainer', 'Entrenadora A');
    const b = await createProfile(db, 'trainer', 'Entrenador B');
    await nuevoCliente(a, 'Cliente de A');
    await nuevoCliente(b, 'Cliente de B');

    const deA = await clientes(a);

    expect(deA).toHaveLength(1);
    expect(deA[0].full_name).toBe('Cliente de A');
  });

  it('tampoco sus rutinas pendientes', async () => {
    const a = await createProfile(db, 'trainer', 'A');
    const b = await createProfile(db, 'trainer', 'B');
    await conRutina(b, await nuevoCliente(b, 'Cliente de B'), 'DRAFT');

    const { rows } = await db.query(`SELECT * FROM trainer_pending_versions($1)`, [a]);

    expect(rows).toHaveLength(0);
  });

  it('ni sus check-ins colgados', async () => {
    const a = await createProfile(db, 'trainer', 'A');
    const b = await createProfile(db, 'trainer', 'B');
    const cliente = await nuevoCliente(b, 'Cliente de B');
    const versionId = await conRutina(b, cliente);
    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number, state, sent_at)
       VALUES ($1, $2, 1, 'PENDING', now() - interval '5 days')`,
      [cliente, versionId],
    );

    const { rows } = await db.query(`SELECT * FROM trainer_stale_checkins($1, 2)`, [a]);

    expect(rows).toHaveLength(0);
  });
});

describe('trainer_clients', () => {
  it('CA-1 · trae a los suyos ordenados por nombre', async () => {
    const t = await createProfile(db, 'trainer');
    await nuevoCliente(t, 'Zoe');
    await nuevoCliente(t, 'Ana');

    const filas = await clientes(t);

    expect(filas.map((f) => f.full_name)).toEqual(['Ana', 'Zoe']);
  });

  it('un cliente sin rutina sale con estado NULL, no desaparece', async () => {
    const t = await createProfile(db, 'trainer');
    await nuevoCliente(t, 'Recién llegada');

    const filas = await clientes(t);

    expect(filas).toHaveLength(1);
    expect(filas[0].version_state).toBeNull();
  });

  it('dice si está vinculado', async () => {
    const t = await createProfile(db, 'trainer');
    await nuevoCliente(t, 'Sin vincular', false);

    expect((await clientes(t))[0].linked).toBe(false);
  });

  it('mira la versión VIGENTE, no la última creada', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos');
    await conRutina(t, c, 'SENT');

    const filas = await clientes(t);

    expect(filas).toHaveLength(1);
    expect(filas[0].version_state).toBe('SENT');
  });

  it('cuenta los días del check-in colgado más antiguo', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Luis');
    const v = await conRutina(t, c);

    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number, state, sent_at) VALUES
         ($1, $2, 1, 'PENDING', now() - interval '5 days'),
         ($1, $2, 2, 'PENDING', now() - interval '1 day')`,
      [c, v],
    );

    expect((await clientes(t))[0].pending_checkin_days).toBe(5);
  });

  it('sin check-ins colgados devuelve NULL, no cero', async () => {
    // «No debe nada» y «lleva cero días» no son lo mismo.
    const t = await createProfile(db, 'trainer');
    await nuevoCliente(t, 'Al día');

    expect((await clientes(t))[0].pending_checkin_days).toBeNull();
  });
});

describe('trainer_client_detail', () => {
  it('CA-2 · trae la ficha con su evaluación', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos Pérez');
    const v = await conRutina(t, c);

    const { rows } = await db.query(`SELECT * FROM trainer_client_detail($1)`, [c]);

    expect(rows[0]).toMatchObject({
      full_name: 'Carlos Pérez',
      goal: 'Ganancia muscular',
      level: 'intermediate',
      days_per_week: 4,
      has_limitations: true,
      version_id: v,
    });
  });

  it('🔴 NO devuelve el detalle de la limitación', async () => {
    // Solo el booleano: el texto crudo vive en la rutina, que es donde el
    // entrenador lo necesita al revisarla.
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos');
    await conRutina(t, c);

    const { rows, fields } = await db.query(`SELECT * FROM trainer_client_detail($1)`, [c]);

    expect(fields.map((f) => f.name)).not.toContain('limitations_detail');
    expect(JSON.stringify(rows[0])).not.toContain('hombro');
  });

  it('cuenta los días desde el envío', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos');
    const v = await conRutina(t, c);
    await db.query(`UPDATE workout_versions SET sent_at = now() - interval '12 days' WHERE id=$1`, [v]);

    const { rows } = await db.query(`SELECT * FROM trainer_client_detail($1)`, [c]);

    expect(rows[0].sent_days_ago).toBe(12);
  });

  it('trae el último check-in CONTESTADO, no el último a secas', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos');
    const v = await conRutina(t, c);

    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number, state, sent_at, answers, completed_at) VALUES
         ($1, $2, 1, 'COMPLETED', now() - interval '9 days', $3::jsonb, now()),
         ($1, $2, 2, 'PENDING',   now() - interval '2 days', NULL, NULL)`,
      [c, v, JSON.stringify({ sessions: 3, feeling: 'good', discomfort: '' })],
    );

    const { rows } = await db.query(`SELECT * FROM trainer_client_detail($1)`, [c]);

    expect(rows[0].last_week_number).toBe(1);
    expect(rows[0].last_answers).toMatchObject({ sessions: 3 });
  });

  it('sin evaluación no inventa objetivo', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Manual');
    const planId = await createPlan(db, c, null);
    await createVersion(db, planId, 'manual', t, { summary: 'x', days: [], warnings: [] });

    const { rows } = await db.query(`SELECT * FROM trainer_client_detail($1)`, [c]);

    expect(rows[0].goal).toBeNull();
    expect(rows[0].has_limitations).toBe(false);
  });

  it('un id que no existe no devuelve nada', async () => {
    const { rows } = await db.query(`SELECT * FROM trainer_client_detail($1)`, [
      '00000000-0000-0000-0000-000000000000',
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('trainer_pending_versions', () => {
  it('el trigger impide retrodatar `updated_at`, y eso es lo correcto', async () => {
    // Si un UPDATE pudiera falsear la fecha, «esperando desde hace 8 días»
    // dejaría de significar nada.
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Carlos');
    const v = await conRutina(t, c, 'DRAFT');

    await db.query(`UPDATE workout_versions SET updated_at = now() - interval '9 days' WHERE id=$1`, [v]);

    const { rows } = await db.query(`SELECT * FROM trainer_pending_versions($1)`, [t]);
    expect(rows[0].days_waiting).toBe(0);
  });

  it('CA-5 · solo las que están en DRAFT', async () => {
    const t = await createProfile(db, 'trainer');
    const enviada = await nuevoCliente(t, 'Enviada');
    const borrador = await nuevoCliente(t, 'Borrador');
    await conRutina(t, enviada, 'SENT');
    await conRutina(t, borrador, 'DRAFT');

    const { rows } = await db.query(`SELECT * FROM trainer_pending_versions($1)`, [t]);

    expect(rows).toHaveLength(1);
    expect(rows[0].client_name).toBe('Borrador');
  });

  it('la que lleva más esperando va primero', async () => {
    const t = await createProfile(db, 'trainer');
    const c1 = await nuevoCliente(t, 'Reciente');
    const c2 = await nuevoCliente(t, 'Antigua');
    const v1 = await conRutina(t, c1, 'DRAFT');
    const v2 = await conRutina(t, c2, 'DRAFT');

    // `updated_at` lo mantiene un trigger, así que un UPDATE normal no puede
    // retrodatarlo — que es justo lo que se quiere en producción. Para
    // simular el paso del tiempo hay que apagarlo un momento.
    await db.query(`ALTER TABLE workout_versions DISABLE TRIGGER workout_versions_set_updated_at`);
    await db.query(`UPDATE workout_versions SET updated_at = now() - interval '1 day' WHERE id=$1`, [v1]);
    await db.query(`UPDATE workout_versions SET updated_at = now() - interval '8 days' WHERE id=$1`, [v2]);
    await db.query(`ALTER TABLE workout_versions ENABLE TRIGGER workout_versions_set_updated_at`);

    const { rows } = await db.query(`SELECT * FROM trainer_pending_versions($1)`, [t]);

    expect(rows.map((r) => r.client_name)).toEqual(['Antigua', 'Reciente']);
    expect(rows[0].days_waiting).toBe(8);
  });
});

describe('trainer_stale_checkins', () => {
  it('CA-7 · uno de 3 días aparece; uno de ayer, no', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Luis');
    const v = await conRutina(t, c);

    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number, state, sent_at) VALUES
         ($1, $2, 1, 'PENDING', now() - interval '3 days'),
         ($1, $2, 2, 'PENDING', now() - interval '1 day')`,
      [c, v],
    );

    const { rows } = await db.query(`SELECT * FROM trainer_stale_checkins($1, 2)`, [t]);

    expect(rows).toHaveLength(1);
    expect(rows[0].week_number).toBe(1);
  });

  it('uno ya contestado no cuelga', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Luis');
    const v = await conRutina(t, c);

    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number, state, sent_at, answers, completed_at)
       VALUES ($1, $2, 1, 'COMPLETED', now() - interval '9 days', '{}'::jsonb, now())`,
      [c, v],
    );

    const { rows } = await db.query(`SELECT * FROM trainer_stale_checkins($1, 2)`, [t]);

    expect(rows).toHaveLength(0);
  });

  it('dice si ya se le recordó', async () => {
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Luis');
    const v = await conRutina(t, c);

    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number, state, sent_at, reminder_sent_at)
       VALUES ($1, $2, 1, 'PENDING', now() - interval '5 days', now() - interval '3 days')`,
      [c, v],
    );

    const { rows } = await db.query(`SELECT * FROM trainer_stale_checkins($1, 2)`, [t]);

    expect(rows[0].reminded).toBe(true);
  });

  it('uno que nunca salió no cuelga', async () => {
    // Sin `sent_at` el cliente no lo ha visto: no se le puede reclamar.
    const t = await createProfile(db, 'trainer');
    const c = await nuevoCliente(t, 'Luis');
    const v = await conRutina(t, c);

    await db.query(
      `INSERT INTO checkins (client_id, version_id, week_number, state)
       VALUES ($1, $2, 1, 'PENDING')`,
      [c, v],
    );

    const { rows } = await db.query(`SELECT * FROM trainer_stale_checkins($1, 2)`, [t]);

    expect(rows).toHaveLength(0);
  });
});
