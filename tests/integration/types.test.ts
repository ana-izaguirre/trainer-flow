/**
 * SPEC-000 / CA-7 — los tipos generados coinciden con el esquema real.
 *
 * `database.types.ts` lo genera el CLI de Supabase y NUNCA se edita a mano.
 * Generarlo necesita Docker; CI lo tiene y lo regenera en cada run (ci.yml,
 * «database.types.ts matches the migrations»). Si difiere, ese paso falla y
 * sube el archivo correcto como artefacto `database-types`.
 *
 * Este test es la versión SIN Docker del mismo guardián: más gruesa (busca
 * nombres, no compara byte a byte), pero corre en cualquier sitio donde
 * corran los tests de integración.
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

  it('declara todas las tablas', async () => {
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

  it('declara todos los valores de todos los enums', async () => {
    // Antes miraba solo `plan_state`, un enum que ya no es el modelo de
    // estados (hoy es `version_state`). Recorrerlos todos evita repetirlo.
    const { rows } = await db.query<{ typname: string; enumlabel: string }>(
      `SELECT t.typname, e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'`,
    );

    expect(rows.length, 'el esquema debería tener enums').toBeGreaterThan(0);

    for (const { typname, enumlabel } of rows) {
      expect(types, `falta ${typname}.${enumlabel} en los tipos`).toContain(`"${enumlabel}"`);
    }
  });
});

describe.skipIf(typesExist)('CA-7 — pendiente', () => {
  it('database.types.ts todavía no se ha generado', () => {
    // Sin Docker no se puede generar aquí. CI lo genera y, si falta, lo sube
    // como artefacto `database-types`: se descarga y se versiona.
    expect(typesExist).toBe(false);
  });
});
