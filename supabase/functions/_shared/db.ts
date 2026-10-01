/**
 * Acceso a PostgreSQL desde las Edge Functions.
 *
 * Usa `service_role`, que salta RLS por diseño. **Por eso toda operación debe
 * pasar antes por `_core/authorization.ts`** (ADR-010).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Identity } from '../_core/domain/identity.ts';
import type {
  AssessmentToIngest,
  AssessmentUpdateToIngest,
  IngestedIds,
  TallyRepo,
  UpdatedAssessment,
} from '../_core/ports/tally-ports.ts';
import type { ComparableAssessment } from '../_core/assessment/changes.ts';
import type { UpdateTokenRepo } from '../_core/ports/update-ports.ts';
import type {
  GenerationOutcome,
  GenerationRecord,
  GenerationRepo,
  VersionForGeneration,
} from '../_core/ports/generation-ports.ts';
import type { EditRepo } from '../_core/ports/edit-ports.ts';
import type { AIRequest } from '../_core/ports/ai-provider.ts';
import type { Level } from '../_core/domain/assessment.ts';
import type { VersionState } from '../_core/domain/version.ts';
import type { Workout } from '../_core/domain/workout.ts';
import type { ActionRepo } from '../_core/ports/action-ports.ts';
import type { ChangeRequestRepo } from '../_core/ports/change-request-ports.ts';
import type { ChangeReason } from '../_core/domain/change-request.ts';
import type { IntakeRepo } from '../_core/ports/intake-ports.ts';
import type { LinkResendRepo } from '../_core/ports/link-ports.ts';
import type { LinkReminderRepo } from '../_core/ports/link-reminder-ports.ts';
import type { CreationRepo } from '../_core/ports/creation-ports.ts';
import type { CheckinAnswers } from '../_core/checkin/answers.ts';
import type { CheckinForReply, CheckinRepo } from '../_core/ports/checkin-ports.ts';
import type { ClientSummary, QueryRepo } from '../_core/ports/query-ports.ts';
import type { DeliveryRepo, VersionForDelivery } from '../_core/ports/delivery-ports.ts';
import type { SweepRepo } from '../_core/ports/sweep-ports.ts';
import type { TelegramRepo } from '../_core/ports/telegram-ports.ts';
import type { Database, Json } from '../_core/database.types.ts';
import { requireEnv } from './env.ts';

/**
 * Tipado con `database.types.ts`, que CI genera desde las migraciones: un
 * nombre de función, de argumento o de columna que no exista rompe
 * `deno check`, en vez de leerse como `undefined` en producción.
 *
 * ┌─ LO QUE LOS TIPOS GENERADOS NO SABEN ──────────────────────────────────┐
 * │ postgres-meta no modela la nulidad en las funciones SQL:               │
 * │                                                                        │
 * │  · un ARGUMENTO sin default sale como no nulo, aunque SQL acepte NULL  │
 * │    → `nullArg`                                                         │
 * │  · una COLUMNA devuelta sale como no nula, aunque venga de un LEFT     │
 * │    JOIN → por eso los `?? null` y `toNumberOrNull` se quedan           │
 * │                                                                        │
 * │ Los tipos garantizan los NOMBRES; la nulidad sigue siendo cosa nuestra. │
 * └────────────────────────────────────────────────────────────────────────┘
 */
export type Db = SupabaseClient<Database>;

/**
 * Un argumento que puede ser NULL. Se sigue enviando `null`, igual que antes:
 * solo le dice al compilador lo que SQL ya acepta.
 */
function nullArg<T>(value: T | null): T {
  return value as T;
}

/**
 * Un valor de dominio hacia una columna `jsonb`. `Workout` o `CheckinAnswers`
 * son JSON puro, pero una interfaz no encaja con la firma de índice de `Json`.
 * Es la única conversión hacia la base: centralizada para que no se reparta.
 */
function toJson(value: unknown): Json {
  return value as Json;
}

/** El camino de vuelta de `toJson`: lo que se guardó como dominio, se lee así. */
function fromJson<T>(value: Json): T {
  return value as unknown as T;
}

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
    .insert({ source, external_id: externalId, payload: toJson(payload), request_id: requestId });

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
    ingestAssessmentUpdate: (input) => ingestAssessmentUpdate(db, input),
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
      p_raw_payload: toJson(input.rawPayload),
      p_goal: input.goal,
      p_level: input.level,
      p_days_per_week: input.daysPerWeek,
      p_session_minutes: input.sessionMinutes,
      p_equipment: input.equipment,
      p_has_limitations: input.hasLimitations,
      p_limitations_detail: nullArg(input.limitationsDetail),
      p_lifestyle: nullArg(input.lifestyle),
      p_notes: nullArg(input.notes),
      p_request_id: requestId,
      // SPEC-016
      p_gender: nullArg(input.gender),
      p_age: nullArg(input.age),
      p_weight_kg: nullArg(input.weightKg),
      p_height_cm: nullArg(input.heightCm),
      p_last_weighed: nullArg(input.lastWeighed),
      p_quit_reasons: nullArg(input.quitReasons),
      p_menopause_stage: nullArg(input.menopauseStage),
      p_chronic_conditions: nullArg(input.chronicConditions),
      p_birth_date: nullArg(input.birthDate),
      p_medications: nullArg(input.medications),
      p_equipment_detail: nullArg(input.equipmentDetail),
    })
    .single();

  // El mensaje NO lleva el detalle del error de Postgres: podría citar el
  // valor de una columna, y una de ellas es información de salud.
  if (error !== null || data === null) {
    throw new Error(`No se pudo guardar la evaluación: ${error?.code ?? 'sin datos'}`);
  }

  const fila = data;
  return { clientId: fila.client_id, planId: fila.plan_id, versionId: fila.version_id };
}

