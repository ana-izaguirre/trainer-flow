/**
 * SPEC-008 — Plantillas, creación manual y editor, contra PostgreSQL.
 *
 * ┌─ POR QUÉ ESTAS OPERACIONES SON ATÓMICAS ───────────────────────────────┐
 * │ Un CHECK del esquema exige que `source = 'template'` si y solo si hay  │
 * │ `template_id`. Escribir contenido y fuente en dos pasos dejaría la     │
 * │ fila violando esa regla entre medias, y en un fallo, para siempre.     │
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
  PG,
  pgErrorCode,
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

interface Escenario {
  trainerId: string;
  clientId: string;
  versionId: string;
}

async function escenario(conEvaluacion = true): Promise<Escenario> {
  const trainerId = await createProfile(db, 'trainer');
  tokenSeq += 1;

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, 'Carlos Pérez', $2) RETURNING id`,
    [trainerId, `token_de_prueba_numero_${String(tokenSeq).padStart(10, '0')}`],
  );
  const clientId = rows[0]!.id;

  const assessmentId = conEvaluacion ? await createAssessment(db, clientId) : null;
  const planId = await createPlan(db, clientId, assessmentId);
  const versionId = await createVersion(db, planId, 'ai', trainerId);

  return { trainerId, clientId, versionId };
}

const CONTENIDO = { summary: 'Cuerpo completo', days: [], warnings: [] };

const llenar = async (
  versionId: string,
  expected: string,
  source: string,
  templateId: string | null,
) =>
  (
    await db.query<{ fill_version: boolean }>(
      `SELECT fill_version($1, $2, $3, $4, $5::jsonb)`,
      [versionId, expected, source, templateId, JSON.stringify(CONTENIDO)],
    )
  ).rows[0]!.fill_version;

// ---------------------------------------------------------------------------

describe('fill_version', () => {
  it('CA-2 · carga contenido, fuente y template_id, y pasa a DRAFT', async () => {
    const { versionId } = await escenario();

    expect(await llenar(versionId, 'NEW', 'template', 'full-body-3d')).toBe(true);

    const { rows } = await db.query(
      `SELECT state, source, template_id, content FROM workout_versions WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]).toMatchObject({
      state: 'DRAFT',
      source: 'template',
      template_id: 'full-body-3d',
    });
    expect(rows[0].content).toMatchObject({ summary: 'Cuerpo completo' });
  });

  it('🔴 fuente y template_id van JUNTOS: el CHECK no deja otra cosa', async () => {
    // Es la razón de que esto sea una sola función y no dos updates.
    const { versionId } = await escenario();

    let codigo: string | undefined;
    try {
      await db.query(`UPDATE workout_versions SET source = 'template' WHERE id = $1`, [versionId]);
    } catch (error) {
      codigo = pgErrorCode(error);
    }

    expect(codigo).toBe(PG.CHECK_VIOLATION);
  });

  it('una segunda pulsación NO carga otra encima', async () => {
    const { versionId } = await escenario();
    await llenar(versionId, 'NEW', 'template', 'full-body-3d');

    expect(await llenar(versionId, 'NEW', 'template', 'upper-lower-4d')).toBe(false);

    const { rows } = await db.query(`SELECT template_id FROM workout_versions WHERE id=$1`, [
      versionId,
    ]);
    expect(rows[0].template_id).toBe('full-body-3d');
  });

  it('la manual queda sin template_id', async () => {
    const { versionId } = await escenario();

    expect(await llenar(versionId, 'NEW', 'manual', null)).toBe(true);

    const { rows } = await db.query(`SELECT source, template_id FROM workout_versions WHERE id=$1`, [
      versionId,
    ]);
    expect(rows[0]).toEqual({ source: 'manual', template_id: null });
  });

  it('CA-3 · no deja ni una fila en ai_generations', async () => {
    const { versionId } = await escenario();
    await llenar(versionId, 'NEW', 'template', 'full-body-3d');

    const { rows } = await db.query(`SELECT count(*) FROM ai_generations`);
    expect(rows[0].count).toBe('0');
  });

  it('deja el evento en plan_events', async () => {
    const { versionId } = await escenario();
    await llenar(versionId, 'NEW', 'template', 'full-body-3d');

    const { rows } = await db.query(
      `SELECT from_state, to_state, actor, metadata FROM plan_events
        WHERE version_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [versionId],
    );
    expect(rows[0]).toMatchObject({ from_state: 'NEW', to_state: 'DRAFT', actor: 'trainer' });
    expect(rows[0].metadata).toMatchObject({ template_id: 'full-body-3d' });
  });
});

describe('save_draft_content', () => {
  const guardar = async (versionId: string, summary: string) =>
    (
      await db.query<{ save_draft_content: boolean }>(
        `SELECT save_draft_content($1, $2::jsonb)`,
        [versionId, JSON.stringify({ summary, days: [], warnings: [] })],
      )
    ).rows[0]!.save_draft_content;

  it('CA-4 · edita in-place: ni versión nueva ni cambio de estado', async () => {
    const { versionId } = await escenario();
    await llenar(versionId, 'NEW', 'manual', null);

    expect(await guardar(versionId, 'editada')).toBe(true);

    const { rows } = await db.query(
      `SELECT version_number, state, edit_count, content->>'summary' AS resumen
         FROM workout_versions WHERE id = $1`,
      [versionId],
    );
    expect(rows[0]).toMatchObject({ version_number: 1, state: 'DRAFT', resumen: 'editada' });
    expect(rows[0].edit_count).toBe(1);

    const { rows: cuantas } = await db.query(`SELECT count(*) FROM workout_versions`);
    expect(cuantas[0].count).toBe('1');
  });

  it('CA-5 · sobre una APROBADA no escribe', async () => {
    const { versionId } = await escenario();
    await llenar(versionId, 'NEW', 'manual', null);
    await transition(db, versionId, 'DRAFT', 'APPROVED');

    expect(await guardar(versionId, 'colada')).toBe(false);

    const { rows } = await db.query(
      `SELECT content->>'summary' AS resumen FROM workout_versions WHERE id=$1`,
      [versionId],
    );
    expect(rows[0].resumen).toBe('Cuerpo completo');
  });

  it('`edit_count` no se pasa del límite de la tabla', async () => {
    // El CHECK lo acota a 5; el `least` evita que la sexta edición reviente.
    const { versionId } = await escenario();
    await llenar(versionId, 'NEW', 'manual', null);

    for (let i = 0; i < 8; i += 1) await guardar(versionId, `v${i}`);

    const { rows } = await db.query(`SELECT edit_count FROM workout_versions WHERE id=$1`, [
      versionId,
    ]);
    expect(rows[0].edit_count).toBe(5);
  });
});

describe('current_draft_for_trainer', () => {
  const actual = async (trainerId: string) =>
    (await db.query(`SELECT * FROM current_draft_for_trainer($1)`, [trainerId])).rows;

  it('CA-14 · sin borradores no devuelve nada', async () => {
    const { trainerId } = await escenario();
    expect(await actual(trainerId)).toHaveLength(0);
  });

  it('CA-13 · con dos, devuelve el tocado más recientemente', async () => {
    const trainerId = await createProfile(db, 'trainer');

    const crear = async (nombre: string) => {
      tokenSeq += 1;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO clients (trainer_id, full_name, link_token)
         VALUES ($1, $2, $3) RETURNING id`,
        [trainerId, nombre, `token_de_prueba_numero_${String(tokenSeq).padStart(10, '0')}`],
      );
      const planId = await createPlan(db, rows[0]!.id, null);
      const versionId = await createVersion(db, planId, 'ai', trainerId);
      await llenar(versionId, 'NEW', 'manual', null);
      return versionId;
    };

    await crear('Primero');
    const segundo = await crear('Segundo');

    const filas = await actual(trainerId);
    expect(filas).toHaveLength(1);
    expect(filas[0].version_id).toBe(segundo);
    expect(filas[0].client_name).toBe('Segundo');
  });

  it('una editada pasa a ser la actual', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const ids: string[] = [];

    for (const nombre of ['Uno', 'Dos']) {
      tokenSeq += 1;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO clients (trainer_id, full_name, link_token)
         VALUES ($1, $2, $3) RETURNING id`,
        [trainerId, nombre, `token_de_prueba_numero_${String(tokenSeq).padStart(10, '0')}`],
      );
      const planId = await createPlan(db, rows[0]!.id, null);
      const versionId = await createVersion(db, planId, 'ai', trainerId);
      await llenar(versionId, 'NEW', 'manual', null);
      ids.push(versionId);
    }

    await db.query(`SELECT save_draft_content($1, '{"summary":"x"}'::jsonb)`, [ids[0]]);

    expect((await actual(trainerId))[0].version_id).toBe(ids[0]);
  });

  it('no ve los borradores de OTRO entrenador', async () => {
    const otro = await createProfile(db, 'trainer', 'Otro');
    const { versionId } = await escenario();
    await llenar(versionId, 'NEW', 'manual', null);

    expect(await actual(otro)).toHaveLength(0);
  });

  it('una aprobada deja de ser el borrador actual', async () => {
    const { trainerId, versionId } = await escenario();
    await llenar(versionId, 'NEW', 'manual', null);
    await transition(db, versionId, 'DRAFT', 'APPROVED');

    expect(await actual(trainerId)).toHaveLength(0);
  });
});

describe('version_for_creation', () => {
  it('trae los criterios para ordenar las plantillas', async () => {
    const { versionId } = await escenario();

    const { rows } = await db.query(`SELECT * FROM version_for_creation($1)`, [versionId]);

    expect(rows[0]).toMatchObject({
      state: 'NEW',
      client_name: 'Carlos Pérez',
      days_per_week: 4,
      level: 'intermediate',
      has_limitations: true,
    });
  });

  it('🔴 NO devuelve el detalle de la limitación', async () => {
    const { versionId } = await escenario();

    const { rows, fields } = await db.query(`SELECT * FROM version_for_creation($1)`, [versionId]);

    expect(fields.map((f) => f.name)).not.toContain('limitations_detail');
    expect(JSON.stringify(rows[0])).not.toContain('hombro');
  });

  it('un plan SIN evaluación sale igual, con criterios NULL', async () => {
    // Con un INNER join, el botón 📋 no haría nada para esos clientes.
    const { versionId } = await escenario(false);

    const { rows } = await db.query(`SELECT * FROM version_for_creation($1)`, [versionId]);

    expect(rows).toHaveLength(1);
    expect(rows[0].days_per_week).toBeNull();
    expect(rows[0].has_limitations).toBe(false);
  });
});

describe('version_for_action, ahora con criterios', () => {
  it('los trae para poder validar al aprobar', async () => {
    const { versionId } = await escenario();

    const { rows } = await db.query(`SELECT * FROM version_for_action($1)`, [versionId]);

    expect(rows[0]).toMatchObject({ days_per_week: 4, has_limitations: true });
  });

  it('sin evaluación son NULL: se valida la forma', async () => {
    const { versionId } = await escenario(false);

    const { rows } = await db.query(`SELECT * FROM version_for_action($1)`, [versionId]);

    expect(rows[0].days_per_week).toBeNull();
  });
});
