/**
 * SPEC-027 — El token de actualización y la ingesta sobre un cliente que ya
 * existe, contra la base real.
 *
 * ┌─ LO QUE ESTE ARCHIVO GARANTIZA ────────────────────────────────────────┐
 * │ 1. En la base solo queda el HASH del token, nunca el token.            │
 * │ 2. Un token vale UNA vez, también con dos envíos simultáneos.          │
 * │ 3. Con un token válido NO se crea ningún cliente: la evaluación nueva  │
 * │    es del cliente al que se le emitió, y el plan pasa a apuntarle.     │
 * │ 4. La rutina en SENT no se toca.                                       │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connect,
  createAssessment,
  createClient,
  createPlan,
  createProfile,
  createVersion,
  linkClient,
  readVersion,
  resetTestDatabase,
  SAMPLE_CONTENT,
  sendVersion,
  truncateAll,
  PG,
  pgErrorCode,
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

let seq = 0;
/** 43 caracteres base64url, como los que genera `_shared`. */
const nuevoToken = () => `tok_${String(++seq).padStart(39, '0')}`;

/** Un cliente vinculado, con evaluación de 4 días, plan y una v1 en SENT. */
async function clienteConRutina() {
  const trainerId = await createProfile(db, 'trainer');
  const clientId = await createClient(db, trainerId, 'Carlos Pérez');
  const profileId = await createProfile(db, 'client', 'Carlos Pérez');
  await linkClient(db, clientId, profileId);
  const assessmentId = await createAssessment(db, clientId);
  const planId = await createPlan(db, clientId, assessmentId);
  const versionId = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
  await sendVersion(db, versionId);
  return { trainerId, clientId, profileId, assessmentId, planId, versionId };
}

async function emitir(clientId: string, token: string) {
  const { rows } = await db.query<{ chat: string | null }>(
    `SELECT issue_update_token_for_client($1, $2) AS chat`,
    [clientId, token],
  );
  return rows[0]!.chat;
}

