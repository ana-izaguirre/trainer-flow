/**
 * Acceso a PostgreSQL desde las Edge Functions.
 *
 * Usa `service_role`, que salta RLS por diseño. **Por eso toda operación debe
 * pasar antes por `_core/authorization.ts`** (ADR-010).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Identity } from '../_core/domain/identity.ts';
import type { AssessmentToIngest, IngestedIds, TallyRepo } from '../_core/ports/tally-ports.ts';
import type {
  GenerationOutcome,
  GenerationRecord,
  GenerationRepo,
  VersionForGeneration,
} from '../_core/ports/generation-ports.ts';
import type { Level } from '../_core/domain/assessment.ts';
import type { VersionState } from '../_core/domain/version.ts';
import type { Workout } from '../_core/domain/workout.ts';
import type { ActionRepo } from '../_core/ports/action-ports.ts';
import type { CheckinAnswers } from '../_core/checkin/answers.ts';
import type { CheckinForReply, CheckinRepo } from '../_core/ports/checkin-ports.ts';
import type { DeliveryRepo, VersionForDelivery } from '../_core/ports/delivery-ports.ts';
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

// -----------------------------------------------------------------------------
// Generación con IA (SPEC-002)
// -----------------------------------------------------------------------------

export function createGenerationRepo(db: Db, requestId: string): GenerationRepo {
  return {
    findVersion: (versionId) => findVersionForGeneration(db, versionId),

    async recentGenerations(windowMinutes) {
      const desde = new Date(Date.now() - windowMinutes * 60_000).toISOString();

      // Solo las fechas: el rate limit cuenta llamadas, no le importa qué
      // pasó con ellas. Las fallidas cuentan igual — consumieron cuota.
      const { data, error } = await db
        .from('ai_generations')
        .select('created_at')
        .gte('created_at', desde);

      if (error !== null) throw new Error(`No se pudo leer la cuota: ${error.code}`);

      return (data ?? []).map((fila) => new Date(fila.created_at as string));
    },

    async startGeneration(record: GenerationRecord) {
      const { data, error } = await db
        .from('ai_generations')
        .insert({
          provider: record.provider,
          model: record.model,
          operation: 'generate',
          version_id: record.versionId,
          request_id: requestId,
          status: 'GENERATING',
        })
        .select('id')
        .single();

      if (error !== null || data === null) {
        throw new Error(`No se pudo registrar la generación: ${error?.code ?? 'sin datos'}`);
      }

      return data.id as number;
    },

    async finishGeneration(id, outcome: GenerationOutcome) {
      const comun = { latency_ms: outcome.latencyMs, finished_at: new Date().toISOString() };

      const fila =
        outcome.status === 'SUCCEEDED'
          ? {
              ...comun,
              status: 'SUCCEEDED',
              tokens_in: outcome.usage.tokensIn,
              tokens_out: outcome.usage.tokensOut,
            }
          : { ...comun, status: 'FAILED', failure_reason: outcome.failureReason };

      const { error } = await db.from('ai_generations').update(fila).eq('id', id);

      // Que el cierre falle no puede tumbar una generación que sí funcionó,
      // pero tampoco puede pasar en silencio: la fila queda en GENERATING para
      // siempre y la cuota deja de cuadrar.
      if (error !== null) throw new Error(`No se pudo cerrar la generación: ${error.code}`);
    },

    async transition(versionId, from, to) {
      // `apply_version_transition` lleva la guarda de concurrencia: devuelve
      // false si el estado esperado ya no es el actual.
      const { data, error } = await db.rpc('apply_version_transition', {
        p_version_id: versionId,
        p_expected_state: from,
        p_next_state: to,
        p_actor: 'system',
      });

      if (error !== null) throw new Error(`No se pudo aplicar la transición: ${error.code}`);

      return data === true;
    },

    async saveContent(versionId, workout: Workout) {
      const { error } = await db
        .from('workout_versions')
        .update({ content: workout })
        .eq('id', versionId);

      if (error !== null) throw new Error(`No se pudo guardar la rutina: ${error.code}`);
    },
  };
}

/**
 * Reúne versión, evaluación y entrenador en una consulta.
 *
 * El `join` de cinco tablas vive en `version_for_generation` (migración 0007):
 * encadenar cinco `select` anidados produce algo que nadie vuelve a leer.
 */