/**
 * SPEC-027: invoca `ingest_assessment_update`. Consume el token y guarda la
 * evaluación para SU cliente, en una sola operación.
 *
 * Sin filas es la respuesta normal a un token que no vale: `null`, no error.
 * El token no va en ningún mensaje de error.
 */
async function ingestAssessmentUpdate(
  db: Db,
  input: AssessmentUpdateToIngest,
): Promise<UpdatedAssessment | null> {
  const { data, error } = await db
    .rpc('ingest_assessment_update', {
      p_token: input.token,
      p_raw_payload: toJson(input.rawPayload),
      p_goal: input.goal,
      p_level: input.level,
      p_days_per_week: input.daysPerWeek,
      p_session_minutes: input.sessionMinutes,
      p_equipment: input.equipment,
      p_has_limitations: input.hasLimitations,
      p_limitations_detail: nullArg(input.limitationsDetail),
      p_lifestyle: nullArg(input.lifestyle),
      p_notes: nullArg(input.notes),
      p_gender: nullArg(input.gender),
      p_age: nullArg(input.age),
      p_weight_kg: nullArg(input.weightKg),
      p_height_cm: nullArg(input.heightCm),
      p_last_weighed: nullArg(input.lastWeighed),
      p_quit_reasons: nullArg(input.quitReasons),
      p_menopause_stage: nullArg(input.menopauseStage),
      p_chronic_conditions: nullArg(input.chronicConditions),
      p_birth_date: nullArg(input.birthDate),
      p_medications: nullArg(input.medications),
      p_equipment_detail: nullArg(input.equipmentDetail),
    })
    .maybeSingle();

  // Igual que `ingestAssessment`: el detalle de Postgres podría citar un
  // valor de salud, así que solo viaja el código.
  if (error !== null) throw new Error(`No se pudo guardar la actualización: ${error.code}`);
  if (data === null) return null;

  const fila = data;
  return {
    clientId: fila.client_id,
    clientName: fila.client_name,
    // Los tipos generados no marcan nulos en las funciones: aquí sí pueden
    // serlo (cliente sin chat, plan sin versión).
    clientChatId: (fila.client_chat_id as number | null) ?? null,
    assessmentId: fila.assessment_id,
    previous: leerEvaluacionAnterior(fila.previous as Json | null),
    planId: (fila.plan_id as string | null) ?? null,
    versionId: (fila.version_id as string | null) ?? null,
    versionState: (fila.version_state as VersionState | null) ?? null,
  };
}

/** La fila de `assessments` en JSON, a los nombres del dominio. */
function leerEvaluacionAnterior(json: Json | null): ComparableAssessment | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const a = json as Record<string, Json | undefined>;
  const texto = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : null);
  const numero = (k: string) => toNumberOrNull(a[k]);

  return {
    goal: texto('goal') ?? '',
    level: (texto('level') ?? 'beginner') as Level,
    daysPerWeek: numero('days_per_week') ?? 0,
    sessionMinutes: numero('session_minutes') ?? 0,
    equipment: texto('equipment') ?? '',
    hasLimitations: a['has_limitations'] === true,
    limitationsDetail: texto('limitations_detail'),
    lifestyle: texto('lifestyle'),
    notes: texto('notes'),
    gender: texto('gender'),
    age: numero('age'),
    weightKg: numero('weight_kg'),
    heightCm: numero('height_cm'),
    lastWeighed: texto('last_weighed'),
    quitReasons: texto('quit_reasons'),
    menopauseStage: texto('menopause_stage'),
    chronicConditions: texto('chronic_conditions'),
    birthDate: texto('birth_date'),
    medications: texto('medications'),
    equipmentDetail: texto('equipment_detail'),
  };
}

/**
 * SPEC-027: emitir el token de actualización. El token viaja en claro hasta
 * la base, que guarda su hash (`update_token_hash`, migración 0026).
 */
export function createUpdateTokenRepo(db: Db): UpdateTokenRepo {
  return {
    async issueForProfile(profileId, token) {
      const { data, error } = await db.rpc('issue_update_token_for_profile', {
        p_profile_id: profileId,
        p_token: token,
      });
      if (error !== null) throw new Error(`No se pudo emitir el enlace: ${error.code}`);
      return (data as string | null) ?? null;
    },

    async issueForClient(clientId, token) {
      const { data, error } = await db.rpc('issue_update_token_for_client', {
        p_client_id: clientId,
        p_token: token,
      });
      if (error !== null) throw new Error(`No se pudo emitir el enlace: ${error.code}`);
      return (data as number | null) ?? null;
    },
  };
}

// -----------------------------------------------------------------------------
// Generación con IA (SPEC-002)
// -----------------------------------------------------------------------------

/**
 * Las tres operaciones sobre `ai_generations` que generar (SPEC-002) y
 * editar (SPEC-004) comparten: es la MISMA tabla, la MISMA cuota — solo
 * cambia `operation` entre `'generate'` y `'edit'`.
 */