/** La ingesta con token. Dos días y 45 minutos: cambian dos datos de la v1. */
async function actualizar(token: string, conexion: Client = db) {
  const { rows } = await conexion.query(
    `SELECT * FROM ingest_assessment_update(
       p_token => $1,
       p_raw_payload => '{"origen":"test"}'::jsonb,
       p_goal => 'Ganancia muscular',
       p_level => 'intermediate',
       p_days_per_week => 2::smallint,
       p_session_minutes => 45::smallint,
       p_equipment => 'Gimnasio',
       p_has_limitations => true,
       p_limitations_detail => 'Rodilla'
     )`,
    [token],
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('emitir el token', () => {
  it('CA-1 · guarda el hash con vencimiento a 7 días, nunca el token', async () => {
    const { clientId, profileId } = await clienteConRutina();
    const token = nuevoToken();

    const chat = await emitir(clientId, token);

    // Devuelve el chat del CLIENTE: es a quien hay que mandarle el enlace.
    const { rows: perfil } = await db.query(`SELECT telegram_chat_id FROM profiles WHERE id = $1`, [profileId]);
    expect(String(chat)).toBe(String(perfil[0]!['telegram_chat_id']));

    const { rows } = await db.query(
      `SELECT update_token_hash, update_token_expires_at - now() AS falta, row_to_json(c)::text AS fila
       FROM clients c WHERE id = $1`,
      [clientId],
    );
    expect(rows[0]!['update_token_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!['fila']).not.toContain(token);
    const falta = rows[0]!['falta'] as { days?: number };
    expect(falta.days).toBe(6); // 6 días y casi 24 horas
  });

  it('a un cliente sin vincular no se le emite nada', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await createClient(db, trainerId);

    expect(await emitir(clientId, nuevoToken())).toBeNull();

    const { rows } = await db.query(`SELECT update_token_hash FROM clients WHERE id = $1`, [clientId]);
    expect(rows[0]!['update_token_hash']).toBeNull();
  });

  it('por perfil: el cliente pide el suyo, y solo el suyo', async () => {
    const { clientId, profileId } = await clienteConRutina();

    const { rows } = await db.query(`SELECT issue_update_token_for_profile($1, $2) AS id`, [
      profileId,
      nuevoToken(),
    ]);
    expect(rows[0]!['id']).toBe(clientId);
  });

  it('por perfil: un perfil que no es de ningún cliente no emite nada', async () => {
    const trainerId = await createProfile(db, 'trainer');

    const { rows } = await db.query(`SELECT issue_update_token_for_profile($1, $2) AS id`, [
      trainerId,
      nuevoToken(),
    ]);
    expect(rows[0]!['id']).toBeNull();
  });
});

describe('consumir el token', () => {
  it('CA-2 · evaluación nueva para ESE cliente, sin crear ninguno, y el plan le apunta', async () => {
    const { clientId, assessmentId, planId, versionId } = await clienteConRutina();
    const token = nuevoToken();
    await emitir(clientId, token);
    const { rows: antes } = await db.query(`SELECT count(*)::int AS n FROM clients`);

    const [fila] = await actualizar(token);

    expect(fila).toMatchObject({
      client_id: clientId,
      client_name: 'Carlos Pérez',
      plan_id: planId,
      version_id: versionId,
      version_state: 'SENT',
    });
    expect(fila!['assessment_id']).not.toBe(assessmentId);

    const { rows: despues } = await db.query(`SELECT count(*)::int AS n FROM clients`);
    expect(despues[0]!['n']).toBe(antes[0]!['n']);

    const { rows: plan } = await db.query(`SELECT assessment_id FROM workout_plans WHERE id = $1`, [planId]);
    expect(plan[0]!['assessment_id']).toBe(fila!['assessment_id']);

    // La anterior NO se borra: queda como historia (regla 6).
    const { rows: evaluaciones } = await db.query(
      `SELECT count(*)::int AS n FROM assessments WHERE client_id = $1`,
      [clientId],
    );
    expect(evaluaciones[0]!['n']).toBe(2);
  });

  it('devuelve la evaluación ANTERIOR, para decir qué cambió', async () => {
    const { clientId } = await clienteConRutina();
    const token = nuevoToken();
    await emitir(clientId, token);

    const [fila] = await actualizar(token);

    const anterior = fila!['previous'] as Record<string, unknown>;
    expect(anterior['days_per_week']).toBe(4);
    expect(anterior['session_minutes']).toBe(60);
    // Sin el payload crudo ni ids: solo los datos.
    expect(anterior).not.toHaveProperty('raw_payload');
    expect(anterior).not.toHaveProperty('client_id');
  });

  it('CA-3 · la versión en SENT no cambia, ni estado ni contenido', async () => {
    const { clientId, versionId } = await clienteConRutina();
    const antes = await readVersion(db, versionId);
    const token = nuevoToken();
    await emitir(clientId, token);

    await actualizar(token);

    expect(await readVersion(db, versionId)).toEqual(antes);
  });

  it('el token queda consumido', async () => {
    const { clientId } = await clienteConRutina();
    const token = nuevoToken();
    await emitir(clientId, token);

    await actualizar(token);

    const { rows } = await db.query(
      `SELECT update_token_hash, update_token_expires_at FROM clients WHERE id = $1`,
      [clientId],
    );
    expect(rows[0]).toEqual({ update_token_hash: null, update_token_expires_at: null });
  });

  it('CA-6 · un token inventado no devuelve nada y no escribe nada', async () => {
    await clienteConRutina();
    const { rows: antes } = await db.query(`SELECT count(*)::int AS n FROM assessments`);

    expect(await actualizar(nuevoToken())).toEqual([]);

    const { rows: despues } = await db.query(`SELECT count(*)::int AS n FROM assessments`);
    expect(despues[0]!['n']).toBe(antes[0]!['n']);
  });

  it('CA-6 · un token usado ya no vale', async () => {
    const { clientId } = await clienteConRutina();
    const token = nuevoToken();
    await emitir(clientId, token);

    expect(await actualizar(token)).toHaveLength(1);
    expect(await actualizar(token)).toEqual([]);
  });

  it('CA-6 · un token vencido ya no vale', async () => {
    const { clientId } = await clienteConRutina();
    const token = nuevoToken();
    await emitir(clientId, token);
    await db.query(
      `UPDATE clients SET update_token_expires_at = now() - interval '1 second' WHERE id = $1`,
      [clientId],
    );

    expect(await actualizar(token)).toEqual([]);
  });

  it('CA-7 · pedir otro enlace invalida el anterior', async () => {
    const { clientId } = await clienteConRutina();
    const primero = nuevoToken();
    const segundo = nuevoToken();
    await emitir(clientId, primero);
    await emitir(clientId, segundo);

    expect(await actualizar(primero)).toEqual([]);
    expect(await actualizar(segundo)).toHaveLength(1);
  });

  it('un solo uso también con dos envíos SIMULTÁNEOS', async () => {
    const { clientId } = await clienteConRutina();
    const token = nuevoToken();
    await emitir(clientId, token);
    const otra = await connect();

    try {
      const [a, b] = await Promise.all([actualizar(token), actualizar(token, otra)]);
      expect(a.length + b.length).toBe(1);
    } finally {
      await otra.end();
    }
  });
});

describe('🔴 seguridad', () => {
  it.each([
    ['issue_update_token_for_client', `SELECT issue_update_token_for_client($1, 'x')`],
    ['issue_update_token_for_profile', `SELECT issue_update_token_for_profile($1, 'x')`],
    [
      'ingest_assessment_update',
      `SELECT * FROM ingest_assessment_update('x', '{}'::jsonb, 'a', 'b', 1::smallint, 1::smallint, 'c', false) WHERE $1::uuid IS NOT NULL`,
    ],
  ])('anon no puede ejecutar %s', async (_nombre, sql) => {
    await db.query(`SET ROLE anon`);
    try {
      await db.query(sql, ['00000000-0000-0000-0000-000000000000']);
      throw new Error('anon pudo ejecutarla');
    } catch (error) {
      expect(pgErrorCode(error)).toBe(PG.INSUFFICIENT_PRIVILEGE);
    } finally {
      await db.query(`RESET ROLE`);
    }
  });
});
