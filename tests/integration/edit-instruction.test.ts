/**
 * SPEC-004 — la espera de instrucción de edición, contra PostgreSQL.
 *
 * Lo que los tests unitarios con fakes no pueden probar: que el JOIN de
 * `version_awaiting_edit` esté bien escrito, que `edit_count < 5` filtre de
 * verdad, y que prender una espera apague cualquier otra del MISMO
 * entrenador (nunca de otro).
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

const CONTENIDO = { summary: 'Cuerpo completo', days: [], warnings: [] };

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

async function crearCliente(trainerId: string, nombre = 'Carlos Pérez'): Promise<string> {
  tokenSeq += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, $2, $3) RETURNING id`,
    [trainerId, nombre, `token_de_prueba_numero_${String(tokenSeq).padStart(10, '0')}`],
  );
  return rows[0]!.id;
}

/** Una versión en DRAFT, con evaluación real detrás (lo que exige el JOIN). */
async function draftConEvaluacion(
  trainerId: string,
  nombre = 'Carlos Pérez',
): Promise<{ clientId: string; versionId: string }> {
  const clientId = await crearCliente(trainerId, nombre);
  const assessmentId = await createAssessment(db, clientId);
  const planId = await createPlan(db, clientId, assessmentId);
  const versionId = await createVersion(db, planId, 'ai', trainerId);
  await db.query(`SELECT fill_version($1, 'NEW', 'manual', null, $2::jsonb)`, [
    versionId,
    JSON.stringify(CONTENIDO),
  ]);
  return { clientId, versionId };
}

const startEdit = async (versionId: string) =>
  (await db.query<{ start_edit_instruction: boolean }>(`SELECT start_edit_instruction($1)`, [versionId]))
    .rows[0]!.start_edit_instruction;

const awaiting = async (versionId: string) =>
  (await db.query<{ awaiting_edit_instruction: boolean }>(
    `SELECT awaiting_edit_instruction FROM workout_versions WHERE id = $1`,
    [versionId],
  )).rows[0]!.awaiting_edit_instruction;

// ---------------------------------------------------------------------------

describe('start_edit_instruction', () => {
  it('prende la espera sobre un DRAFT con margen', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);

    expect(await startEdit(versionId)).toBe(true);
    expect(await awaiting(versionId)).toBe(true);
  });

  it('false sobre una versión que no existe', async () => {
    expect(await startEdit('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('false si el estado no es DRAFT', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);
    await transition(db, versionId, 'DRAFT', 'APPROVED');

    expect(await startEdit(versionId)).toBe(false);
    expect(await awaiting(versionId)).toBe(false);
  });

  it('false con 5 ediciones ya hechas', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);
    await db.query(`UPDATE workout_versions SET edit_count = 5 WHERE id = $1`, [versionId]);

    expect(await startEdit(versionId)).toBe(false);
  });

  it('apaga cualquier otra espera del MISMO entrenador: a lo sumo una a la vez', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId: primera } = await draftConEvaluacion(trainerId, 'Ana');
    const { versionId: segunda } = await draftConEvaluacion(trainerId, 'Beto');

    await startEdit(primera);
    expect(await awaiting(primera)).toBe(true);

    await startEdit(segunda);

    expect(await awaiting(primera)).toBe(false);
    expect(await awaiting(segunda)).toBe(true);
  });

  it('NO apaga la espera de OTRO entrenador', async () => {
    const trainerA = await createProfile(db, 'trainer', 'Entrenador A');
    const trainerB = await createProfile(db, 'trainer', 'Entrenador B');
    const { versionId: deA } = await draftConEvaluacion(trainerA);
    const { versionId: deB } = await draftConEvaluacion(trainerB);

    await startEdit(deA);
    await startEdit(deB);

    expect(await awaiting(deA)).toBe(true);
    expect(await awaiting(deB)).toBe(true);
  });
});

describe('cancel_edit_instruction', () => {
  it('apaga sin condición: cambiar de intención no es un error', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);
    await startEdit(versionId);

    await db.query(`SELECT cancel_edit_instruction($1)`, [versionId]);

    expect(await awaiting(versionId)).toBe(false);
  });

  it('sobre una versión sin espera prendida, no rompe nada', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);

    await expect(db.query(`SELECT cancel_edit_instruction($1)`, [versionId])).resolves.toBeDefined();
  });
});

describe('cancel_any_edit_instruction', () => {
  it('apaga la espera del entrenador sin conocer la versión', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);
    await startEdit(versionId);

    await db.query(`SELECT cancel_any_edit_instruction($1)`, [trainerId]);

    expect(await awaiting(versionId)).toBe(false);
  });

  it('NO apaga la espera de OTRO entrenador', async () => {
    const trainerA = await createProfile(db, 'trainer', 'Entrenador A');
    const trainerB = await createProfile(db, 'trainer', 'Entrenador B');
    const { versionId: deA } = await draftConEvaluacion(trainerA);
    await startEdit(deA);

    await db.query(`SELECT cancel_any_edit_instruction($1)`, [trainerB]);

    expect(await awaiting(deA)).toBe(true);
  });
});

describe('version_awaiting_edit', () => {
  it('sin nada esperando, no devuelve filas', async () => {
    const trainerId = await createProfile(db, 'trainer');
    await draftConEvaluacion(trainerId);

    const { rows } = await db.query(`SELECT * FROM version_awaiting_edit($1)`, [trainerId]);
    expect(rows).toHaveLength(0);
  });

  it('trae la versión esperando, con los datos para llamar a la IA', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);
    await startEdit(versionId);

    const { rows } = await db.query(`SELECT * FROM version_awaiting_edit($1)`, [trainerId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version_id: versionId,
      client_name: 'Carlos Pérez',
      days_per_week: 4,
      level: 'intermediate',
      edit_count: 0,
    });
  });

  it('NO trae la de otro entrenador', async () => {
    const trainerA = await createProfile(db, 'trainer', 'Entrenador A');
    const trainerB = await createProfile(db, 'trainer', 'Entrenador B');
    const { versionId } = await draftConEvaluacion(trainerA);
    await startEdit(versionId);

    const { rows } = await db.query(`SELECT * FROM version_awaiting_edit($1)`, [trainerB]);
    expect(rows).toHaveLength(0);
  });
});

describe('save_draft_content también apaga la espera', () => {
  it('guardar el resultado de la edición apaga la bandera', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);
    await startEdit(versionId);

    await db.query(`SELECT save_draft_content($1, $2::jsonb)`, [
      versionId,
      JSON.stringify({ summary: 'editada por IA', days: [], warnings: [] }),
    ]);

    expect(await awaiting(versionId)).toBe(false);
  });
});

describe('version_for_action trae edit_count', () => {
  it('para decidir si «✏️ Editar» pregunta o sugiere regenerar', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { versionId } = await draftConEvaluacion(trainerId);
    await db.query(`UPDATE workout_versions SET edit_count = 3 WHERE id = $1`, [versionId]);

    const { rows } = await db.query(`SELECT * FROM version_for_action($1)`, [versionId]);

    expect(rows[0].edit_count).toBe(3);
  });
});