async function findVersionForGeneration(
  db: Db,
  versionId: string,
): Promise<VersionForGeneration | null> {
  const { data, error } = await db
    .rpc('version_for_generation', { p_version_id: versionId })
    .maybeSingle();

  if (error !== null) throw new Error(`No se pudo leer la versión: ${error.code}`);
  if (data === null) return null;

  const fila = data as Record<string, unknown>;
  const limitations = (fila['limitations'] as string | null) ?? null;

  return {
    versionId: fila['version_id'] as string,
    state: fila['state'] as VersionState,
    clientName: fila['client_name'] as string,
    versionNumber: Number(fila['version_number']),
    request: {
      goal: fila['goal'] as string,
      level: fila['level'] as Level,
      daysPerWeek: fila['days_per_week'] as number,
      sessionMinutes: fila['session_minutes'] as number,
      equipment: fila['equipment'] as string,
      limitations,
      // Generar desde cero, no editar. La edición llega en el bloque 7.
      instruction: null,
    },
    constraints: {
      daysPerWeek: fila['days_per_week'] as number,
      hasLimitations: fila['has_limitations'] as boolean,
    },
    trainerChatId: Number(fila['trainer_chat_id']),
  };
}

// -----------------------------------------------------------------------------
// Vinculación y entrega (SPEC-005)
// -----------------------------------------------------------------------------

/**
 * Implementa el puerto `DeliveryRepo`.
 *
 * Las cinco operaciones son funciones SQL (migración 0009) y no cadenas de
 * `select` anidados: tres de ellas necesitan joins de cuatro o cinco tablas, y
 * dos necesitan ser atómicas. Encadenar PostgREST para eso produce algo que
 * nadie vuelve a leer, y que además no es atómico.
 */
export function createDeliveryRepo(db: Db): DeliveryRepo {
  return {
    async findClientByToken(token) {
      // El token es una credencial: no aparece en el mensaje de error.
      const { data, error } = await db.rpc('client_for_link', { p_token: token }).maybeSingle();

      if (error !== null) throw new Error(`No se pudo buscar el enlace: ${error.code}`);
      if (data === null) return null;

      const fila = data as Record<string, unknown>;
      const chatDelEntrenador = fila['trainer_chat_id'];

      return {
        clientId: fila['client_id'] as string,
        fullName: fila['full_name'] as string,
        linkedProfileId: (fila['linked_profile_id'] as string | null) ?? null,
        linkedTelegramUserId: toNumberOrNull(fila['linked_telegram_user_id']),
        trainerChatId: Number(chatDelEntrenador),
      };
    },

    async ensureClientProfile(telegramUserId, chatId, fullName) {
      const { data, error } = await db.rpc('ensure_client_profile', {
        p_telegram_user_id: telegramUserId,
        p_chat_id: chatId,
        p_full_name: fullName,
      });

      if (error !== null) throw new Error(`No se pudo resolver el perfil: ${error.code}`);

      // NULL es una respuesta, no un fallo: ya tiene un perfil que no es de
      // cliente, y un entrenador no cambia de rol por pulsar un enlace.
      if (data === null) return null;

      return { profileId: data as string, chatId };
    },

    async linkClient(clientId, profileId) {
      const { data, error } = await db.rpc('link_client', {
        p_client_id: clientId,
        p_profile_id: profileId,
      });

      if (error !== null) throw new Error(`No se pudo vincular: ${error.code}`);

      return data === true;
    },

    findApprovedVersion: (clientId) =>
      readDelivery(db, 'approved_version_for_client', { p_client_id: clientId }),

    findVersion: (versionId) =>
      readDelivery(db, 'version_for_delivery', { p_version_id: versionId }),

    async transition(versionId, from, to) {
      const { data, error } = await db.rpc('apply_version_transition', {
        p_version_id: versionId,
        p_expected_state: from,
        p_next_state: to,
        // La entrega la dispara el sistema, no una pulsación (SPEC-005 §5).
        p_actor: 'system',
      });

      if (error !== null) throw new Error(`No se pudo aplicar la transición: ${error.code}`);

      return data === true;
    },
  };
}

