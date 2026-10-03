/**
 * SPEC-010 — Solicitudes de cambio contra PostgreSQL.
 *
 * ┌─ LO QUE MÁS IMPORTA AQUÍ ──────────────────────────────────────────────┐
 * │ CA-4: la v1 queda byte a byte igual. Ni su contenido, ni su estado, ni │
 * │ su `sent_at`. El cliente conserva en su chat exactamente lo que        │
 * │ recibió, y eso solo se puede comprobar con la base delante.            │
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

const CONTENIDO = { summary: 'v1 original', days: [], warnings: [] };

interface Escenario {
  trainerId: string;
  clientId: string;
  planId: string;
  versionId: string;
}

/** Un cliente con su v1 ya enviada: lo único sobre lo que se puede pedir. */
async function escenario(): Promise<Escenario> {
  const trainerId = await createProfile(db, 'trainer');
  const profileId = await createProfile(db, 'client', 'Carlos');
  tokenSeq += 1;

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, profile_id, linked_at, full_name, link_token)
     VALUES ($1, $2, now(), 'Carlos Pérez', $3) RETURNING id`,
    [trainerId, profileId, `token_de_prueba_numero_${String(tokenSeq).padStart(10, '0')}`],
  );
  const clientId = rows[0]!.id;

  const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
  const versionId = await createVersion(db, planId, 'ai', trainerId, CONTENIDO);

  await transition(db, versionId, 'DRAFT', 'APPROVED');
  await transition(db, versionId, 'APPROVED', 'SENT', 'system');

  return { trainerId, clientId, planId, versionId };
}

const pedir = async (versionId: string, clientId: string, reason: string) =>
  (
    await db.query<{ id: string; created: boolean }>(
      `SELECT * FROM request_change($1, $2, $3)`,
      [versionId, clientId, reason],
    )
  ).rows[0]!.id;

// ---------------------------------------------------------------------------

describe('🔴 CA-1 y CA-4 · la rutina enviada no se toca', () => {
  it('pedir un cambio no altera NADA de la v1', async () => {
    const { versionId, clientId } = await escenario();

    const { rows: antes } = await db.query(
      `SELECT state, content, sent_at, version_number, updated_at
         FROM workout_versions WHERE id = $1`,
      [versionId],
    );

    await pedir(versionId, clientId, 'too_hard');

    const { rows: despues } = await db.query(
      `SELECT state, content, sent_at, version_number, updated_at
         FROM workout_versions WHERE id = $1`,
      [versionId],
    );

    expect(despues[0]).toEqual(antes[0]);
  });

  it('y la solicitud queda OPEN', async () => {
    const { versionId, clientId } = await escenario();

    await pedir(versionId, clientId, 'too_hard');

    const { rows } = await db.query(`SELECT state, reason FROM change_requests`);
    expect(rows[0]).toEqual({ state: 'OPEN', reason: 'too_hard' });
  });
});

describe('CA-8 · una sola solicitud abierta por versión', () => {
  // SPEC-030 regla 1: la segunda pulsación NO pisa el motivo ya elegido —
  // antes sí lo actualizaba, y eso hacía que el aviso al entrenador llegara
  // dos veces con motivos distintos aunque solo hubiera una fila.
  it('la segunda no crea otra fila NI cambia el motivo', async () => {
    const { versionId, clientId } = await escenario();

    const primera = await pedir(versionId, clientId, 'too_hard');
    const segunda = await pedir(versionId, clientId, 'too_long');

    expect(segunda).toBe(primera);
    const { rows } = await db.query(`SELECT count(*), max(reason::text) AS motivo FROM change_requests`);
    expect(rows[0].count).toBe('1');
    expect(rows[0].motivo).toBe('too_hard');
  });

  it('SPEC-030 regla 2 · `created` dice cuál de las dos la creó', async () => {
    const { versionId, clientId } = await escenario();

    const { rows: primera } = await db.query<{ id: string; created: boolean }>(
      `SELECT * FROM request_change($1, $2, 'too_hard')`,
      [versionId, clientId],
    );
    const { rows: segunda } = await db.query<{ id: string; created: boolean }>(
      `SELECT * FROM request_change($1, $2, 'too_long')`,
      [versionId, clientId],
    );

    expect(primera[0]!.created).toBe(true);
    expect(segunda[0]!.created).toBe(false);
    expect(segunda[0]!.id).toBe(primera[0]!.id);
  });

  it('🔴 el UNIQUE lo garantiza, no una comprobación previa', async () => {
    // Dos peticiones simultáneas pasarían un `if`; un índice único, no.
    const { versionId, clientId } = await escenario();
    await pedir(versionId, clientId, 'too_hard');

    let codigo: string | undefined;
    try {
      await db.query(
        `INSERT INTO change_requests (version_id, client_id, reason, state)
         VALUES ($1, $2, 'too_easy', 'OPEN')`,
        [versionId, clientId],
      );
    } catch (error) {
      codigo = (error as { code?: string }).code;
    }

    expect(codigo).toBe('23505');
  });

  it('una RESUELTA no bloquea una nueva sobre la misma versión', async () => {
    // El histórico de lo que pidió es justo lo que da contexto a la v3.
    const { versionId, clientId } = await escenario();
    await pedir(versionId, clientId, 'too_hard');
    await db.query(
      `UPDATE change_requests SET state='RESOLVED', resolved_at=now() WHERE version_id=$1`,
      [versionId],
    );

    await pedir(versionId, clientId, 'want_variety');

    const { rows } = await db.query(`SELECT count(*) FROM change_requests`);
    expect(rows[0].count).toBe('2');
  });

  it('un motivo nuevo NO borra el comentario ya escrito', async () => {
    const { versionId, clientId } = await escenario();
    const id = await pedir(versionId, clientId, 'too_hard');
    await db.query(`SELECT * FROM add_change_comment($1, $2, 'No termino la semana 1')`, [id, clientId]);

    await pedir(versionId, clientId, 'too_long');

    const { rows } = await db.query(`SELECT comment FROM change_requests WHERE id=$1`, [id]);
    expect(rows[0].comment).toBe('No termino la semana 1');
  });
});

describe('el comentario', () => {
  it('se guarda, y se trunca a 500', async () => {
    const { versionId, clientId } = await escenario();
    const id = await pedir(versionId, clientId, 'other');

    await db.query(`SELECT * FROM add_change_comment($1, $2, $3)`, [id, clientId, 'a'.repeat(900)]);

    const { rows } = await db.query(`SELECT length(comment) AS largo FROM change_requests WHERE id=$1`, [id]);
    expect(rows[0].largo).toBe(500);
  });

  it('CA-5 · el de OTRO cliente no se puede tocar', async () => {
    const { versionId, clientId } = await escenario();
    const otro = await escenario();
    const id = await pedir(versionId, clientId, 'other');

    const { rows } = await db.query<{ saved: boolean; truncated: boolean }>(
      `SELECT * FROM add_change_comment($1, $2, 'colado')`,
      [id, otro.clientId],
    );

    expect(rows[0]!.saved).toBe(false);
  });
});

describe('CA-2, CA-3 y CA-12 · el ciclo de la revisión', () => {
  it('crear la v2 NO resuelve la solicitud', async () => {
    // Una revisión abandonada dejaría al cliente sin respuesta y sin
    // solicitud abierta que lo recordara.
    const { versionId, clientId, planId, trainerId } = await escenario();
    await pedir(versionId, clientId, 'too_hard');

    await createVersion(db, planId, 'manual', trainerId, CONTENIDO);

    const { rows } = await db.query(`SELECT count(*) FROM change_requests WHERE state='OPEN'`);
    expect(rows[0].count).toBe('1');
  });

  it('CA-2 · el plan apunta a la v2', async () => {
    const { planId, trainerId } = await escenario();

    const v2 = await createVersion(db, planId, 'manual', trainerId, CONTENIDO);

    const { rows } = await db.query(`SELECT current_version_id FROM workout_plans WHERE id=$1`, [
      planId,
    ]);
    expect(rows[0].current_version_id).toBe(v2);
  });

  it('CA-3 · enviarla sí la resuelve, con su versión', async () => {
    const { versionId, clientId, planId, trainerId } = await escenario();
    await pedir(versionId, clientId, 'too_hard');
    const v2 = await createVersion(db, planId, 'manual', trainerId, CONTENIDO);

    const { rows: cerradas } = await db.query<{ resolve_change_requests: number }>(
      `SELECT resolve_change_requests($1)`,
      [v2],
    );
    expect(cerradas[0]!.resolve_change_requests).toBe(1);

    const { rows } = await db.query(
      `SELECT state, resolved_by_version_id, resolved_at FROM change_requests`,
    );
    expect(rows[0].state).toBe('RESOLVED');
    expect(rows[0].resolved_by_version_id).toBe(v2);
    expect(rows[0].resolved_at).not.toBeNull();
  });

  it('CA-4 · con la v2 enviada, la v1 sigue byte a byte igual', async () => {
    const { versionId, clientId, planId, trainerId } = await escenario();
    const { rows: antes } = await db.query(
      `SELECT state, content, sent_at, version_number FROM workout_versions WHERE id=$1`,
      [versionId],
    );

    await pedir(versionId, clientId, 'too_hard');
    const v2 = await createVersion(db, planId, 'manual', trainerId, CONTENIDO);
    await transition(db, v2, 'DRAFT', 'APPROVED');
    await transition(db, v2, 'APPROVED', 'SENT', 'system');
    await db.query(`SELECT resolve_change_requests($1)`, [v2]);

    const { rows: despues } = await db.query(
      `SELECT state, content, sent_at, version_number FROM workout_versions WHERE id=$1`,
      [versionId],
    );

    expect(despues[0]).toEqual(antes[0]);
  });

  it('la propia v2 no se resuelve a sí misma', async () => {
    const { planId, trainerId, clientId } = await escenario();
    const v2 = await createVersion(db, planId, 'manual', trainerId, CONTENIDO);
    await transition(db, v2, 'DRAFT', 'APPROVED');
    await transition(db, v2, 'APPROVED', 'SENT', 'system');
    await pedir(v2, clientId, 'too_easy');

    const { rows } = await db.query<{ resolve_change_requests: number }>(
      `SELECT resolve_change_requests($1)`,
      [v2],
    );

    expect(rows[0]!.resolve_change_requests).toBe(0);
  });

  it('una versión que no existe no rompe nada', async () => {
    const { rows } = await db.query<{ resolve_change_requests: number }>(
      `SELECT resolve_change_requests($1)`,
      ['00000000-0000-0000-0000-000000000000'],
    );
    expect(rows[0]!.resolve_change_requests).toBe(0);
  });
});

describe('las consultas', () => {
  it('`version_for_request` trae la pertenencia y el plan', async () => {
    const { versionId, planId, clientId, trainerId } = await escenario();

    const { rows } = await db.query(`SELECT * FROM version_for_request($1)`, [versionId]);

    expect(rows[0]).toMatchObject({
      state: 'SENT',
      plan_id: planId,
      client_id: clientId,
      trainer_id: trainerId,
      client_name: 'Carlos Pérez',
    });
    expect(rows[0].client_profile_id).not.toBeNull();
  });

  // Regla 13: sin esto, `startRevision` no puede distinguir "primera vez
  // que tocan el botón" de "ya hay una v2 en marcha, esto es un aviso viejo".
  it('`version_for_request` trae también la versión VIGENTE del plan', async () => {
    const { versionId, planId } = await escenario();

    const antes = await db.query(`SELECT * FROM version_for_request($1)`, [versionId]);
    // Todavía no se creó ninguna revisión: la vigente es esta misma v1.
    expect(antes.rows[0]).toMatchObject({
      current_version_id: versionId,
      current_version_state: 'SENT',
      current_version_number: 1,
    });

    // La misma función atómica que usa `createRevision` (SPEC-000 §3).
    const { rows: nueva } = await db.query<{ create_workout_version: string }>(
      `SELECT create_workout_version($1, 'manual', (SELECT trainer_id FROM clients WHERE id = (
         SELECT client_id FROM workout_plans WHERE id = $1
       )))`,
      [planId],
    );
    const v2 = nueva[0]!.create_workout_version;

    // Preguntar OTRA VEZ por la v1 original ahora dice que la vigente es la
    // v2, en NEW: es la señal que evita crear una v3 por encima.
    const despues = await db.query(`SELECT * FROM version_for_request($1)`, [versionId]);
    expect(despues.rows[0]).toMatchObject({
      version_id: versionId,
      current_version_id: v2,
      current_version_state: 'NEW',
      current_version_number: 2,
    });
  });

  it('`open_change_request_for_client` dice cuándo se preguntó', async () => {
    // Es lo que decide contra el check-in quién se queda el texto libre.
    const { versionId, clientId } = await escenario();
    const id = await pedir(versionId, clientId, 'too_hard');

    const { rows: cliente } = await db.query<{ profile_id: string }>(
      `SELECT profile_id FROM clients WHERE id=$1`,
      [clientId],
    );

    const { rows } = await db.query(`SELECT * FROM open_change_request_for_client($1)`, [
      cliente[0]!.profile_id,
    ]);

    expect(rows[0]).toMatchObject({ request_id: id, has_comment: false });
    expect(rows[0].asked_at).not.toBeNull();
  });

  it('una resuelta ya no sale como abierta', async () => {
    const { versionId, clientId } = await escenario();
    await pedir(versionId, clientId, 'too_hard');
    await db.query(`UPDATE change_requests SET state='RESOLVED', resolved_at=now()`);

    const { rows: cliente } = await db.query<{ profile_id: string }>(
      `SELECT profile_id FROM clients WHERE id=$1`,
      [clientId],
    );
    const { rows } = await db.query(`SELECT * FROM open_change_request_for_client($1)`, [
      cliente[0]!.profile_id,
    ]);

    expect(rows).toHaveLength(0);
  });

  it('`change_request_for_trainer` trae el contexto completo', async () => {
    const { versionId, clientId } = await escenario();
    const id = await pedir(versionId, clientId, 'uncomfortable_exercise');
    await db.query(`SELECT * FROM add_change_comment($1, $2, 'el hombro')`, [id, clientId]);

    const { rows } = await db.query(`SELECT * FROM change_request_for_trainer($1)`, [id]);

    expect(rows[0]).toMatchObject({
      reason: 'uncomfortable_exercise',
      comment: 'el hombro',
      client_name: 'Carlos Pérez',
      version_number: 1,
      state: 'OPEN',
    });
  });
});

describe('CA-9 · el «me sirve»', () => {
  it('se registra y NO cambia el estado', async () => {
    const { versionId, clientId } = await escenario();

    await db.query(`SELECT record_version_accepted($1, $2)`, [versionId, clientId]);

    const { rows: evento } = await db.query(
      `SELECT event_type, actor, to_state FROM plan_events WHERE event_type='client_feedback'`,
    );
    expect(evento[0]).toMatchObject({ event_type: 'client_feedback', actor: 'client' });
    // El CHECK exige `to_state` NULL si no es una transición.
    expect(evento[0].to_state).toBeNull();

    const { rows } = await db.query(`SELECT state FROM workout_versions WHERE id=$1`, [versionId]);
    expect(rows[0].state).toBe('SENT');
  });

  it('sobre una versión que no existe no revienta', async () => {
    const { clientId } = await escenario();

    await db.query(`SELECT record_version_accepted($1, $2)`, [
      '00000000-0000-0000-0000-000000000000',
      clientId,
    ]);

    const { rows } = await db.query(`SELECT count(*) FROM plan_events WHERE event_type='client_feedback'`);
    expect(rows[0].count).toBe('0');
  });
});
