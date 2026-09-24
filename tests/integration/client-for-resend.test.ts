/**
 * SPEC-014 §3 — la consulta que resuelve el cliente para reenviar su enlace.
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connect,
  createPlan,
  createProfile,
  createVersion,
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

let tokenSeq = 0;

async function nuevoCliente(
  trainerId: string,
  nombre: string,
  vinculado = false,
): Promise<{ clientId: string; token: string }> {
  tokenSeq += 1;
  const token = `token_reenvio_${String(tokenSeq).padStart(10, '0')}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO clients (trainer_id, full_name, link_token) VALUES ($1, $2, $3) RETURNING id`,
    [trainerId, nombre, token],
  );
  const clientId = rows[0]!.id;

  if (vinculado) {
    const profileId = await createProfile(db, 'client', nombre);
    await db.query(`UPDATE clients SET profile_id = $1, linked_at = now() WHERE id = $2`, [
      profileId,
      clientId,
    ]);
  }

  return { clientId, token };
}

const resend = async (versionId: string) =>
  (await db.query(`SELECT * FROM client_for_resend($1)`, [versionId])).rows;

// ---------------------------------------------------------------------------

describe('client_for_resend', () => {
  it('trae el cliente, sin vincular, con su link_token', async () => {
    const t = await createProfile(db, 'trainer');
    const { clientId, token } = await nuevoCliente(t, 'Ana');
    const planId = await createPlan(db, clientId, null);
    const versionId = await createVersion(db, planId, 'ai', t, null);

    const rows = await resend(versionId);

    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBe(clientId);
    expect(rows[0].trainer_id).toBe(t);
    expect(rows[0].full_name).toBe('Ana');
    expect(rows[0].linked).toBe(false);
    expect(rows[0].link_token).toBe(token);
  });

  it('un cliente ya vinculado sale con linked=true y profile_id', async () => {
    const t = await createProfile(db, 'trainer');
    const { clientId } = await nuevoCliente(t, 'Luis', true);
    const planId = await createPlan(db, clientId, null);
    const versionId = await createVersion(db, planId, 'manual', t, {
      summary: 'x',
      days: [],
      warnings: [],
    });

    const rows = await resend(versionId);

    expect(rows[0].linked).toBe(true);
    expect(rows[0].profile_id).not.toBeNull();
  });

  it('resuelve igual desde CUALQUIER versión del mismo plan, no solo la vigente', async () => {
    // El enlace vive en el cliente, no en la versión: cualquiera de sus
    // versiones tiene que resolver al mismo cliente.
    const t = await createProfile(db, 'trainer');
    const { clientId, token } = await nuevoCliente(t, 'Marta');
    const planId = await createPlan(db, clientId, null);
    const v1 = await createVersion(db, planId, 'ai', t, null);
    await createVersion(db, planId, 'manual', t, { summary: 'v2', days: [], warnings: [] });

    // v1 ya no es la vigente (current_version_id apunta a la última creada),
    // pero sigue resolviendo al mismo cliente y al mismo token.
    const rows = await resend(v1);

    expect(rows[0].client_id).toBe(clientId);
    expect(rows[0].link_token).toBe(token);
  });

  it('una versión que no existe no devuelve nada', async () => {
    const rows = await resend('00000000-0000-0000-0000-000000000000');
    expect(rows).toHaveLength(0);
  });
});
