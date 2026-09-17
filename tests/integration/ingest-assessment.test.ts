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

// ---------------------------------------------------------------------------

describe('trazabilidad de extremo a extremo', () => {
  it('un request_id cruza el webhook y el evento del plan', async () => {
    // Es el criterio de S-26: poder seguir UNA petición desde que entra hasta
    // lo que dejó escrito. Sin esto, «llegó una evaluación y algo pasó» no se
    // puede reconstruir.
    const trainerId = await createProfile(db, 'trainer');
    const requestId = '11111111-2222-3333-4444-555555555555';

    await db.query(
      `INSERT INTO webhook_events (source, external_id, payload, request_id)
       VALUES ('tally', 'evt-1', '{}'::jsonb, $1)`,
      [requestId],
    );

    const { rows } = await db.query<Ids>(
      // Los tipos van explícitos: con catorce argumentos posicionales
      // Postgres no puede resolver la sobrecarga solo.
      `SELECT * FROM ingest_assessment(
         $1::uuid, 'Carlos'::text, 'token_de_32_caracteres_exactos_a'::text, '{}'::jsonb,
         'Fuerza'::text, 'beginner'::text, 4::smallint, 60::smallint, 'Mancuernas'::text,
         false, null::text, null::text, null::text, $2::uuid
       )`,
      [trainerId, requestId],
    );

    const { rows: rastro } = await db.query<{ tabla: string }>(
      `SELECT 'webhook_events' AS tabla FROM webhook_events WHERE request_id = $1
       UNION ALL
       SELECT 'plan_events' FROM plan_events WHERE request_id = $1`,
      [requestId],
    );

    expect(rastro.map((r) => r.tabla).toSorted()).toEqual(['plan_events', 'webhook_events']);
    expect(rows[0]!.plan_id).toBeTruthy();
  });

  it('el detalle de salud NO viaja al evento del plan', async () => {
    // plan_events.metadata es lo que más se mira al depurar. Si el detalle de
    // una lesión acabara ahí, estaría en todas partes.
    const trainerId = await createProfile(db, 'trainer');

    await ingest(trainerId, { limitaciones: true, detalle: 'molestia de rodilla derecha' });

    const { rows } = await db.query<{ todo: string }>(
      `SELECT coalesce(string_agg(metadata::text, ' '), '') AS todo FROM plan_events`,
    );

    expect(rows[0]!.todo).not.toContain('rodilla');
  });
});

// ---------------------------------------------------------------------------

describe('version_for_generation', () => {
  async function versionDe(trainerId: string, overrides: Record<string, unknown> = {}) {
    const ids = await ingest(trainerId, overrides);
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM version_for_generation($1)`,
      [ids.version_id],
    );
    return rows[0];
  }

  it('reúne versión, evaluación y entrenador en una consulta', async () => {
    const trainerId = await createProfile(db, 'trainer');

    const fila = await versionDe(trainerId);

    expect(fila).toMatchObject({
      state: 'NEW',
      goal: 'Fuerza',
      level: 'beginner',
      days_per_week: 4,
      session_minutes: 60,
      equipment: 'Mancuernas',
      has_limitations: false,
    });
  });

  it('trae el chat del entrenador, que es a donde va el aviso si algo falla', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { rows } = await db.query<{ telegram_chat_id: string }>(
      `SELECT telegram_chat_id FROM profiles WHERE id = $1`,
      [trainerId],
    );

    const fila = await versionDe(trainerId);

    expect(String(fila!['trainer_chat_id'])).toBe(rows[0]!.telegram_chat_id);
  });

  it('el detalle de la limitación llega cuando el cliente la declaró', async () => {
    // Va al prompt. Si no llegara, la rutina no la tendría en cuenta.
    const trainerId = await createProfile(db, 'trainer');

    const fila = await versionDe(trainerId, { limitaciones: true, detalle: 'Rodilla derecha' });

    expect(fila!['limitations']).toBe('Rodilla derecha');
  });

  it('sin limitaciones declaradas, el detalle NO viaja', async () => {
    // El CHECK de la tabla ya lo impide, pero leerlo explícito evita que un
    // cambio futuro filtre un detalle huérfano al prompt.
    const trainerId = await createProfile(db, 'trainer');

    const fila = await versionDe(trainerId, { limitaciones: false, detalle: null });

    expect(fila!['limitations']).toBeNull();
  });

  it('una versión que no existe devuelve cero filas, no un error', async () => {
    const { rows } = await db.query(
      `SELECT * FROM version_for_generation('00000000-0000-0000-0000-000000000000')`,
    );
    expect(rows).toHaveLength(0);
  });

  it('anon no puede invocarla', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const ids = await ingest(trainerId);
    await db.query('SET ROLE anon');

    let code: string | undefined;
    try {
      await db.query(`SELECT * FROM version_for_generation($1)`, [ids.version_id]);
    } catch (error) {
      code = pgErrorCode(error);
    } finally {
      await db.query('RESET ROLE');
    }

    expect(code).toBe(PG.INSUFFICIENT_PRIVILEGE);
  });
});
