/**
 * E2E-1 — Rutina manual de extremo a extremo, SIN IA.
 *
 * Este es el test que prueba que el producto sirve. Recorre el camino completo
 * usando las piezas reales: las funciones SQL contra PostgreSQL, la máquina de
 * estados, la validación, el editor, la autorización y el formateo.
 *
 * ┌─ QUÉ CUBRE Y QUÉ NO ───────────────────────────────────────────────────┐
 * │ SÍ: el flujo de dominio completo contra una base de datos real.        │
 * │ NO: el transporte HTTP ni la API de Telegram.                          │
 * │                                                                        │
 * │ Levantar las Edge Functions necesita PostgREST, que a su vez necesita  │
 * │ el stack de Supabase. El handler está verificado por `deno check`; lo  │
 * │ que este test prueba es todo lo que hay por debajo.                    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { canViewVersion } from '../../supabase/functions/_core/authorization.ts';
import type { Identity } from '../../supabase/functions/_core/domain/identity.ts';
import type { ClientRef, VersionRef } from '../../supabase/functions/_core/domain/version.ts';
import { nextState } from '../../supabase/functions/_core/domain/state-machine.ts';
import { validateDraft } from '../../supabase/functions/_core/domain/validate-draft.ts';
import type { Workout } from '../../supabase/functions/_core/domain/workout.ts';
import { applyEditorCommand, parseEditorCommand } from '../../supabase/functions/_core/editor/commands.ts';
import { applyTemplate, templatesFor } from '../../supabase/functions/_core/templates.ts';
import { formatWorkout, splitMessage, TELEGRAM_MAX_MESSAGE } from '../../supabase/functions/_core/telegram/format.ts';

import {
  connect,
  createClient,
  createPlan,
  createProfile,
  createVersion,
  linkClient,
  readVersion,
  resetTestDatabase,
  saveVersionContent,
  transition,
  truncateAll,
} from '../helpers/db.ts';

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

/** Ejecuta un comando del editor como lo haría el handler de Telegram. */
function editar(workout: Workout, comando: string, args: string): Workout {
  const parsed = parseEditorCommand(comando, args);
  if (!parsed.ok) throw new Error(`El comando /${comando} falló: ${parsed.error}`);

  const applied = applyEditorCommand(workout, parsed.command);
  if (!applied.ok) throw new Error(`Aplicar /${comando} falló: ${applied.error}`);

  return applied.workout;
}