/** `bigint` puede llegar como número o como texto según el driver. */
function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Las dos consultas de entrega devuelven la MISMA forma de fila, así que se
 * leen con el mismo código: dos lecturas que deben coincidir acaban sin
 * coincidir.
 */
async function readDelivery(
  db: Db,
  fn: 'version_for_delivery' | 'approved_version_for_client',
  args: Record<string, string>,
): Promise<VersionForDelivery | null> {
  const { data, error } = await db.rpc(fn, args).maybeSingle();

  if (error !== null) throw new Error(`No se pudo leer la versión: ${error.code}`);
  if (data === null) return null;

  const fila = data as Record<string, unknown>;
  const goal = fila['goal'] as string | null;

  return {
    versionId: fila['version_id'] as string,
    state: fila['state'] as VersionState,
    content: fila['content'] as Workout,
    clientName: fila['client_name'] as string,
    // NULL si aún no canjeó su enlace: no hay dónde escribirle, pero la
    // versión se devuelve igual para poder avisar al entrenador (CA-3).
    clientChatId: toNumberOrNull(fila['client_chat_id']),
    trainerChatId: Number(fila['trainer_chat_id']),
    // Los tres van juntos o no va ninguno: una rutina manual no tiene
    // formulario detrás (SPEC-005 regla 13).
    plan:
      goal === null
        ? null
        : {
            goal,
            daysPerWeek: Number(fila['days_per_week']),
            sessionMinutes: Number(fila['session_minutes']),
          },
  };
}

// -----------------------------------------------------------------------------
// Los botones del entrenador (SPEC-004)
// -----------------------------------------------------------------------------

/**
 * Implementa el puerto `ActionRepo`.
 *
 * `findVersion` trae la PERTENENCIA —de qué cliente es y de qué entrenador—
 * porque eso es lo que `_core/authorization.ts` compara contra la identidad
 * resuelta del webhook. Un `callback_data` lo fabrica cualquiera; lo que
 * impide tocar la versión de otro es esa comparación (SPEC-009 regla 8).
 */
