/**
 * E2E-2 y E2E-3 — La IA de extremo a extremo, y su degradación.
 *
 * Igual que E2E-1: piezas reales contra PostgreSQL real. Lo único sustituido
 * es el proveedor de IA, que es precisamente CA-9 — un `AIProvider` de prueba
 * se inyecta y todo funciona sin tocar una línea de `_core`.
 *
 * ┌─ EL ASSERT QUE IMPORTA ────────────────────────────────────────────────┐
 * │ En E2E-2 se asevera que lo que recibe el cliente NO es lo que devolvió │
 * │ el proveedor. Es el principio de producto convertido en test: la IA    │
 * │ propone, el entrenador decide, y lo que sale lleva su mano encima.     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { generateVersion } from '../../supabase/functions/_core/ai/generate-version.ts';
import type { GenerateDeps } from '../../supabase/functions/_core/ai/generate-version.ts';
import type { AIProvider, AIResult } from '../../supabase/functions/_core/ports/ai-provider.ts';
import type { TelegramSender } from '../../supabase/functions/_core/ports/telegram-ports.ts';
import { applyEditorCommand, parseEditorCommand } from '../../supabase/functions/_core/editor/commands.ts';
import { applyTemplate, templatesFor } from '../../supabase/functions/_core/templates.ts';
import { validateDraft } from '../../supabase/functions/_core/domain/validate-draft.ts';
import type { Workout } from '../../supabase/functions/_core/domain/workout.ts';

import { connect, createProfile, resetTestDatabase, sendVersion, transition, truncateAll } from '../helpers/db.ts';
import { createTestGenerationRepo } from '../helpers/generation-repo.ts';

let db: Client;

beforeAll(async () => {
  await resetTestDatabase();
  db = await connect();
}, 60_000);

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

// ---------------------------------------------------------------------------

/** Lo que devolvería el proveedor: correcto, pero mejorable. */
const RESPUESTA_DE_LA_IA = {
  summary: 'Rutina de fuerza en 2 días',
  days: [
    {
      dayNumber: 1,
      focus: 'Empuje',
      exercises: [
        { name: 'Press banca', sets: 4, reps: '8', restSeconds: 120, notes: null },
        { name: 'Fondos', sets: 3, reps: '10', restSeconds: 90, notes: null },
      ],
    },
    {
      dayNumber: 2,
      focus: 'Tirón',
      exercises: [{ name: 'Remo con barra', sets: 4, reps: '8', restSeconds: 120, notes: null }],
    },
  ],
  warnings: [],
};

async function nuevaVersion(trainerId: string, overrides: Record<string, unknown> = {}) {
  const v = {
    dias: 2,
    limitaciones: false,
    detalle: null as string | null,
    ...overrides,
  };

  const { rows } = await db.query<{ version_id: string; client_id: string }>(
    `SELECT * FROM ingest_assessment(
       $1::uuid, 'Carlos'::text, 'token_de_32_caracteres_exactos_a'::text, '{}'::jsonb,
       'Fuerza'::text, 'intermediate'::text, $2::smallint, 60::smallint, 'Barra'::text,
       $3::boolean, $4::text, null::text, null::text, null::uuid
     )`,
    [trainerId, v.dias, v.limitaciones, v.detalle],
  );
  return rows[0]!;
}

function deps(db_: Client, respuesta: AIResult, avisos: string[]): GenerateDeps {
  const provider: AIProvider = {
    name: 'proveedor-de-prueba',
    model: 'modelo-de-prueba',
    generate: () => Promise.resolve(respuesta),
  };

  const sender: TelegramSender = {
    sendMessage: (chatId, text) => {
      avisos.push(`${chatId}:${text}`);
      return Promise.resolve();
    },
    answerCallback: () => Promise.resolve(),
  };

  return {
    repo: createTestGenerationRepo(db_, '11111111-2222-3333-4444-555555555555'),
    provider,
    sender,
    rateLimit: { maxCalls: 10, windowMinutes: 60 },
    newTimeoutSignal: () => new AbortController().signal,
    now: () => new Date(),
  };
}

