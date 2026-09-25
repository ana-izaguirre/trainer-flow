/**
 * E2E-4 — El cliente pide un cambio, el entrenador entrega una v2 — y la v1
 * queda byte a byte igual.
 *
 * ┌─ QUÉ CUBRE Y QUÉ NO ───────────────────────────────────────────────────┐
 * │ SÍ: el flujo de dominio completo contra PostgreSQL real — la           │
 * │ autorización de quién puede pedir un cambio, el contrato del           │
 * │ `callback_data`, el editor, la validación, el formateo y la máquina    │
 * │ de estados para la v2.                                                 │
 * │ NO: el transporte HTTP ni la API de Telegram. Igual que en E2E-1, la   │
 * │ entrega se hace con la transición directa (`system`), no con           │
 * │ `deliverVersion`: ese módulo manda mensajes, y eso lo prueba su propio │
 * │ test unitario con un `TelegramSender` mockeado.                        │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { canRequestChange, canViewVersion } from '../../supabase/functions/_core/authorization.ts';
import {
  buildChangeCallback,
  parseChangeCallback,
} from '../../supabase/functions/_core/domain/change-request.ts';
import type { Identity } from '../../supabase/functions/_core/domain/identity.ts';
import { nextState } from '../../supabase/functions/_core/domain/state-machine.ts';
import { validateDraft } from '../../supabase/functions/_core/domain/validate-draft.ts';
import type { ClientRef, VersionRef } from '../../supabase/functions/_core/domain/version.ts';
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

/** `request_change` no tiene wrapper en `helpers/db.ts`: no lo usa ningún otro test. */
async function pedirCambio(clientDb: Client, versionId: string, clientId: string, reason: string): Promise<string> {
  const { rows } = await clientDb.query<{ request_change: string }>(
    `SELECT request_change($1, $2, $3)`,
    [versionId, clientId, reason],
  );
  return rows[0]!.request_change;
}

async function resolverSolicitudes(clientDb: Client, versionId: string): Promise<number> {
  const { rows } = await clientDb.query<{ resolve_change_requests: number }>(
    `SELECT resolve_change_requests($1)`,
    [versionId],
  );
  return rows[0]!.resolve_change_requests;
}