function sharedGenerationLog(db: Db, requestId: string) {
  return {
    async recentGenerations(windowMinutes: number): Promise<readonly Date[]> {
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

    async startGeneration(record: GenerationRecord): Promise<number> {
      const { data, error } = await db
        .from('ai_generations')
        .insert({
          provider: record.provider,
          model: record.model,
          operation: record.operation,
          version_id: record.versionId,
          request_id: requestId,
          status: 'GENERATING',
        })
        .select('id')
        .single();

      if (error !== null || data === null) {
        throw new Error(`No se pudo registrar la llamada a la IA: ${error?.code ?? 'sin datos'}`);
      }

      return data.id as number;
    },

    async finishGeneration(id: number, outcome: GenerationOutcome): Promise<void> {
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

      // Que el cierre falle no puede tumbar una llamada que sí funcionó, pero
      // tampoco puede pasar en silencio: la fila queda en GENERATING para
      // siempre y la cuota deja de cuadrar.
      if (error !== null) throw new Error(`No se pudo cerrar el registro: ${error.code}`);
    },
  };
}

export function createGenerationRepo(db: Db, requestId: string): GenerationRepo {
  return {
    findVersion: (versionId) => findVersionForGeneration(db, versionId),
    ...sharedGenerationLog(db, requestId),

    async transition(versionId, from, to) {
      // `apply_version_transition` lleva la guarda de concurrencia: devuelve
      // false si el estado esperado ya no es el actual.
      const { data, error } = await db.rpc('apply_version_transition', {
        p_version_id: versionId,
        p_expected_state: from,
        p_new_state: to,
        p_actor: 'system',
      });

      if (error !== null) throw new Error(`No se pudo aplicar la transición: ${error.code}`);

      return data === true;
    },

    async saveContent(versionId, workout: Workout) {
      const { error } = await db
        .from('workout_versions')
        .update({ content: toJson(workout) })
        .eq('id', versionId);

      if (error !== null) throw new Error(`No se pudo guardar la rutina: ${error.code}`);
    },
  };
}

/**
 * Las columnas que `version_for_generation` y `version_awaiting_edit`
 * devuelven IGUAL, para armar un `AIRequest` (SPEC-002 / SPEC-004). `unknown`
 * en cada campo a propósito: las dos funciones SQL generan un tipo de fila
 * distinto, y lo único que esta firma pide es que la columna exista — el
 * cast real va adentro, igual que antes de compartirse.
 */
interface FilaConDatosDeAIRequest {
  readonly goal: unknown;
  readonly level: unknown;
  readonly days_per_week: unknown;
  readonly session_minutes: unknown;
  readonly equipment: unknown;
  readonly equipment_detail: unknown;
  readonly limitations: unknown;
  readonly gender: unknown;
  readonly age: unknown;
  readonly weight_kg: unknown;
  readonly height_cm: unknown;
  readonly quit_reasons: unknown;
  readonly menopause_stage: unknown;
  readonly last_weighed: unknown;
  readonly chronic_conditions: unknown;
  readonly medications: unknown;
  readonly lifestyle: unknown;
  readonly notes: unknown;
}

/**
 * El mapeo de fila SQL a `AIRequest`, compartido entre generar y editar
 * (antes vivía duplicado en los dos sitios — ver SPEC-032 §3.1). `instruction`
 * queda afuera: generar manda `null`, editar manda el texto del entrenador,
 * y cada llamador lo decide al construir el objeto final.
 */
function filaToAIRequest(fila: FilaConDatosDeAIRequest): Omit<AIRequest, 'instruction'> {
  return {
    goal: fila.goal as string,
    level: fila.level as Level,
    daysPerWeek: fila.days_per_week as number,
    sessionMinutes: fila.session_minutes as number,
    equipment: fila.equipment as string,
    equipmentDetail: (fila.equipment_detail as string | null) ?? null,
    limitations: (fila.limitations as string | null) ?? null,
    gender: (fila.gender as string | null) ?? null,
    age: fila.age === null ? null : Number(fila.age),
    weightKg: fila.weight_kg === null ? null : Number(fila.weight_kg),
    heightCm: fila.height_cm === null ? null : Number(fila.height_cm),
    quitReasons: (fila.quit_reasons as string | null) ?? null,
    menopauseStage: (fila.menopause_stage as string | null) ?? null,
    lastWeighed: (fila.last_weighed as string | null) ?? null,
    chronicConditions: (fila.chronic_conditions as string | null) ?? null,
    medications: (fila.medications as string | null) ?? null,
    lifestyle: (fila.lifestyle as string | null) ?? null,
    notes: (fila.notes as string | null) ?? null,
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

  const fila = data;

  return {
    versionId: fila.version_id as string,
    state: fila.state as VersionState,
    clientName: fila.client_name as string,
    versionNumber: Number(fila.version_number),
    // Generar desde cero, no editar: la edición llega en el bloque 7.
    request: { ...filaToAIRequest(fila), instruction: null },
    constraints: {
      daysPerWeek: fila.days_per_week as number,
      hasLimitations: fila.has_limitations as boolean,
    },
    trainerChatId: Number(fila.trainer_chat_id),
  };
}

/**
 * Implementa el puerto `SweepRepo` (SPEC-002 §11).
 *
 * Reusa `apply_version_transition`: es la MISMA guarda de concurrencia que
 * usa cualquier otro camino, así que una generación que sí terminó un
 * instante antes de esta pasada no se pisa.
 */
export function createSweepRepo(db: Db): SweepRepo {
  return {
    async staleGenerations(minMinutes) {
      const { data, error } = await db.rpc('stale_generating_versions', {
        p_min_minutes: minMinutes,
      });

      if (error !== null) {
        throw new Error(`No se pudieron leer las generaciones atascadas: ${error.code}`);
      }

      return (data ?? []).map((fila) => ({
        versionId: fila.version_id as string,
        trainerChatId: Number(fila.trainer_chat_id),
        clientName: fila.client_name as string,
        minutesStuck: Number(fila.minutes_stuck),
      }));
    },

    async transition(versionId, from, to) {
      const { data, error } = await db.rpc('apply_version_transition', {
        p_version_id: versionId,
        p_expected_state: from,
        p_new_state: to,
        // Lo fuerza el barrido, no una decisión del entrenador ni la propia
        // generación: queda registrado como quien es.
        p_actor: 'system',
      });

      if (error !== null) throw new Error(`No se pudo aplicar la transición: ${error.code}`);

      return data === true;
    },
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

      const fila = data;
      const chatDelEntrenador = fila.trainer_chat_id;

      return {
        clientId: fila.client_id as string,
        fullName: fila.full_name as string,
        linkedProfileId: (fila.linked_profile_id as string | null) ?? null,
        linkedTelegramUserId: toNumberOrNull(fila.linked_telegram_user_id),
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
        p_new_state: to,
        // La entrega la dispara el sistema, no una pulsación (SPEC-005 §5).
        p_actor: 'system',
      });

      if (error !== null) throw new Error(`No se pudo aplicar la transición: ${error.code}`);

      return data === true;
    },

    async resolveRequests(versionId) {
      const { data, error } = await db.rpc('resolve_change_requests', {
        p_version_id: versionId,
      });

      if (error !== null) throw new Error(`No se pudieron cerrar las solicitudes: ${error.code}`);

      return Number(data ?? 0);
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
type DeliveryFn = 'version_for_delivery' | 'approved_version_for_client' | 'sent_version_for_profile';

async function readDelivery(
  db: Db,
  fn: DeliveryFn,
  args: Database['public']['Functions'][DeliveryFn]['Args'],
): Promise<VersionForDelivery | null> {
  const { data, error } = await db.rpc(fn, args).maybeSingle();

  if (error !== null) throw new Error(`No se pudo leer la versión: ${error.code}`);
  if (data === null) return null;

  const fila = data;
  const goal = fila.goal as string | null;

  return {
    versionId: fila.version_id as string,
    state: fila.state as VersionState,
    content: fromJson<Workout>(fila.content),
    clientName: fila.client_name as string,
    // NULL si aún no canjeó su enlace: no hay dónde escribirle, pero la
    // versión se devuelve igual para poder avisar al entrenador (CA-3).
    clientChatId: toNumberOrNull(fila.client_chat_id),
    trainerChatId: Number(fila.trainer_chat_id),
    versionNumber: Number(fila.version_number),
    // Los tres van juntos o no va ninguno: una rutina manual no tiene
    // formulario detrás (SPEC-005 regla 13).
    plan:
      goal === null
        ? null
        : {
            goal,
            daysPerWeek: Number(fila.days_per_week),
            sessionMinutes: Number(fila.session_minutes),
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

      const fila = data;

      return {
        versionId: fila.version_id as string,
        state: fila.state as VersionState,
        versionNumber: Number(fila.version_number),
        content: fila.content === null ? null : fromJson<Workout>(fila.content),
        clientName: fila.client_name as string,
        client: {
          clientId: fila.client_id as string,
          trainerId: fila.trainer_id as string,
          profileId: (fila.client_profile_id as string | null) ?? null,
        },
        // SPEC-004 regla 9: con 5, «✏️ Editar» no pregunta nada.
        editCount: Number(fila.edit_count),
        // `null` si el plan no viene de Tally: entonces al aprobar se valida
        // la forma, no el encaje con unos criterios que no existen.
        constraints:
          fila.days_per_week === null || fila.days_per_week === undefined
            ? null
            : {
                daysPerWeek: Number(fila.days_per_week),
                hasLimitations: fila.has_limitations === true,
              },
        // SPEC-031 — para repintar la vista del cliente al navegar. Mismo
        // criterio que `constraints`: sin evaluación, no hay plan que mostrar.
        plan:
          fila.goal === null || fila.goal === undefined
            ? null
            : {
                goal: fila.goal as string,
                daysPerWeek: Number(fila.days_per_week),
                sessionMinutes: Number(fila.session_minutes),
              },
      };
    },

    async transition(versionId, from, to) {
      const { data, error } = await db.rpc('apply_version_transition', {
        p_version_id: versionId,
        p_expected_state: from,
        p_new_state: to,
        // Fue el entrenador quien pulsó: es el actor que queda en el evento.
        p_actor: 'trainer',
        p_request_id: requestId,
      });

      if (error !== null) throw new Error(`No se pudo aplicar la transición: ${error.code}`);

      return data === true;
    },

    async startEditWait(versionId) {
      const { data, error } = await db.rpc('start_edit_instruction', { p_version_id: versionId });

      if (error !== null) throw new Error(`No se pudo prender la espera de edición: ${error.code}`);

      return data === true;
    },
  };
}

// -----------------------------------------------------------------------------
// La edición conversacional (SPEC-004)
// -----------------------------------------------------------------------------

/**
 * Implementa el puerto `EditRepo`.
 *
 * `findAwaitingEdit` es el mismo patrón que `findVersionForGeneration`
 * (SPEC-002): mismas columnas, mismo `AIRequest` armado por `filaToAIRequest`.
 * La única diferencia real es la función SQL que RPC-ea
 * (`version_awaiting_edit` en vez de `version_for_generation`).
 */
export function createEditRepo(db: Db, requestId: string): EditRepo {
  return {
    async findAwaitingEdit(trainerId) {
      const { data, error } = await db
        .rpc('version_awaiting_edit', { p_trainer_id: trainerId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la espera de edición: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        versionId: fila.version_id as string,
        editCount: Number(fila.edit_count),
        clientName: fila.client_name as string,
        versionNumber: Number(fila.version_number),
        // La instrucción la completa `applyEditInstruction` con el texto
        // recibido: aquí todavía no se sabe.
        request: { ...filaToAIRequest(fila), instruction: null },
        constraints: {
          daysPerWeek: fila.days_per_week as number,
          hasLimitations: fila.has_limitations as boolean,
        },
        trainerChatId: Number(fila.trainer_chat_id),
      };
    },

    async cancelEditWait(versionId) {
      const { error } = await db.rpc('cancel_edit_instruction', { p_version_id: versionId });
      if (error !== null) throw new Error(`No se pudo cancelar la espera de edición: ${error.code}`);
    },

    async cancelAnyEditWait(trainerId) {
      const { error } = await db.rpc('cancel_any_edit_instruction', { p_trainer_id: trainerId });
      if (error !== null) throw new Error(`No se pudo cancelar la espera de edición: ${error.code}`);
    },

    ...sharedGenerationLog(db, requestId),

    async saveEditedContent(versionId, workout) {
      // Misma función SQL que el editor manual (`save_draft_content`): es la
      // MISMA columna `edit_count`, y las dos apagan la espera al guardar.
      const { data, error } = await db.rpc('save_draft_content', {
        p_version_id: versionId,
        p_content: toJson(workout),
      });

      if (error !== null) throw new Error(`No se pudo guardar la edición: ${error.code}`);

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

      return (data ?? []).map((fila) => ({
        clientId: fila.client_id as string,
        clientName: fila.client_name as string,
        clientChatId: toNumberOrNull(fila.client_chat_id),
        versionId: fila.version_id as string,
        state: fila.state as VersionState,
        sentAt: new Date(fila.sent_at as string),
        lastWeekSent: Number(fila.last_week_sent),
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

      return (data ?? []).map((fila) => ({
        checkinId: fila.checkin_id as string,
        clientChatId: Number(fila.client_chat_id),
        weekNumber: Number(fila.week_number),
        state: fila.state as 'PENDING' | 'COMPLETED',
        sentAt: new Date(fila.sent_at as string),
        reminderSentAt:
          fila.reminder_sent_at === null
            ? null
            : new Date(fila.reminder_sent_at as string),
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
        p_answers: toJson(answers),
        p_completed: completed,
      });

      // El mensaje de error NUNCA lleva las respuestas: son datos de salud.
      if (error !== null) throw new Error(`No se pudieron guardar las respuestas: ${error.code}`);
    },
  };
}

/** Las dos consultas de check-in devuelven la misma fila: se leen igual. */
type CheckinFn = 'checkin_for_reply' | 'open_checkin_for_profile';

async function readCheckin(
  db: Db,
  fn: CheckinFn,
  args: Database['public']['Functions'][CheckinFn]['Args'],
): Promise<CheckinForReply | null> {
  const { data, error } = await db.rpc(fn, args).maybeSingle();

  if (error !== null) throw new Error(`No se pudo leer el check-in: ${error.code}`);
  if (data === null) return null;

  const fila = data;
  const guardadas = (fila.answers ?? {}) as Partial<CheckinAnswers>;

  return {
    checkinId: fila.checkin_id as string,
    clientProfileId: (fila.client_profile_id as string | null) ?? null,
    clientName: fila.client_name as string,
    weekNumber: Number(fila.week_number),
    state: fila.state as 'PENDING' | 'COMPLETED',
    sentAt: new Date((fila.sent_at ?? new Date(0).toISOString()) as string),
    // `answers` es NULL mientras no conteste nada: los tres campos a `null`
    // significan «sin contestar», que no es lo mismo que «ninguna».
    answers: {
      sessions: guardadas.sessions ?? null,
      feeling: guardadas.feeling ?? null,
      discomfort: guardadas.discomfort ?? null,
    },
    trainerChatId: Number(fila.trainer_chat_id),
    daysPerWeek: toNumberOrNull(fila.days_per_week),
  };
}

// -----------------------------------------------------------------------------
// Las consultas del entrenador (SPEC-007)
// -----------------------------------------------------------------------------

/**
 * Implementa el puerto `QueryRepo`.
 *
 * **Ninguna de estas funciones escribe.** Las cuatro son `stable` en SQL y el
 * puerto no expone nada más: un comando no puede aprobar una rutina aunque
 * alguien lo intentara, porque no tiene con qué.
 *
 * El filtro por `trainer_id` va en el `WHERE` de cada consulta, no aquí: el
 * entrenador no puede recibir a un cliente ajeno ni por error de este código.
 */
export function createQueryRepo(db: Db): QueryRepo {
  return {
    async clients(trainerId) {
      const { data, error } = await db.rpc('trainer_clients', { p_trainer_id: trainerId });

      if (error !== null) throw new Error(`No se pudo leer la cartera: ${error.code}`);

      return (data ?? []).map((fila) => leerResumen(fila));
    },

    async clientDetail(clientId) {
      const { data, error } = await db
        .rpc('trainer_client_detail', { p_client_id: clientId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la ficha: ${error.code}`);
      if (data === null) return null;

      const fila = data;
      const respuestas = fila.last_answers as Record<string, unknown> | null;
      const semana = fila.last_week_number;

      return {
        ...leerResumen(fila),
        versionId: (fila.version_id as string | null) ?? null,
        goal: (fila.goal as string | null) ?? null,
        level: (fila.level as Level | null) ?? null,
        daysPerWeek: toNumberOrNull(fila.days_per_week),
        sessionMinutes: toNumberOrNull(fila.session_minutes),
        equipment: (fila.equipment as string | null) ?? null,
        hasLimitations: fila.has_limitations === true,
        sentDaysAgo: toNumberOrNull(fila.sent_days_ago),
        // Sin respuestas no hay check-in que contar: uno a medias y uno que
        // no existe se distinguen por este `null`.
        lastCheckin:
          respuestas === null || semana === null || semana === undefined
            ? null
            : {
                weekNumber: Number(semana),
                sessions: toNumberOrNull(respuestas['sessions']),
                feeling: (respuestas['feeling'] as string | null) ?? null,
                discomfort: (respuestas['discomfort'] as string | null) ?? null,
              },
        // SPEC-030 regla 11.
        openChangeRequest:
          fila.change_request_reason === null
            ? null
            : {
                reason: fila.change_request_reason as ChangeReason,
                daysAgo: Number(fila.change_request_days_ago),
              },
      };
    },

    async pendingVersions(trainerId) {
      const { data, error } = await db.rpc('trainer_pending_versions', {
        p_trainer_id: trainerId,
      });

      if (error !== null) throw new Error(`No se pudieron leer las pendientes: ${error.code}`);

      return (data ?? []).map((fila) => ({
        versionId: fila.version_id as string,
        clientName: fila.client_name as string,
        versionNumber: Number(fila.version_number),
        daysWaiting: Number(fila.days_waiting),
      }));
    },

    async awaitingLink(trainerId) {
      const { data, error } = await db.rpc('trainer_awaiting_link', {
        p_trainer_id: trainerId,
      });

      if (error !== null) throw new Error(`No se pudieron leer las que esperan enlace: ${error.code}`);

      return (data ?? []).map((fila) => ({
        versionId: fila.version_id as string,
        clientName: fila.client_name as string,
        versionNumber: Number(fila.version_number),
        daysWaiting: Number(fila.days_waiting),
      }));
    },

    async staleCheckins(trainerId, minDays) {
      const { data, error } = await db.rpc('trainer_stale_checkins', {
        p_trainer_id: trainerId,
        p_min_days: minDays,
      });

      if (error !== null) throw new Error(`No se pudieron leer los check-ins: ${error.code}`);

      return (data ?? []).map((fila) => ({
        clientName: fila.client_name as string,
        weekNumber: Number(fila.week_number),
        daysWaiting: Number(fila.days_waiting),
        reminded: fila.reminded === true,
      }));
    },

    // SPEC-023. Reutiliza `readDelivery` porque el cliente ve exactamente lo
    // que recibió: misma forma, mismo formateo, mismos botones.
    clientRoutine(profileId) {
      return readDelivery(db, 'sent_version_for_profile', { p_profile_id: profileId });
    },
  };
}

/** La parte que `/clientes` y `/cliente` comparten, leída una sola vez. */
/** Las columnas que lee `leerResumen`: las devuelven las DOS consultas que la usan. */
type ResumenFila = Pick<
  Database['public']['Functions']['trainer_clients']['Returns'][number],
  'client_id' | 'full_name' | 'version_state' | 'version_number' | 'linked' | 'pending_checkin_days'
>;

function leerResumen(fila: ResumenFila): ClientSummary {
  return {
    clientId: fila.client_id as string,
    fullName: fila.full_name as string,
    versionState: (fila.version_state as VersionState | null) ?? null,
    versionNumber: toNumberOrNull(fila.version_number),
    linked: fila.linked === true,
    pendingCheckinDays: toNumberOrNull(fila.pending_checkin_days),
  };
}

// -----------------------------------------------------------------------------
// Plantillas, creación manual y editor (SPEC-008)
// -----------------------------------------------------------------------------

/**
 * Implementa el puerto `CreationRepo`.
 *
 * **Ninguna de estas operaciones conoce a ningún proveedor de IA.** Es lo que
 * hace cierto que el sistema funcione completo sin ella: con Gemini caído,
 * este camino sigue creando rutinas.
 */
/**
 * SPEC-015 — La evaluación completa, para el botón 📄.
 *
 * Es el único repo de solo lectura del sistema: no expone nada con lo que
 * escribir, así que «leer no transiciona» lo garantiza el tipo.
 */
export function createIntakeRepo(db: Db): IntakeRepo {
  return {
    async findIntake(versionId) {
      const { data, error } = await db
        .rpc('assessment_for_version', { p_version_id: versionId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la evaluación: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        versionId: fila.version_id as string,
        state: fila.state as VersionState,
        client: {
          clientId: fila.client_id as string,
          trainerId: fila.trainer_id as string,
          profileId: (fila.client_profile_id as string | null) ?? null,
        },
        clientName: fila.client_name as string,
        goal: fila.goal as string,
        level: fila.level as Level,
        daysPerWeek: Number(fila.days_per_week),
        sessionMinutes: Number(fila.session_minutes),
        equipment: fila.equipment as string,
        hasLimitations: fila.has_limitations === true,
        limitationsDetail: (fila.limitations_detail as string | null) ?? null,
        lifestyle: (fila.lifestyle as string | null) ?? null,
        notes: (fila.notes as string | null) ?? null,
        submittedAt: new Date(fila.submitted_at as string),
        gender: (fila.gender as string | null) ?? null,
        age: fila.age === null ? null : Number(fila.age),
        // `numeric` llega como string por PostgREST: sin el Number, el peso se
        // pintaría bien por casualidad y fallaría en cuanto alguien lo sume.
        weightKg: fila.weight_kg === null ? null : Number(fila.weight_kg),
        heightCm: fila.height_cm === null ? null : Number(fila.height_cm),
        lastWeighed: (fila.last_weighed as string | null) ?? null,
        quitReasons: (fila.quit_reasons as string | null) ?? null,
        menopauseStage: (fila.menopause_stage as string | null) ?? null,
        chronicConditions: (fila.chronic_conditions as string | null) ?? null,
        medications: (fila.medications as string | null) ?? null,
          equipmentDetail: (fila.equipment_detail as string | null) ?? null,
        // `date` llega como string por PostgREST, y así se queda: convertirlo
        // metería la zona horaria del servidor en una fecha de nacimiento.
        birthDate: (fila.birth_date as string | null) ?? null,
      };
    },
  };
}

/**
 * Implementa el puerto `LinkResendRepo` (SPEC-014 §3).
 *
 * Igual que `createIntakeRepo`: es de solo lectura, así que no expone nada
 * con lo que escribir.
 */
export function createLinkResendRepo(db: Db): LinkResendRepo {
  return {
    async findClientForVersion(versionId) {
      const { data, error } = await db
        .rpc('client_for_resend', { p_version_id: versionId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer el cliente: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        client: {
          clientId: fila.client_id as string,
          trainerId: fila.trainer_id as string,
          profileId: (fila.profile_id as string | null) ?? null,
        },
        fullName: fila.full_name as string,
        linked: fila.linked === true,
        linkToken: fila.link_token as string,
      };
    },
  };
}

/** SPEC-030 regla 13. Vive junto a `createLinkResendRepo`: mismo tema. */
export function createLinkReminderRepo(db: Db): LinkReminderRepo {
  return {
    async awaitingReminder(minHours) {
      const { data, error } = await db.rpc('versions_awaiting_link_reminder', {
        p_min_hours: minHours,
      });

      if (error !== null) {
        throw new Error(`No se pudieron leer los enlaces sin abrir: ${error.code}`);
      }

      return (data ?? []).map((fila) => ({
        versionId: fila.version_id as string,
        trainerChatId: Number(fila.trainer_chat_id),
        clientName: fila.client_name as string,
      }));
    },

    async markReminded(versionId) {
      const { error } = await db.rpc('mark_link_reminded', { p_version_id: versionId });
      if (error !== null) throw new Error(`No se pudo marcar el aviso: ${error.code}`);
    },
  };
}

export function createCreationRepo(db: Db, requestId: string): CreationRepo {
  return {
    async findVersion(versionId) {
      // La misma consulta que usan los botones, más los criterios: lo que
      // hace falta para ordenar plantillas y para `applyTemplate`.
      const { data, error } = await db
        .rpc('version_for_creation', { p_version_id: versionId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la versión: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        versionId: fila.version_id as string,
        state: fila.state as VersionState,
        // SPEC-013: sin esto, los tres flujos de creación no podían
        // comprobar de quién era la versión sobre la que actuaban.
        client: {
          clientId: fila.client_id as string,
          trainerId: fila.trainer_id as string,
          profileId: (fila.client_profile_id as string | null) ?? null,
        },
        clientName: fila.client_name as string,
        versionNumber: Number(fila.version_number),
        daysPerWeek: toNumberOrNull(fila.days_per_week),
        level: (fila.level as Level | null) ?? null,
        equipment: (fila.equipment as string | null) ?? null,
        hasLimitations: fila.has_limitations === true,
      };
    },

    async fillVersion(versionId, expected, source, templateId, content) {
      const { data, error } = await db.rpc('fill_version', {
        p_version_id: versionId,
        p_expected_state: expected,
        p_source: source,
        p_template_id: nullArg(templateId),
        p_content: toJson(content),
        p_request_id: requestId,
      });

      if (error !== null) throw new Error(`No se pudo cargar el borrador: ${error.code}`);

      return data === true;
    },

    async currentDraft(trainerId) {
      const { data, error } = await db
        .rpc('current_draft_for_trainer', { p_trainer_id: trainerId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer el borrador: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        versionId: fila.version_id as string,
        versionNumber: Number(fila.version_number),
        clientName: fila.client_name as string,
        content: fromJson<Workout>(fila.content),
      };
    },

    async saveDraft(versionId, content) {
      const { data, error } = await db.rpc('save_draft_content', {
        p_version_id: versionId,
        p_content: toJson(content),
      });

      if (error !== null) throw new Error(`No se pudo guardar la edición: ${error.code}`);

      // `false` no es un fallo: se aprobó mientras el entrenador escribía.
      return data === true;
    },
  };
}

// -----------------------------------------------------------------------------
// Solicitudes de cambio (SPEC-010)
// -----------------------------------------------------------------------------

/**
 * Implementa el puerto `ChangeRequestRepo`.
 *
 * **Ninguna de estas operaciones escribe en `workout_versions`.** La regla 4
 * dice que la versión enviada queda intacta, y aquí no hay con qué tocarla.
 */
export function createChangeRequestRepo(db: Db, httpRequestId: string): ChangeRequestRepo {
  return {
    async findVersion(versionId) {
      const { data, error } = await db
        .rpc('version_for_request', { p_version_id: versionId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la versión: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        versionId: fila.version_id as string,
        state: fila.state as VersionState,
        planId: fila.plan_id as string,
        clientName: fila.client_name as string,
        versionNumber: Number(fila.version_number),
        trainerChatId: Number(fila.trainer_chat_id),
        client: {
          clientId: fila.client_id as string,
          trainerId: fila.trainer_id as string,
          profileId: (fila.client_profile_id as string | null) ?? null,
        },
      };
    },

    async request(versionId, clientId, reason) {
      // SPEC-030: ahora devuelve `(id, created)`, no solo el id — `created`
      // es lo que decide si se avisa al entrenador (regla 2).
      const { data, error } = await db
        .rpc('request_change', { p_version_id: versionId, p_client_id: clientId, p_reason: reason })
        .maybeSingle();

      if (error !== null || data === null) {
        throw new Error(`No se pudo registrar la solicitud: ${error?.code ?? 'sin datos'}`);
      }

      return { id: data.id as string, created: data.created === true };
    },

    async openForClient(profileId) {
      const { data, error } = await db
        .rpc('open_change_request_for_client', { p_profile_id: profileId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la solicitud: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        requestId: fila.request_id as string,
        clientId: fila.client_id as string,
        versionId: fila.version_id as string,
        reason: fila.reason as ChangeReason,
        hasComment: fila.has_comment === true,
        askedAt: new Date(fila.asked_at as string),
        createdAt: new Date(fila.created_at as string),
      };
    },

    async touchAsk(requestId, clientId) {
      const { data, error } = await db.rpc('touch_change_request_ask', {
        p_request_id: requestId,
        p_client_id: clientId,
      });

      if (error !== null) throw new Error(`No se pudo actualizar la solicitud: ${error.code}`);
      return data === true;
    },

    async addComment(requestId, clientId, comment) {
      const { data, error } = await db
        .rpc('add_change_comment', { p_request_id: requestId, p_client_id: clientId, p_comment: comment })
        .maybeSingle();

      // El mensaje de error NUNCA lleva el comentario: es texto libre del
      // cliente y puede contener información de salud (SPEC-010 §7).
      if (error !== null) throw new Error(`No se pudo guardar el comentario: ${error.code}`);
      if (data === null) return { saved: false, truncated: false };

      return { saved: data.saved === true, truncated: data.truncated === true };
    },

    async findRequest(requestId) {
      const { data, error } = await db
        .rpc('change_request_for_trainer', { p_request_id: requestId })
        .maybeSingle();

      if (error !== null) throw new Error(`No se pudo leer la solicitud: ${error.code}`);
      if (data === null) return null;

      const fila = data;

      return {
        requestId: fila.request_id as string,
        versionId: fila.version_id as string,
        planId: fila.plan_id as string,
        versionNumber: Number(fila.version_number),
        state: fila.state as 'OPEN' | 'RESOLVED',
        reason: fila.reason as ChangeReason,
        comment: (fila.comment as string | null) ?? null,
        clientName: fila.client_name as string,
        trainerId: fila.trainer_id as string,
        sentDaysAgo: toNumberOrNull(fila.sent_days_ago),
      };
    },

    async createRevision(planId, trainerId) {
      // La misma función atómica que crea la primera versión: número bajo
      // bloqueo, plan apuntando a la nueva, y evento registrado.
      const { data, error } = await db.rpc('create_workout_version', {
        p_plan_id: planId,
        p_source: 'manual',
        p_created_by: trainerId,
        p_request_id: httpRequestId,
      });

      if (error !== null || data === null) {
        throw new Error(`No se pudo crear la revisión: ${error?.code ?? 'sin datos'}`);
      }

      return data as string;
    },

    async recordAccepted(versionId, clientId) {
      const { error } = await db.rpc('record_version_accepted', {
        p_version_id: versionId,
        p_client_id: clientId,
        p_request_id: httpRequestId,
      });

      if (error !== null) throw new Error(`No se pudo registrar el visto bueno: ${error.code}`);
    },
  };
}