export function createActionRepo(db: Db, requestId: string): ActionRepo {
  return {
    async findVersion(versionId) {
      const { data, error } = await db
        .rpc('version_for_action', { p_version_id: versionId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la versión: ${error.code}`);
      if (data === null) return null;

      const fila = data as Record<string, unknown>;

      return {
        versionId: fila['version_id'] as string,
        state: fila['state'] as VersionState,
        versionNumber: Number(fila['version_number']),
        content: (fila['content'] as Workout | null) ?? null,
        clientName: fila['client_name'] as string,
        client: {
          clientId: fila['client_id'] as string,
          trainerId: fila['trainer_id'] as string,
          profileId: (fila['client_profile_id'] as string | null) ?? null,
        },
      };
    },

    async transition(versionId, from, to) {
      const { data, error } = await db.rpc('apply_version_transition', {
        p_version_id: versionId,
        p_expected_state: from,
        p_next_state: to,
        // Fue el entrenador quien pulsó: es el actor que queda en el evento.
        p_actor: 'trainer',
        p_request_id: requestId,
      });

      if (error !== null) throw new Error(`No se pudo aplicar la transición: ${error.code}`);

      return data === true;
    },
  };
}

// -----------------------------------------------------------------------------
// Check-in semanal (SPEC-006)
// -----------------------------------------------------------------------------

/**
 * Implementa el puerto `CheckinRepo`.
 *
 * Ninguna de estas consultas decide CUÁNDO toca un check-in: traen candidatos
 * y escriben lo que `_core/checkin/schedule.ts` decidió. El número de semana
 * es lo que hace funcionar al `UNIQUE`, y tiene que poder probarse sin una
 * base de datos delante.
 */
export function createCheckinRepo(db: Db): CheckinRepo {
  return {
    async candidates() {
      const { data, error } = await db.rpc('checkin_candidates');

      if (error !== null) throw new Error(`No se pudieron leer los candidatos: ${error.code}`);

      return (data ?? []).map((fila: Record<string, unknown>) => ({
        clientId: fila['client_id'] as string,
        clientName: fila['client_name'] as string,
        clientChatId: toNumberOrNull(fila['client_chat_id']),
        versionId: fila['version_id'] as string,
        state: fila['state'] as VersionState,
        sentAt: new Date(fila['sent_at'] as string),
        lastWeekSent: Number(fila['last_week_sent']),
      }));
    },

    async createCheckin(clientId, versionId, weekNumber) {
      const { data, error } = await db.rpc('create_checkin', {
        p_client_id: clientId,
        p_version_id: versionId,
        p_week_number: weekNumber,
      });

      if (error !== null || data === null) {
        throw new Error(`No se pudo crear el check-in: ${error?.code ?? 'sin datos'}`);
      }

      return data as string;
    },

    async markSent(checkinId) {
      const { error } = await db.rpc('mark_checkin_sent', { p_checkin_id: checkinId });
      if (error !== null) throw new Error(`No se pudo marcar enviado: ${error.code}`);
    },

    async pendingReminders() {
      const { data, error } = await db.rpc('checkins_to_remind');

      if (error !== null) throw new Error(`No se pudieron leer los pendientes: ${error.code}`);

      return (data ?? []).map((fila: Record<string, unknown>) => ({
        checkinId: fila['checkin_id'] as string,
        clientChatId: Number(fila['client_chat_id']),
        weekNumber: Number(fila['week_number']),
        state: fila['state'] as 'PENDING' | 'COMPLETED',
        sentAt: new Date(fila['sent_at'] as string),
        reminderSentAt:
          fila['reminder_sent_at'] === null
            ? null
            : new Date(fila['reminder_sent_at'] as string),
      }));
    },

    async markReminded(checkinId) {
      const { error } = await db.rpc('mark_checkin_reminded', { p_checkin_id: checkinId });
      if (error !== null) throw new Error(`No se pudo marcar el recordatorio: ${error.code}`);
    },

    findCheckin: (checkinId) =>
      readCheckin(db, 'checkin_for_reply', { p_checkin_id: checkinId }),

    findOpenCheckin: (profileId) =>
      readCheckin(db, 'open_checkin_for_profile', { p_profile_id: profileId }),

    async saveAnswers(checkinId, answers, completed) {
      const { error } = await db.rpc('save_checkin_answers', {
        p_checkin_id: checkinId,
        p_answers: answers,
        p_completed: completed,
      });

      // El mensaje de error NUNCA lleva las respuestas: son datos de salud.
      if (error !== null) throw new Error(`No se pudieron guardar las respuestas: ${error.code}`);
    },
  };
}

/** Las dos consultas de check-in devuelven la misma fila: se leen igual. */
async function readCheckin(
  db: Db,
  fn: 'checkin_for_reply' | 'open_checkin_for_profile',
  args: Record<string, string>,
): Promise<CheckinForReply | null> {
  const { data, error } = await db.rpc(fn, args).maybeSingle();

  if (error !== null) throw new Error(`No se pudo leer el check-in: ${error.code}`);
  if (data === null) return null;

  const fila = data as Record<string, unknown>;
  const guardadas = (fila['answers'] ?? {}) as Partial<CheckinAnswers>;

  return {
    checkinId: fila['checkin_id'] as string,
    clientProfileId: (fila['client_profile_id'] as string | null) ?? null,
    clientName: fila['client_name'] as string,
    weekNumber: Number(fila['week_number']),
    state: fila['state'] as 'PENDING' | 'COMPLETED',
    // `answers` es NULL mientras no conteste nada: los tres campos a `null`
    // significan «sin contestar», que no es lo mismo que «ninguna».
    answers: {
      sessions: guardadas.sessions ?? null,
      feeling: guardadas.feeling ?? null,
      discomfort: guardadas.discomfort ?? null,
    },
    trainerChatId: Number(fila['trainer_chat_id']),
    daysPerWeek: toNumberOrNull(fila['days_per_week']),
  };
}