describe('E2E-4 — solicitud de cambio: v1 se queda, v2 sale', () => {
  it('recorre el ciclo completo y v1 conserva su contenido, estado y sent_at', async () => {
    // ─────────────────────────────────────────────────────────────────────
    // 1. Entrenador y cliente, con v1 ya en SENT — el único estado desde el
    //    que se puede pedir un cambio (regla 2).
    // ─────────────────────────────────────────────────────────────────────
    const trainerProfileId = await createProfile(db, 'trainer');
    const clientProfileId = await createProfile(db, 'client', 'Carlos Pérez');
    const clientId = await createClient(db, trainerProfileId, 'Carlos Pérez');
    const planId = await createPlan(db, clientId, null);

    const plantilla = templatesFor({ daysPerWeek: 3, level: 'beginner' })[0]!;
    const validado = validateDraft(applyTemplate(plantilla, null), null);
    expect(validado.ok).toBe(true);
    if (!validado.ok) return;

    const v1 = await createVersion(db, planId, 'template', trainerProfileId, validado.workout, plantilla.id);
    await transition(db, v1, 'DRAFT', 'APPROVED', 'trainer');
    await linkClient(db, clientId, clientProfileId);
    await transition(db, v1, 'APPROVED', 'SENT', 'system');

    const clientRef: ClientRef = { clientId, trainerId: trainerProfileId, profileId: clientProfileId };
    const clientIdentity: Identity = {
      profileId: clientProfileId,
      role: 'client',
      telegramUserId: 2,
      telegramChatId: 2,
    };

    // La foto de v1 ANTES de que exista ninguna solicitud: es contra esto
    // que se compara al final (CA-4).
    const antes = await readVersion(db, v1);
    expect(antes.state).toBe('SENT');
    expect(antes.sent_at).not.toBeNull();

    // ─────────────────────────────────────────────────────────────────────
    // 2. 🔴 Autorización: solo el propio cliente, y solo sobre SENT.
    // ─────────────────────────────────────────────────────────────────────
    const v1Ref: VersionRef = { versionId: v1, state: 'SENT', client: clientRef };

    const trainerIdentity: Identity = {
      profileId: trainerProfileId,
      role: 'trainer',
      telegramUserId: 1,
      telegramChatId: 1,
    };
    expect(canRequestChange(trainerIdentity, v1Ref)).toEqual({ allowed: false, reason: 'NOT_CLIENT' });

    const otroClienteId = await createProfile(db, 'client', 'Otra Persona');
    expect(canRequestChange({ ...clientIdentity, profileId: otroClienteId }, v1Ref)).toEqual({
      allowed: false,
      reason: 'NOT_YOUR_VERSION',
    });

    expect(canRequestChange(clientIdentity, v1Ref)).toEqual({ allowed: true });

    // ─────────────────────────────────────────────────────────────────────
    // 3. El cliente pide un cambio. El `callback_data` de cada motivo tiene
    //    que sobrevivir el viaje de ida y vuelta (SPEC-010 §3).
    // ─────────────────────────────────────────────────────────────────────
    const callback = buildChangeCallback('too_hard', v1);
    const parsed = parseChangeCallback(callback);
    expect(parsed).toEqual({ reason: 'too_hard', versionId: v1 });

    await pedirCambio(db, v1, clientId, parsed!.reason);

    const { rows: solicitud } = await db.query<{ state: string }>(
      `SELECT state FROM change_requests WHERE version_id = $1`,
      [v1],
    );
    expect(solicitud[0]?.state).toBe('OPEN');

    // La solicitud NO toca la versión (regla 3, CA-1): ya se puede comprobar.
    expect(await readVersion(db, v1)).toEqual(antes);

    // ─────────────────────────────────────────────────────────────────────
    // 4. El entrenador crea la v2 — mismo camino que la primera rutina
    //    (regla 9): aquí, a mano, y con un contenido DISTINTO al de v1, para
    //    que la comparación final signifique algo.
    // ─────────────────────────────────────────────────────────────────────
    let workout = editar(validado.workout, 'add', '1 Face pull 3x15 60');
    workout = editar(workout, 'nota', '1 1 Menos peso: pidió que era muy difícil');

    const revalidado = validateDraft({ source: 'manual', raw: workout }, null);
    expect(revalidado.ok, 'la revisión manual valida igual que la plantilla original').toBe(true);
    if (!revalidado.ok) return;

    const v2 = await createVersion(db, planId, 'manual', trainerProfileId, revalidado.workout);
    await saveVersionContent(db, v2, revalidado.workout);

    // La solicitud sigue OPEN mientras la v2 solo existe en NEW: se resuelve
    // al ENVIAR, no al crear (regla 12, CA-12).
    expect((await db.query(`SELECT state FROM change_requests WHERE version_id = $1`, [v1])).rows[0]?.state).toBe(
      'OPEN',
    );

    // Lo que el entrenador ve en el móvil sigue cabiendo en Telegram.
    const version2Row = await readVersion(db, v2);
    const mensaje = formatWorkout(revalidado.workout, {
      clientName: 'Carlos Pérez',
      versionNumber: version2Row.version_number,
    });
    for (const trozo of splitMessage(mensaje)) {
      expect(trozo.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE);
    }
    expect(mensaje).toContain('Face pull');

    // ─────────────────────────────────────────────────────────────────────
    // 5. Se aprueba y se envía, por la máquina de estados — igual que E2E-1.
    // ─────────────────────────────────────────────────────────────────────
    expect(nextState('DRAFT', 'APPROVE')).toBe('APPROVED');
    expect(await transition(db, v2, 'DRAFT', 'APPROVED', 'trainer')).toBe(true);

    expect(nextState('APPROVED', 'SEND')).toBe('SENT');
    expect(await transition(db, v2, 'APPROVED', 'SENT', 'system')).toBe(true);

    // ─────────────────────────────────────────────────────────────────────
    // 6. La solicitud se resuelve al enviar (regla 12, CA-3).
    // ─────────────────────────────────────────────────────────────────────
    expect(await resolverSolicitudes(db, v2)).toBe(1);

    const { rows: resuelta } = await db.query<{
      state: string;
      resolved_by_version_id: string;
      resolved_at: Date | null;
    }>(`SELECT state, resolved_by_version_id, resolved_at FROM change_requests WHERE version_id = $1`, [v1]);
    expect(resuelta[0]?.state).toBe('RESOLVED');
    expect(resuelta[0]?.resolved_by_version_id).toBe(v2);
    expect(resuelta[0]?.resolved_at).not.toBeNull();

    // CA-2 — el plan apunta a la nueva.
    const { rows: plan } = await db.query<{ current_version_id: string }>(
      `SELECT current_version_id FROM workout_plans WHERE id = $1`,
      [planId],
    );
    expect(plan[0]?.current_version_id).toBe(v2);

    // ─────────────────────────────────────────────────────────────────────
    // 7. 🎯 LA ASERCIÓN QUE DA SENTIDO A TODO EL TEST (CA-4).
    //    Con la v2 enviada, v1 sigue exactamente como antes de que nadie
    //    pidiera nada — byte a byte, no «parecido».
    // ─────────────────────────────────────────────────────────────────────
    const despues = await readVersion(db, v1);
    expect(despues).toEqual(antes);

    // Y no es que las dos versiones coincidieran por casualidad: son
    // distintas. Si el assert de arriba pasara con cualquier contenido,
    // no estaría probando nada.
    expect(despues.content).not.toEqual(version2Row.content);

    // El cliente ve la v2 — su rutina vigente sigue siendo consultable.
    const v2Ref: VersionRef = { versionId: v2, state: 'SENT', client: clientRef };
    expect(canViewVersion(clientIdentity, v2Ref)).toEqual({ allowed: true });
  }, 30_000);

  it('CA-6 — no se puede pedir un cambio sobre una versión que no está SENT', async () => {
    const trainerProfileId = await createProfile(db, 'trainer');
    const clientProfileId = await createProfile(db, 'client');
    const clientId = await createClient(db, trainerProfileId);
    const planId = await createPlan(db, clientId, null);
    await linkClient(db, clientId, clientProfileId);

    const plantilla = templatesFor({})[0]!;
    const validado = validateDraft(applyTemplate(plantilla, null), null);
    if (!validado.ok) throw new Error('la plantilla no valida');

    const versionId = await createVersion(db, planId, 'template', trainerProfileId, validado.workout, plantilla.id);
    // Se queda en DRAFT: nunca se aprueba ni se envía.

    const clientIdentity: Identity = {
      profileId: clientProfileId,
      role: 'client',
      telegramUserId: 2,
      telegramChatId: 2,
    };
    const draftRef: VersionRef = {
      versionId,
      state: 'DRAFT',
      client: { clientId, trainerId: trainerProfileId, profileId: clientProfileId },
    };

    expect(canRequestChange(clientIdentity, draftRef)).toEqual({
      allowed: false,
      reason: 'VERSION_NOT_VISIBLE',
    });
  });
});
