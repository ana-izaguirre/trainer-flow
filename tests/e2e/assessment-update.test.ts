/**
 * E2E — SPEC-027: el cliente actualiza sus datos, de punta a punta.
 *
 *   /actualizar → enlace con token → el formulario vuelve por el webhook de
 *   Tally → evaluación nueva para el MISMO cliente → aviso al entrenador →
 *   la próxima versión se valida contra los datos nuevos (CA-8)
 *
 * ┌─ QUÉ CUBRE Y QUÉ NO ───────────────────────────────────────────────────┐
 * │ SÍ: los flujos de `_core` contra PostgreSQL real, con las funciones    │
 * │ SQL de la migración 0026 y el payload REAL de Tally del fixture.       │
 * │ NO: HTTP, la firma de Tally (siempre válida aquí) ni la API de         │
 * │ Telegram: los mensajes se capturan. Cada uno tiene su propio test.     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from 'pg';

import { requestOwnUpdate } from '../../supabase/functions/_core/assessment/update-request.ts';
import type { Identity } from '../../supabase/functions/_core/domain/identity.ts';
import { validateDraft } from '../../supabase/functions/_core/domain/validate-draft.ts';
import type { TallyRepo } from '../../supabase/functions/_core/ports/tally-ports.ts';
import type { TelegramSender } from '../../supabase/functions/_core/ports/telegram-ports.ts';
import { handleTallyWebhook } from '../../supabase/functions/_core/tally/webhook.ts';
import { applyTemplate, findTemplate } from '../../supabase/functions/_core/templates.ts';

import {
  connect,
  createAssessment,
  createClient,
  createPlan,
  createProfile,
  createVersion,
  linkClient,
  readVersion,
  resetTestDatabase,
  SAMPLE_CONTENT,
  sendVersion,
  truncateAll,
} from '../helpers/db.ts';

const FIXTURE = resolve(import.meta.dirname, '../fixtures/tally-form-response.json');
const FORM = 'https://tally.so/r/abc123';

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

/** Mensajes capturados, con su teclado aplanado. */
function capturar() {
  const enviados: { chatId: number; text: string; botones: string[] }[] = [];
  const sender: TelegramSender = {
    sendMessage: (chatId, text, keyboard) => {
      enviados.push({
        chatId,
        text,
        botones: keyboard?.inline_keyboard.flat().map((b) => b.callback_data) ?? [],
      });
      return Promise.resolve();
    },
    answerCallback: () => Promise.resolve(),
  };
  return { enviados, sender };
}

