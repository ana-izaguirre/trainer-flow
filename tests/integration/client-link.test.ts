/**
 * SPEC-005 — El canje del deep link y la entrega, contra PostgreSQL.
 *
 * ┌─ LO QUE ESTOS TESTS PROTEGEN ──────────────────────────────────────────┐
 * │ Que las garantías sean DE LA BASE y no de un `if` de la aplicación.    │
 * │ Una comprobación previa la pasan las dos peticiones simultáneas; un    │
 * │ UNIQUE, no. Por eso aquí se llama a las funciones de verdad y se mira  │
 * │ que devuelvan `false` en vez de reventar.                              │
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

/** Un cliente con un token conocido, para poder canjearlo después. */
async function clienteConToken(trainerId: string, token: string, nombre = 'Carlos Pérez') {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token)
     VALUES ($1, $2, $3) RETURNING id`,
    [trainerId, nombre, token],
  );
  return rows[0]!.id;
}

async function ensureProfile(telegramUserId: number, nombre: string): Promise<string | null> {
  const { rows } = await db.query<{ ensure_client_profile: string | null }>(
    `SELECT ensure_client_profile($1, $1, $2)`,
    [telegramUserId, nombre],
  );
  return rows[0]!.ensure_client_profile;
}

async function link(clientId: string, profileId: string): Promise<boolean> {
  const { rows } = await db.query<{ link_client: boolean }>(`SELECT link_client($1, $2)`, [
    clientId,
    profileId,
  ]);
  return rows[0]!.link_client;
}

const TOKEN = 'token_de_32_caracteres_exactos_a';

// ---------------------------------------------------------------------------

describe('client_for_link', () => {
  it('trae la ficha y el chat del entrenador', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);

    const { rows } = await db.query(`SELECT * FROM client_for_link($1)`, [TOKEN]);

    expect(rows[0]).toMatchObject({
      client_id: clientId,
      full_name: 'Carlos Pérez',
      linked_profile_id: null,
      linked_telegram_user_id: null,
    });
    expect(rows[0].trainer_chat_id).not.toBeNull();
  });

  it('un token inexistente no devuelve NADA', async () => {
    // CA-5: no se puede enumerar clientes probando tokens.
    const { rows } = await db.query(`SELECT * FROM client_for_link($1)`, ['no_existe_este_token_x']);
    expect(rows).toHaveLength(0);
  });

  it('una vez canjeado, dice QUIÉN lo canjeó', async () => {
    // Es lo que permite distinguir «vuelve el mismo» de «viene otro» SIN
    // crear antes su perfil.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const profileId = (await ensureProfile(500, 'Carlos Pérez'))!;
    await link(clientId, profileId);

    const { rows } = await db.query(`SELECT * FROM client_for_link($1)`, [TOKEN]);

    expect(rows[0].linked_telegram_user_id).toBe('500');
  });
});

describe('ensure_client_profile', () => {
  it('crea el perfil con rol client y el nombre de la FICHA', async () => {
    // CA-9. El nombre nunca sale del `first_name` de Telegram.
    const profileId = await ensureProfile(500, 'Carlos Pérez');

    const { rows } = await db.query(`SELECT role, full_name FROM profiles WHERE id = $1`, [
      profileId,
    ]);
    expect(rows[0]).toEqual({ role: 'client', full_name: 'Carlos Pérez' });
  });

  it('llamarla dos veces devuelve el MISMO perfil', async () => {
    const primero = await ensureProfile(500, 'Carlos Pérez');
    const segundo = await ensureProfile(500, 'Carlos Pérez');

    expect(segundo).toBe(primero);
    const { rows } = await db.query(`SELECT count(*) FROM profiles WHERE telegram_user_id = 500`);
    expect(rows[0].count).toBe('1');
  });

  it('un ENTRENADOR no se convierte en cliente', async () => {
    // CA-10. Devuelve NULL y su rol no cambia.
    await db.query(
      `INSERT INTO profiles (telegram_user_id, telegram_chat_id, role, full_name)
       VALUES (900, 900, 'trainer', 'Ana')`,
    );

    expect(await ensureProfile(900, 'Carlos Pérez')).toBeNull();

    const { rows } = await db.query(`SELECT role FROM profiles WHERE telegram_user_id = 900`);
    expect(rows[0].role).toBe('trainer');
  });

  it('refresca el chat si la persona cambió de dispositivo', async () => {
    const profileId = await ensureProfile(500, 'Carlos Pérez');
    await db.query(`SELECT ensure_client_profile(500, 777, 'Carlos Pérez')`);

    const { rows } = await db.query(`SELECT telegram_chat_id FROM profiles WHERE id = $1`, [
      profileId,
    ]);
    expect(rows[0].telegram_chat_id).toBe('777');
  });
});

describe('link_client', () => {
  it('ata la ficha y deja fecha', async () => {
    // CA-1.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const profileId = (await ensureProfile(500, 'Carlos Pérez'))!;

    expect(await link(clientId, profileId)).toBe(true);

    const { rows } = await db.query(`SELECT profile_id, linked_at FROM clients WHERE id = $1`, [
      clientId,
    ]);
    expect(rows[0].profile_id).toBe(profileId);
    expect(rows[0].linked_at).not.toBeNull();
  });

  it('volver a abrir el propio enlace NO reescribe la fecha', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const profileId = (await ensureProfile(500, 'Carlos Pérez'))!;

    await link(clientId, profileId);
    const { rows: antes } = await db.query(`SELECT linked_at FROM clients WHERE id = $1`, [
      clientId,
    ]);

    expect(await link(clientId, profileId)).toBe(true);
    const { rows: despues } = await db.query(`SELECT linked_at FROM clients WHERE id = $1`, [
      clientId,
    ]);

    expect(despues[0].linked_at).toEqual(antes[0].linked_at);
  });

  it('una persona NO puede vincularse a dos fichas', async () => {
    // Regla 10. La garantía es el UNIQUE, y se devuelve false en vez de
    // reventar: una comprobación previa la pasarían dos peticiones a la vez.
    const trainerId = await createProfile(db, 'trainer');
    const carlos = await clienteConToken(trainerId, TOKEN);
    const lucia = await clienteConToken(trainerId, 'otro_token_de_32_caracteres_ab', 'Lucía');
    const profileId = (await ensureProfile(500, 'Carlos Pérez'))!;

    await link(carlos, profileId);

    expect(await link(lucia, profileId)).toBe(false);
    const { rows } = await db.query(`SELECT profile_id FROM clients WHERE id = $1`, [lucia]);
    expect(rows[0].profile_id).toBeNull();
  });

  it('nadie puede robar una ficha ya vinculada', async () => {
    // CA-6, en la base.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const carlos = (await ensureProfile(500, 'Carlos Pérez'))!;
    const otro = (await ensureProfile(700, 'Otro'))!;

    await link(clientId, carlos);

    expect(await link(clientId, otro)).toBe(false);
    const { rows } = await db.query(`SELECT profile_id FROM clients WHERE id = $1`, [clientId]);
    expect(rows[0].profile_id).toBe(carlos);
  });
});

describe('version_for_delivery', () => {
  it('trae la rutina con el chat del cliente y el del entrenador', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const profileId = (await ensureProfile(500, 'Carlos Pérez'))!;
    await link(clientId, profileId);

    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);
    const versionId = await createVersion(db, planId, 'ai', trainerId, {
      summary: 'Fuerza',
      days: [],
      warnings: [],
    });

    const { rows } = await db.query(`SELECT * FROM version_for_delivery($1)`, [versionId]);

    expect(rows[0]).toMatchObject({
      version_id: versionId,
      client_name: 'Carlos Pérez',
      client_chat_id: '500',
      goal: 'Ganancia muscular',
      days_per_week: 4,
      session_minutes: 60,
    });
  });

  it('un cliente SIN vincular devuelve la fila igual, con chat NULL', async () => {
    // CA-3. Con un INNER JOIN la rutina desaparecería y el entrenador no
    // podría enterarse de que sigue pendiente.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);
    const versionId = await createVersion(db, planId, 'ai', trainerId, {
      summary: 'Fuerza',
      days: [],
      warnings: [],
    });

    const { rows } = await db.query(`SELECT * FROM version_for_delivery($1)`, [versionId]);

    expect(rows).toHaveLength(1);
    expect(rows[0].client_chat_id).toBeNull();
    expect(rows[0].trainer_chat_id).not.toBeNull();
  });

  it('una rutina SIN evaluación devuelve la fila, con objetivo NULL', async () => {
    // CA-13, regla 13. Una manual o de plantilla no tiene formulario detrás.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const planId = await createPlan(db, clientId, null);
    const versionId = await createVersion(db, planId, 'manual', trainerId, {
      summary: 'Full body',
      days: [],
      warnings: [],
    });

    const { rows } = await db.query(`SELECT * FROM version_for_delivery($1)`, [versionId]);

    expect(rows).toHaveLength(1);
    expect(rows[0].goal).toBeNull();
    expect(rows[0].client_name).toBe('Carlos Pérez');
  });
});

describe('approved_version_for_client', () => {
  it('encuentra la que espera entrega diferida', async () => {
    // CA-4.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const assessmentId = await createAssessment(db, clientId);
    const planId = await createPlan(db, clientId, assessmentId);
    const versionId = await createVersion(db, planId, 'ai', trainerId, {
      summary: 'Fuerza',
      days: [],
      warnings: [],
    });
    await transition(db, versionId, 'DRAFT', 'APPROVED');

    const { rows } = await db.query(`SELECT * FROM approved_version_for_client($1)`, [clientId]);

    expect(rows[0].version_id).toBe(versionId);
  });

  it('una que sigue en DRAFT no se entrega', async () => {
    // El principio: nada llega al cliente sin que el entrenador lo apruebe.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
    await createVersion(db, planId, 'ai', trainerId, { summary: 'x', days: [], warnings: [] });

    const { rows } = await db.query(`SELECT * FROM approved_version_for_client($1)`, [clientId]);

    expect(rows).toHaveLength(0);
  });

  it('una ya enviada tampoco', async () => {
    // CA-8: no se entrega dos veces.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
    const versionId = await createVersion(db, planId, 'ai', trainerId, {
      summary: 'x',
      days: [],
      warnings: [],
    });
    await transition(db, versionId, 'DRAFT', 'APPROVED');
    await transition(db, versionId, 'APPROVED', 'SENT', 'system');

    const { rows } = await db.query(`SELECT * FROM approved_version_for_client($1)`, [clientId]);

    expect(rows).toHaveLength(0);
  });
});

describe('version_for_action', () => {
  it('trae la PERTENENCIA, que es lo que decide la autorización', async () => {
    // SPEC-009 regla 8: la pertenencia se compara contra la identidad
    // resuelta del webhook, nunca contra un ID de la petición.
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await clienteConToken(trainerId, TOKEN);
    const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
    const versionId = await createVersion(db, planId, 'ai', trainerId, {
      summary: 'x',
      days: [],
      warnings: [],
    });

    const { rows } = await db.query(`SELECT * FROM version_for_action($1)`, [versionId]);

    expect(rows[0]).toMatchObject({
      version_id: versionId,
      trainer_id: trainerId,
      client_id: clientId,
      client_profile_id: null,
      state: 'DRAFT',
      version_number: 1,
    });
  });

  it('una versión que no existe no devuelve nada', async () => {
    const { rows } = await db.query(`SELECT * FROM version_for_action($1)`, [
      '00000000-0000-0000-0000-000000000000',
    ]);
    expect(rows).toHaveLength(0);
  });
});