describe('E2E-1 — el entrenador crea, edita, aprueba y envía una rutina sin IA', () => {
  it('recorre el flujo completo y el cliente recibe la versión publicada', async () => {
    // ─────────────────────────────────────────────────────────────────────
    // 1. El entrenador y su cliente. SIN evaluación de Tally: el camino
    //    manual no necesita formulario.
    // ─────────────────────────────────────────────────────────────────────
    const trainerProfileId = await createProfile(db, 'trainer', 'Entrenador');
    const clientProfileId = await createProfile(db, 'client', 'Carlos Pérez');
    const clientId = await createClient(db, trainerProfileId, 'Carlos Pérez');
    const planId = await createPlan(db, clientId, null);

    const { rows: planRows } = await db.query<{ assessment_id: string | null }>(
      `SELECT assessment_id FROM workout_plans WHERE id = $1`,
      [planId],
    );
    expect(planRows[0]?.assessment_id, 'una rutina manual no necesita evaluación').toBeNull();

    // ─────────────────────────────────────────────────────────────────────
    // 2. Elige una plantilla. Sin criterios de evaluación, se listan todas.
    // ─────────────────────────────────────────────────────────────────────
    const plantillas = templatesFor({ daysPerWeek: 3, level: 'beginner' });
    const plantilla = plantillas[0]!;
    expect(plantilla.daysPerWeek).toBe(3);

    const draft = applyTemplate(plantilla, null);
    expect(draft.source).toBe('template');

    const validado = validateDraft(draft, null);
    expect(validado.ok, 'la plantilla debe pasar la misma validación que la IA').toBe(true);
    if (!validado.ok) return;

    // ─────────────────────────────────────────────────────────────────────
    // 3. Se crea la versión. `create_workout_version` es atómica: versión,
    //    current_version_id y evento, todo o nada.
    // ─────────────────────────────────────────────────────────────────────
    const versionId = await createVersion(
      db,
      planId,
      'template',
      trainerProfileId,
      validado.workout,
      plantilla.id,
    );

    let version = await readVersion(db, versionId);
    expect(version.state).toBe('DRAFT');
    expect(version.version_number).toBe(1);

    const { rows: currentRows } = await db.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM workout_plans WHERE id = $1`,
      [planId],
    );
    expect(currentRows[0]?.current_version_id).toBe(versionId);

    // ─────────────────────────────────────────────────────────────────────
    // 4. El entrenador la ajusta desde Telegram.
    // ─────────────────────────────────────────────────────────────────────
    let workout = validado.workout;
    const ejerciciosDia1 = workout.days[0]!.exercises.length;

    workout = editar(workout, 'add', '1 Face pull 3x15 60');
    workout = editar(workout, 'nota', '1 1 Bajar despacio');
    workout = editar(workout, 'dia', '1 Empuje y hombro');

    expect(workout.days[0]?.exercises).toHaveLength(ejerciciosDia1 + 1);
    expect(workout.days[0]?.focus).toBe('Empuje y hombro');
    expect(workout.days[0]?.exercises[0]?.notes).toBe('Bajar despacio');

    // Lo editado se vuelve a validar. Una rutina manual no tiene barra libre.
    const revalidado = validateDraft({ source: 'manual', raw: workout }, null);
    expect(revalidado.ok, 'lo editado debe seguir siendo válido').toBe(true);
    if (!revalidado.ok) return;

    await saveVersionContent(db, versionId, revalidado.workout);

    // ─────────────────────────────────────────────────────────────────────
    // 5. Lo que el entrenador ve en el móvil cabe en mensajes de Telegram.
    // ─────────────────────────────────────────────────────────────────────
    const mensaje = formatWorkout(revalidado.workout, {
      clientName: 'Carlos Pérez',
      versionNumber: version.version_number,
    });
    const trozos = splitMessage(mensaje);

    expect(trozos.length).toBeGreaterThan(0);
    for (const trozo of trozos) {
      expect(trozo.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
    }
    expect(mensaje).toContain('Face pull');

    // ─────────────────────────────────────────────────────────────────────
    // 6. 🔴 Antes de aprobar, el cliente NO puede ver nada.
    // ─────────────────────────────────────────────────────────────────────
    const clientRef: ClientRef = { clientId, trainerId: trainerProfileId, profileId: clientProfileId };
    const clientIdentity: Identity = {
      profileId: clientProfileId,
      role: 'client',
      telegramUserId: 2,
      telegramChatId: 2,
    };
    const enBorrador: VersionRef = { versionId, state: 'DRAFT', client: clientRef };

    expect(canViewVersion(clientIdentity, enBorrador)).toEqual({
      allowed: false,
      reason: 'VERSION_NOT_VISIBLE',
    });

    // ─────────────────────────────────────────────────────────────────────
    // 7. El entrenador aprueba. La transición pasa por la máquina de estados.
    // ─────────────────────────────────────────────────────────────────────
    expect(nextState('DRAFT', 'APPROVE')).toBe('APPROVED');
    expect(await transition(db, versionId, 'DRAFT', 'APPROVED', 'trainer')).toBe(true);

    version = await readVersion(db, versionId);
    expect(version.state).toBe('APPROVED');
    expect(version.sent_at, 'aprobada no es enviada').toBeNull();

    // ─────────────────────────────────────────────────────────────────────
    // 8. El cliente se vincula por el deep link, y recién entonces se envía.
    // ─────────────────────────────────────────────────────────────────────
    await linkClient(db, clientId, clientProfileId);

    expect(nextState('APPROVED', 'SEND')).toBe('SENT');
    expect(await transition(db, versionId, 'APPROVED', 'SENT', 'system')).toBe(true);

    version = await readVersion(db, versionId);
    expect(version.state).toBe('SENT');
    expect(version.sent_at).not.toBeNull();

    // ─────────────────────────────────────────────────────────────────────
    // 9. ✅ Ahora sí: el cliente ve su rutina publicada.
    // ─────────────────────────────────────────────────────────────────────
    const enviada: VersionRef = { versionId, state: 'SENT', client: clientRef };
    expect(canViewVersion(clientIdentity, enviada)).toEqual({ allowed: true });

    expect(version.content).toMatchObject({ days: expect.any(Array) });

    // ─────────────────────────────────────────────────────────────────────
    // 10. 🎯 LA ASERCIÓN QUE DA SENTIDO A TODO EL TEST
    //     Ni una sola llamada a la IA en todo el recorrido.
    // ─────────────────────────────────────────────────────────────────────
    const { rows: iaRows } = await db.query<{ count: string }>(
      `SELECT count(*) FROM ai_generations`,
    );
    expect(iaRows[0]?.count, 'el producto funciona sin IA').toBe('0');

    // ─────────────────────────────────────────────────────────────────────
    // 11. El audit trail cuenta la historia completa.
    // ─────────────────────────────────────────────────────────────────────
    const { rows: eventos } = await db.query<{
      from_state: string | null;
      to_state: string;
      actor: string;
    }>(
      `SELECT from_state, to_state, actor FROM plan_events
       WHERE version_id = $1 ORDER BY id`,
      [versionId],
    );

    expect(eventos).toEqual([
      { from_state: null, to_state: 'DRAFT', actor: 'trainer' },
      { from_state: 'DRAFT', to_state: 'APPROVED', actor: 'trainer' },
      { from_state: 'APPROVED', to_state: 'SENT', actor: 'system' },
    ]);
  }, 30_000);

  it('una rutina enviada ya no se puede modificar', async () => {
    const trainerProfileId = await createProfile(db, 'trainer');
    const clientId = await createClient(db, trainerProfileId);
    const planId = await createPlan(db, clientId, null);

    const plantilla = templatesFor({})[0]!;
    const validado = validateDraft(applyTemplate(plantilla, null), null);
    if (!validado.ok) throw new Error('la plantilla no valida');

    const versionId = await createVersion(
      db, planId, 'template', trainerProfileId, validado.workout, plantilla.id,
    );

    await transition(db, versionId, 'DRAFT', 'APPROVED', 'trainer');
    await transition(db, versionId, 'APPROVED', 'SENT', 'system');

    // SENT es terminal: la máquina de estados no ofrece ninguna salida.
    for (const evento of ['APPROVE', 'REJECT', 'EDIT', 'SEND'] as const) {
      expect(nextState('SENT', evento), evento).toBeNull();
    }

    // Y aunque alguien lo intentara saltándose la máquina, la guarda de
    // concurrencia de la función SQL lo rechaza.
    expect(await transition(db, versionId, 'DRAFT', 'APPROVED', 'trainer')).toBe(false);
  }, 30_000);

  it('el camino manual no depende de que exista ninguna plantilla en la base', async () => {
    // Las plantillas viven en el binario: esta consulta lo demuestra.
    const { rows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%template%'`,
    );

    expect(rows, 'no hay ninguna tabla de plantillas, y aun así funcionan').toEqual([]);
    expect(templatesFor({}).length).toBeGreaterThan(0);
  });
});