/** El `TallyRepo` real, sobre las funciones SQL. Solo lo que usa el flujo. */
function tallyRepo(): TallyRepo {
  return {
    claimEvent: async (externalId, payload) => {
      const { rowCount } = await db.query(
        `INSERT INTO webhook_events (source, external_id, payload) VALUES ('tally', $1, $2)
         ON CONFLICT DO NOTHING`,
        [externalId, JSON.stringify(payload)],
      );
      return rowCount === 1;
    },
    markProcessed: async (externalId) => {
      await db.query(
        `UPDATE webhook_events SET processed_at = now() WHERE source = 'tally' AND external_id = $1`,
        [externalId],
      );
    },
    findTrainer: async () => {
      const { rows } = await db.query(
        `SELECT id, telegram_chat_id FROM profiles WHERE role = 'trainer' ORDER BY created_at LIMIT 1`,
      );
      return rows[0] === undefined
        ? null
        : { profileId: rows[0]['id'] as string, chatId: Number(rows[0]['telegram_chat_id']) };
    },
    ingestAssessment: () => Promise.reject(new Error('con un token válido no se crea ningún cliente')),
    ingestAssessmentUpdate: async (input) => {
      const { rows } = await db.query(
        `SELECT * FROM ingest_assessment_update(
           p_token => $1, p_raw_payload => $2, p_goal => $3, p_level => $4,
           p_days_per_week => $5, p_session_minutes => $6, p_equipment => $7,
           p_has_limitations => $8, p_limitations_detail => $9)`,
        [
          input.token,
          JSON.stringify(input.rawPayload),
          input.goal,
          input.level,
          input.daysPerWeek,
          input.sessionMinutes,
          input.equipment,
          input.hasLimitations,
          input.limitationsDetail,
        ],
      );
      const r = rows[0];
      if (r === undefined) return null;
      const anterior = r['previous'] as Record<string, unknown>;
      return {
        clientId: r['client_id'] as string,
        clientName: r['client_name'] as string,
        clientChatId: r['client_chat_id'] === null ? null : Number(r['client_chat_id']),
        assessmentId: r['assessment_id'] as string,
        previous: {
          goal: anterior['goal'] as string,
          level: anterior['level'] as 'intermediate',
          daysPerWeek: anterior['days_per_week'] as number,
          sessionMinutes: anterior['session_minutes'] as number,
          equipment: anterior['equipment'] as string,
          hasLimitations: anterior['has_limitations'] as boolean,
          limitationsDetail: anterior['limitations_detail'] as string | null,
          lifestyle: null,
          notes: null,
          gender: null,
          age: null,
          weightKg: null,
          heightCm: null,
          lastWeighed: null,
          quitReasons: null,
          menopauseStage: null,
          chronicConditions: null,
          birthDate: null,
          medications: null,
          equipmentDetail: null,
        },
        planId: r['plan_id'] as string,
        versionId: r['version_id'] as string,
        versionState: r['version_state'] as 'SENT',
      };
    },
  };
}

/** El payload real de Tally, con el campo oculto que devuelve el enlace. */
function envioConToken(token: string): string {
  const cuerpo = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    eventId: string;
    data: { fields: unknown[] };
  };
  cuerpo.eventId = `evt-actualizacion-${token.slice(0, 8)}`;
  cuerpo.data.fields.push({ key: 'question_update', label: 'update', type: 'HIDDEN_FIELDS', value: token });
  return JSON.stringify(cuerpo);
}

