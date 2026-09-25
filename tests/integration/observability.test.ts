/**
 * SPEC-012 CA-6 — la traza de extremo a extremo, contra PostgreSQL.
 *
 * ┌─ QUÉ PRUEBA ESTO QUE NO PRUEBE UN TEST UNITARIO ───────────────────────┐
 * │ Que `request_id` sirva de ÍNDICE: que con un solo valor se recupere la │
 * │ cadena entera —el update que entró, las transiciones que provocó y la  │
 * │ llamada a la IA— cruzando tres tablas.                                 │
 * │                                                                        │
 * │ Es la propiedad de la que cuelga todo el RUNBOOK. Si se rompe, los     │
 * │ logs siguen escribiéndose y siguen sin servir para nada.               │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connect,
  createClient,
  createPlan,
  createProfile,
  resetTestDatabase,
  truncateAll,
} from '../helpers/db.ts';

let db: Client;

/** El que nace en `telegram-webhook` cuando el entrenador pulsa «Generar». */
const REQ_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

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

/** Reproduce la cadena real de una pulsación del botón «Generar». */
async function cadenaCompleta(requestIdDeLaIa: string): Promise<string> {
  const trainerId = await createProfile(db, 'trainer');
  const clientId = await createClient(db, trainerId);
  const planId = await createPlan(db, clientId);

  // 1. El update que entra por Telegram.
  await db.query(
    `INSERT INTO webhook_events (source, external_id, payload, request_id)
     VALUES ('telegram', 'update-1', '{"update_id":1}'::jsonb, $1)`,
    [REQ_A],
  );

  // 2. La versión que crea, con su evento.
  const { rows } = await db.query<{ create_workout_version: string }>(
    `SELECT create_workout_version($1, 'ai', $2, null, null, $3)`,
    [planId, trainerId, REQ_A],
  );
  const versionId = rows[0]!.create_workout_version;

  // 3. La transición que dispara la generación.
  await db.query(`SELECT apply_version_transition($1, 'NEW', 'GENERATING', 'system', $2)`, [
    versionId,
    REQ_A,
  ]);

  // 4. La llamada a la IA, ya en la OTRA Edge Function.
  await db.query(
    `INSERT INTO ai_generations (provider, model, operation, version_id, request_id, status)
     VALUES ('falso', 'falso', 'generate', $1, $2, 'SUCCEEDED')`,
    [versionId, requestIdDeLaIa],
  );

  return versionId;
}

describe('CA-6 · un request_id recupera la cadena entera', () => {
  it('las tres tablas comparten el identificador', async () => {
    await cadenaCompleta(REQ_A);

    // Una tras otra, no con Promise.all: un mismo `Client` de pg no admite
    // consultas simultáneas, y pg@9 lo convierte de advertencia en error.
    const eventos = await db.query('SELECT 1 FROM webhook_events WHERE request_id = $1', [REQ_A]);
    const planEvents = await db.query('SELECT 1 FROM plan_events WHERE request_id = $1', [REQ_A]);
    const generaciones = await db.query('SELECT 1 FROM ai_generations WHERE request_id = $1', [
      REQ_A,
    ]);

    expect(eventos.rowCount).toBe(1);
    expect(planEvents.rowCount).toBeGreaterThanOrEqual(2); // creación + transición
    expect(generaciones.rowCount).toBe(1);
  });

  it('la consulta del RUNBOOK devuelve la historia en orden', async () => {
    const versionId = await cadenaCompleta(REQ_A);

    const { rows } = await db.query<{ event_type: string; to_state: string | null }>(
      `SELECT event_type, from_state, to_state, actor, request_id, created_at
         FROM plan_events
        WHERE version_id = $1
        ORDER BY created_at ASC, id ASC`,
      [versionId],
    );

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.event_type.length > 0)).toBe(true);

    // La transición a GENERATING está, y es la que explica qué pasó después.
    expect(rows.some((r) => r.to_state === 'GENERATING')).toBe(true);
  });

  it('EL BUG: con otro request_id, la generación queda huérfana', async () => {
    // Esto es exactamente lo que hacía `generate-version` antes de SPEC-012:
    // tiraba el identificador que le llegaba y se inventaba otro.
    const REQ_B = '11111111-2222-4333-8444-555555555555';
    await cadenaCompleta(REQ_B);

    // Buscar por el id del botón encuentra el update y las transiciones…
    const { rowCount: eventos } = await db.query(
      'SELECT 1 FROM webhook_events WHERE request_id = $1',
      [REQ_A],
    );
    expect(eventos).toBe(1);

    // …pero NO la generación que provocó. La traza se corta ahí.
    const { rowCount: generaciones } = await db.query(
      'SELECT 1 FROM ai_generations WHERE request_id = $1',
      [REQ_A],
    );
    expect(generaciones).toBe(0);
  });
});
