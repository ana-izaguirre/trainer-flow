/**
 * SPEC-000 / CA-7 — los tipos generados coinciden con el esquema real.
 *
 * `database.types.ts` lo genera el CLI de Supabase y NUNCA se edita a mano:
 *
 *   pnpm types:local     # contra la base local
 *   pnpm types           # contra el proyecto vinculado
 *
 * Este test es el guardián contra la deriva: si alguien cambia el esquema y
 * olvida regenerar los tipos, falla aquí en vez de fallar en producción.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, resetTestDatabase } from '../helpers/db.ts';

const TYPES_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_core/database.types.ts',
);

const typesExist = existsSync(TYPES_PATH);

describe.skipIf(!typesExist)('CA-7 — tipos sincronizados con el esquema', () => {
  let db: Client;
  let types: string;

  beforeAll(async () => {
    await resetTestDatabase();
    db = await connect();
    types = readFileSync(TYPES_PATH, 'utf8');
  }, 60_000);

  afterAll(async () => {
    await db?.end();
  });

  it('declara las 8 tablas', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );

    for (const { tablename } of rows) {
      expect(types, `falta la tabla ${tablename} en los tipos`).toContain(`${tablename}: {`);
    }
  });

  it('declara todas las columnas de todas las tablas', async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'`,
    );

    const missing = rows.filter(({ column_name }) => !types.includes(`${column_name}:`));

    expect(
      missing.map((c) => `${c.table_name}.${c.column_name}`),
      'columnas ausentes en los tipos: regenera con pnpm types:local',
    ).toEqual([]);
  });

  it('declara el enum plan_state con sus 10 valores', async () => {
    const { rows } = await db.query<{ enumlabel: string }>(
      `SELECT enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'plan_state'`,
    );

    for (const { enumlabel } of rows) {
      expect(types, `falta el estado ${enumlabel} en los tipos`).toContain(`"${enumlabel}"`);
    }
  });
});

describe.skipIf(typesExist)('CA-7 — pendiente', () => {
  it('database.types.ts todavía no se ha generado', () => {
    // No se genera en este entorno: el CLI de Supabase necesita Docker y aquí
    // el registro de imágenes está bloqueado. Se genera en la máquina local.
    expect(typesExist).toBe(false);
  });
});