describe('E2E · SPEC-027 — el cliente actualiza sus datos', () => {
  it('de /actualizar a una v2 que se valida contra los días nuevos', async () => {
    // ── Un cliente vinculado, con su v1 de 4 días ya ENVIADA ─────────────
    const trainerId = await createProfile(db, 'trainer');
    const clientId = await createClient(db, trainerId, 'Carlos Pérez');
    const profileId = await createProfile(db, 'client', 'Carlos Pérez');
    await linkClient(db, clientId, profileId);
    const planId = await createPlan(db, clientId, await createAssessment(db, clientId));
    const v1 = await createVersion(db, planId, 'manual', trainerId, SAMPLE_CONTENT);
    await sendVersion(db, v1);
    const v1Antes = await readVersion(db, v1);

    const { rows: chats } = await db.query(`SELECT telegram_chat_id FROM profiles WHERE id = $1`, [
      profileId,
    ]);
    const cliente: Identity = {
      profileId,
      role: 'client',
      telegramUserId: Number(chats[0]!['telegram_chat_id']),
      telegramChatId: Number(chats[0]!['telegram_chat_id']),
    };

    // ── 1. /actualizar: el enlace, con un token de verdad ────────────────
    const bot = capturar();
    const pedido = await requestOwnUpdate(cliente, {
      repo: {
        issueForProfile: async (p, token) => {
          const { rows } = await db.query(`SELECT issue_update_token_for_profile($1, $2) AS id`, [p, token]);
          return (rows[0]!['id'] as string | null) ?? null;
        },
        issueForClient: () => Promise.reject(new Error('no se usa aquí')),
      },
      clients: { findClientForVersion: () => Promise.resolve(null) },
      sender: bot.sender,
      newToken: () => 'e2eTokenDeActualizacion_0123456789abcdefXYZ',
      formUrl: FORM,
    });
    expect(pedido).toEqual({ kind: 'sent', clientId });

    // El enlace, tal como lo tocaría el cliente (sin el escapado de Telegram).
    const enlace = bot.enviados[0]!.text.replace(/\\(.)/g, '$1').match(/https:\/\/\S+/)![0];
    const token = new URL(enlace).searchParams.get('update')!;
    expect(token).toBe('e2eTokenDeActualizacion_0123456789abcdefXYZ');

    // ── 2. Tally devuelve el formulario con el token ─────────────────────
    const { rows: antes } = await db.query(`SELECT count(*)::int AS n FROM clients`);
    const tally = capturar();
    const outcome = await handleTallyWebhook(
      { rawBody: envioConToken(token), signature: 'firma' },
      {
        repo: tallyRepo(),
        verifier: { matches: () => Promise.resolve(true) },
        sender: tally.sender,
        newLinkToken: () => 'no-se-usa-con-token-valido-00000',
        botUsername: 'mibot',
        requestId: '00000000-0000-4000-8000-000000000000',
      },
    );

    // CA-2: la evaluación es de Carlos. Ningún cliente nuevo.
    expect(outcome).toMatchObject({ kind: 'updated', clientId });
    const { rows: despues } = await db.query(`SELECT count(*)::int AS n FROM clients`);
    expect(despues[0]!['n']).toBe(antes[0]!['n']);

    // CA-11: el token no quedó guardado en el evento.
    const { rows: eventos } = await db.query(`SELECT payload::text AS p FROM webhook_events`);
    expect(eventos.map((e) => e['p'] as string).join()).not.toContain(token);

    // CA-3: su v1 enviada, intacta.
    expect(await readVersion(db, v1)).toEqual(v1Antes);

    // CA-4: el entrenador sabe qué cambió (de 4 días a los del fixture), y
    // puede crear la v2 desde el propio aviso.
    const { rows: nuevos } = await db.query(
      `SELECT a.days_per_week FROM workout_plans pl JOIN assessments a ON a.id = pl.assessment_id
       WHERE pl.id = $1`,
      [planId],
    );
    const diasNuevos = nuevos[0]!['days_per_week'] as number;
    expect(diasNuevos).not.toBe(4);
    const aviso = tally.enviados.find((m) => m.text.includes('actualizó sus datos'))!;
    expect(aviso.text).toContain(`días \\(4 → ${diasNuevos}\\)`);
    expect(aviso.botones).toContain(`act:revise:${v1}`);
    // Y el cliente recibe su acuse.
    expect(tally.enviados.some((m) => m.chatId === cliente.telegramChatId && m.text.includes('Recibido'))).toBe(true);

    // El token ya se usó: un segundo envío con él NO actualiza nada.
    const { rows: tokens } = await db.query(`SELECT update_token_hash FROM clients WHERE id = $1`, [clientId]);
    expect(tokens[0]!['update_token_hash']).toBeNull();

    // ── 3. CA-8: lo que se prepare ahora se valida con los datos nuevos ──
    const { rows: criterios } = await db.query(
      `SELECT days_per_week, has_limitations FROM version_for_generation($1)`,
      [v1],
    );
    const constraints = {
      daysPerWeek: criterios[0]!['days_per_week'] as number,
      hasLimitations: criterios[0]!['has_limitations'] as boolean,
    };
    expect(constraints.daysPerWeek).toBe(diasNuevos);

    // Una rutina hecha para los 4 días de antes ya no pasa…
    const deCuatro = findTemplate('upper-lower-4d')!;
    expect(validateDraft({ source: 'template', raw: deCuatro.workout }, constraints).ok).toBe(false);
    // …y una preparada con los datos nuevos, sí.
    expect(validateDraft(applyTemplate(deCuatro, constraints), constraints).ok).toBe(true);
  });
});
