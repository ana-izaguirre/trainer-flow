/**
 * Acceso a PostgreSQL desde las Edge Functions.
 *
 * Usa `service_role`, que salta RLS por diseño. **Por eso toda operación debe
 * pasar antes por `_core/authorization.ts`** (ADR-010).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Identity } from '../_core/domain/identity.ts';
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