async function leerVersion(versionId: string) {
  const { rows } = await db.query<{ state: string; content: Workout | null; sent_at: Date | null }>(
    `SELECT state, content, sent_at FROM workout_versions WHERE id = $1`,
    [versionId],
  );
  return rows[0]!;
}

// ---------------------------------------------------------------------------

describe('E2E-2 — rutina con IA, editada antes de salir', () => {
  it('generar → editar → aprobar → enviar, y llega lo EDITADO', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { version_id } = await nuevaVersion(trainerId);
    const avisos: string[] = [];

    // ── 1. La IA propone ────────────────────────────────────────────────
    const outcome = await generateVersion(
      version_id,
      deps(db, {
        ok: true,
        draft: { source: 'ai', raw: RESPUESTA_DE_LA_IA },
        usage: { tokensIn: 300, tokensOut: 800 },
      }, avisos),
    );

    expect(outcome).toEqual({ kind: 'generated', versionId: version_id });
    expect((await leerVersion(version_id)).state).toBe('DRAFT');

    // ── 2. El entrenador edita ──────────────────────────────────────────
    const guardada = (await leerVersion(version_id)).content!;
    const comando = parseEditorCommand('add', '1 Press militar 3x10 90s');
    expect(comando.ok).toBe(true);
    if (!comando.ok) return;

    const editada = applyEditorCommand(guardada, comando.command);
    expect(editada.ok).toBe(true);
    if (!editada.ok) return;

    await db.query(`UPDATE workout_versions SET content = $2 WHERE id = $1`, [
      version_id,
      JSON.stringify(editada.workout),
    ]);
    await transition(db, version_id, 'DRAFT', 'DRAFT', 'trainer');

    // ── 3. Aprobar y enviar ─────────────────────────────────────────────
    await sendVersion(db, version_id);

    const final = await leerVersion(version_id);
    expect(final.state).toBe('SENT');
    expect(final.sent_at).not.toBeNull();

    // ── EL ASSERT QUE IMPORTA ───────────────────────────────────────────
    // Lo que recibe el cliente NO es lo que devolvió el proveedor.
    expect(final.content).not.toEqual(RESPUESTA_DE_LA_IA);
    expect(JSON.stringify(final.content)).toContain('Press militar');
  });

  it('la llamada queda registrada con sus tokens y su latencia', async () => {
    // CA-7: toda generación deja rastro. Sin eso el consumo de cuota es
    // invisible hasta que se agota.
    const trainerId = await createProfile(db, 'trainer');
    const { version_id } = await nuevaVersion(trainerId);

    await generateVersion(
      version_id,
      deps(db, {
        ok: true,
        draft: { source: 'ai', raw: RESPUESTA_DE_LA_IA },
        usage: { tokensIn: 300, tokensOut: 800 },
      }, []),
    );

    const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM ai_generations`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'SUCCEEDED',
      provider: 'proveedor-de-prueba',
      tokens_in: 300,
      tokens_out: 800,
    });
    expect(rows[0]!['latency_ms']).not.toBeNull();
  });

  it('una rutina con más días de los pedidos NO llega al cliente', async () => {
    // CA-4. La IA no decide cuántos días entrena el cliente.
    const trainerId = await createProfile(db, 'trainer');
    const { version_id } = await nuevaVersion(trainerId, { dias: 2 });

    const tresDias = {
      ...RESPUESTA_DE_LA_IA,
      days: [...RESPUESTA_DE_LA_IA.days, { ...RESPUESTA_DE_LA_IA.days[0], dayNumber: 3 }],
    };

    const outcome = await generateVersion(
      version_id,
      deps(db, {
        ok: true,
        draft: { source: 'ai', raw: tresDias },
        usage: { tokensIn: 1, tokensOut: 1 },
      }, []),
    );

    expect(outcome).toEqual({ kind: 'generation_failed', reason: 'INVALID_OUTPUT' });

    const final = await leerVersion(version_id);
    expect(final.state).toBe('NEW');
    expect(final.content).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('E2E-3 — la IA falla y el producto sigue', () => {
  it('429 → vuelve a NEW → plantilla → aprobar → enviar', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { version_id } = await nuevaVersion(trainerId);
    const avisos: string[] = [];

    // ── 1. El proveedor no tiene cuota ──────────────────────────────────
    const outcome = await generateVersion(
      version_id,
      deps(db, { ok: false, reason: 'RATE_LIMITED', detail: '429' }, avisos),
    );

    expect(outcome).toEqual({ kind: 'generation_failed', reason: 'RATE_LIMITED' });

    // ── 2. La versión vuelve a NEW: no está muerta ──────────────────────
    expect((await leerVersion(version_id)).state).toBe('NEW');

    // ── 3. El entrenador se entera, y con la alternativa ────────────────
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.toLowerCase()).toMatch(/plantilla|manual/);

    // ── 4. Sigue por plantilla, sobre la MISMA versión ──────────────────
    const plantilla = templatesFor({ daysPerWeek: 2 })[0]!;
    const draft = applyTemplate(plantilla, { daysPerWeek: plantilla.daysPerWeek, hasLimitations: false });
    const validado = validateDraft(draft, { daysPerWeek: plantilla.daysPerWeek, hasLimitations: false });

    expect(validado.ok).toBe(true);
    if (!validado.ok) return;

    // El CHECK exige que `template_id` exista si y solo si el origen es una
    // plantilla: no se puede decir «viene de plantilla» sin decir de cuál.
    await db.query(
      `UPDATE workout_versions SET content = $2, source = 'template', template_id = $3 WHERE id = $1`,
      [version_id, JSON.stringify(validado.workout), plantilla.id],
    );
    await transition(db, version_id, 'NEW', 'DRAFT', 'trainer');

    // ── 5. Y publica ────────────────────────────────────────────────────
    await sendVersion(db, version_id);

    const final = await leerVersion(version_id);
    expect(final.state).toBe('SENT');
    expect(final.content).not.toBeNull();
  });

  it('el fallo queda registrado con su motivo, fuera del enum del dominio', async () => {
    const trainerId = await createProfile(db, 'trainer');
    const { version_id } = await nuevaVersion(trainerId);

    await generateVersion(
      version_id,
      deps(db, { ok: false, reason: 'RATE_LIMITED', detail: '429' }, []),
    );

    const { rows } = await db.query<{ status: string; failure_reason: string }>(
      `SELECT status, failure_reason FROM ai_generations`,
    );

    expect(rows).toHaveLength(1);
    // El motivo Y su detalle: `API_ERROR` a secas mete un 404 de modelo
    // retirado y un 403 de clave sin permisos en la misma casilla.
    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.failure_reason).toContain('RATE_LIMITED');

    // El motivo vive en ai_generations, NO en version_state: el estado del
    // dominio no sabe de proveedores.
    const { rows: estados } = await db.query<{ state: string }>(
      `SELECT state FROM workout_versions WHERE id = $1`,
      [version_id],
    );
    expect(estados[0]!.state).toBe('NEW');
  });

  it('sin margen de cuota NO se llama al proveedor, y la versión ni se toca', async () => {
    // CA-2. El rate limit existe para no gastar la llamada.
    const trainerId = await createProfile(db, 'trainer');
    const { version_id } = await nuevaVersion(trainerId);
    const avisos: string[] = [];

    // La ventana llena, contada sobre filas reales de `ai_generations`.
    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `INSERT INTO ai_generations (provider, model, operation, status)
         VALUES ('x', 'y', 'generate', 'SUCCEEDED')`,
      );
    }

    let llamadas = 0;
    const base = deps(db, { ok: false, reason: 'API_ERROR', detail: 'x' }, avisos);
    const outcome = await generateVersion(version_id, {
      ...base,
      rateLimit: { maxCalls: 3, windowMinutes: 60 },
      provider: {
        ...base.provider,
        generate: () => {
          llamadas += 1;
          return Promise.resolve({ ok: false, reason: 'API_ERROR', detail: 'x' } as AIResult);
        },
      },
    });

    expect(outcome.kind).toBe('rate_limited');
    expect(llamadas).toBe(0);
    expect((await leerVersion(version_id)).state).toBe('NEW');
    expect(avisos).toHaveLength(1);

    // No se registró una cuarta fila: no hubo llamada que registrar.
    const { rows } = await db.query<{ count: string }>(`SELECT count(*) FROM ai_generations`);
    expect(rows[0]!.count).toBe('3');
  });
});
