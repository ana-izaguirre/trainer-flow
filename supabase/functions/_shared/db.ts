/**
 * Acceso a PostgreSQL desde las Edge Functions.
 *
 * Usa `service_role`, que salta RLS por diseño. **Por eso toda operación debe
 * pasar antes por `_core/authorization.ts`** (ADR-010).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Identity } from '../_core/domain/identity.ts';
import type { AssessmentToIngest, IngestedIds, TallyRepo } from '../_core/ports/tally-ports.ts';
import type { TelegramRepo } from '../_core/ports/telegram-ports.ts';
import { requireEnv } from './env.ts';

export type Db = SupabaseClient;

export function createDb(): Db {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Registra el evento para garantizar idempotencia.
 *
 * Devuelve `false` si ya se había procesado: violación de
 * `UNIQUE (source, external_id)`. Ese es el mecanismo, no un efecto colateral.
 */
export async function claimWebhookEvent(
  db: Db,
  source: 'telegram' | 'tally',
  externalId: string,
  payload: unknown,
  requestId: string,
): Promise<boolean> {
  const { error } = await db
    .from('webhook_events')
    .insert({ source, external_id: externalId, payload, request_id: requestId });

  if (error === null) return true;
  if (error.code === '23505') return false; // ya procesado

  throw new Error(`No se pudo registrar el evento: ${error.code}`);
}

export async function markWebhookProcessed(
  db: Db,
  source: 'telegram' | 'tally',
  externalId: string,
): Promise<void> {
  await db
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('source', source)
    .eq('external_id', externalId);
}

/**
 * Resuelve la identidad a partir del `telegram_user_id` del update verificado.
 *
 * Devuelve `null` si no hay perfil: **nadie se auto-registra** (SPEC-009
 * regla 1). Un desconocido no puede crear una cuenta escribiéndole al bot.
 */
export async function findIdentity(db: Db, telegramUserId: number): Promise<Identity | null> {
  const { data, error } = await db
    .from('profiles')
    .select('id, role, telegram_user_id, telegram_chat_id')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  if (error !== null || data === null) return null;

  return {
    profileId: data.id as string,
    role: data.role as Identity['role'],
    telegramUserId: data.telegram_user_id as number,
    telegramChatId: (data.telegram_chat_id as number | null) ?? telegramUserId,
  };
}

/**
 * Implementa el puerto `TelegramRepo` con supabase-js.
 *
 * El flujo del webhook vive en `_core` y solo conoce la interfaz; esto es el
 * adaptador que la cumple.
 */
export function createTelegramRepo(db: Db, requestId: string): TelegramRepo {
  return {
    claimEvent: (externalId, payload) =>
      claimWebhookEvent(db, 'telegram', externalId, payload, requestId),
    markProcessed: (externalId) => markWebhookProcessed(db, 'telegram', externalId),
    findIdentity: (telegramUserId) => findIdentity(db, telegramUserId),
  };
}

/**
 * Implementa el puerto `TallyRepo`.
 *
 * Reusa `claimWebhookEvent` con `source = 'tally'`: la idempotencia es el
 * mismo `UNIQUE (source, external_id)` para los dos proveedores, así que
 * Telegram y Tally no pueden pisarse aunque compartan un identificador.
 */
export function createTallyRepo(db: Db, requestId: string): TallyRepo {
  return {
    claimEvent: (externalId, payload) =>
      claimWebhookEvent(db, 'tally', externalId, payload, requestId),
    markProcessed: (externalId) => markWebhookProcessed(db, 'tally', externalId),
    findTrainer: () => findTrainer(db),
    ingestAssessment: (input) => ingestAssessment(db, input, requestId),
  };
}

/**
 * El entrenador. En V1 hay exactamente uno, así que se toma el más antiguo:
 * si algún día hubiera dos, esto deja de servir y hay que pasar el
 * `trainer_id` explícito.
 */
async function findTrainer(db: Db): Promise<{ profileId: string; chatId: number } | null> {
  const { data } = await db
    .from('profiles')
    .select('id, telegram_user_id, telegram_chat_id')
    .eq('role', 'trainer')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data === null) return null;

  return {
    profileId: data.id as string,
    // En un chat privado coinciden, pero son conceptos distintos: uno es
    // quién eres y el otro dónde te escribo (ADR-009).
    chatId: (data.telegram_chat_id as number | null) ?? (data.telegram_user_id as number),
  };
}

/**
 * Invoca `ingest_assessment`: cliente, evaluación, plan y primera versión, en
 * una sola operación atómica.
 *
 * Los cuatro INSERT no se pueden hacer desde aquí uno a uno: supabase-js no
 * abre transacciones de varias sentencias, y un fallo a mitad dejaría un
 * cliente sin plan sin que nadie se entere.
 */
async function ingestAssessment(
  db: Db,
  input: AssessmentToIngest,
  requestId: string,
): Promise<IngestedIds> {
  const { data, error } = await db
    .rpc('ingest_assessment', {
      p_trainer_id: input.trainerId,
      p_full_name: input.fullName,
      p_link_token: input.linkToken,
      p_raw_payload: input.rawPayload,
      p_goal: input.goal,
      p_level: input.level,
      p_days_per_week: input.daysPerWeek,
      p_session_minutes: input.sessionMinutes,
      p_equipment: input.equipment,
      p_has_limitations: input.hasLimitations,
      p_limitations_detail: input.limitationsDetail,
      p_lifestyle: input.lifestyle,
      p_notes: input.notes,
      p_request_id: requestId,
    })
    .single();

  // El mensaje NO lleva el detalle del error de Postgres: podría citar el
  // valor de una columna, y una de ellas es información de salud.
  if (error !== null || data === null) {
    throw new Error(`No se pudo guardar la evaluación: ${error?.code ?? 'sin datos'}`);
  }

  const fila = data as { client_id: string; plan_id: string; version_id: string };
  return { clientId: fila.client_id, planId: fila.plan_id, versionId: fila.version_id };
}
