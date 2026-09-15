-- =============================================================================
-- SPEC-000 — Esquema inicial de TrainerFlow
--
-- Reglas aplicadas (docs/specs/SPEC-000-esquema-base-datos.md, sección 4):
--   1. Toda tabla tiene id y created_at.
--   2. Toda FK declara explícitamente su ON DELETE.
--   3. Toda restricción de negocio expresable en SQL existe como CHECK.
--   4. UNIQUE (source, external_id) en webhook_events.
--   5. UNIQUE (client_id, plan_id, week_number) en checkins.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enum de estados de una rutina
--
-- FAILED y MANUAL existen para que la degradación controlada (ADR-005) tenga
-- dónde apoyarse cuando Gemini falla o no queda margen de cuota.
-- -----------------------------------------------------------------------------
create type plan_state as enum (
  'NEW',
  'GENERATING',
  'DRAFT',
  'TRAINER_REVIEW',
  'EDITING',
  'APPROVED',
  'SENT',
  'REJECTED',
  'FAILED',
  'MANUAL'
);

-- -----------------------------------------------------------------------------
-- updated_at automático.
--
-- Esto es contabilidad, no lógica de negocio: las reglas de negocio viven en
-- las Edge Functions (CLAUDE.md). Un trigger aquí evita olvidos.
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- trainers
--
-- Un solo registro en V1. La tabla existe desde el día 1 para evitar una
-- migración dolorosa cuando haya más de un entrenador.
-- -----------------------------------------------------------------------------
create table trainers (
  id               uuid        primary key default gen_random_uuid(),
  full_name        text        not null,
  telegram_chat_id bigint      unique,
  created_at       timestamptz not null default now(),

  constraint trainers_full_name_not_blank
    check (length(btrim(full_name)) > 0)
);

comment on table trainers is
  'Entrenadores. V1 tiene uno solo, pero la relación existe desde el inicio.';

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
create table clients (
  id               uuid        primary key default gen_random_uuid(),
  trainer_id       uuid        not null references trainers (id) on delete restrict,
  full_name        text        not null,
  email            text,
  telegram_chat_id bigint      unique,
  link_token       text        not null unique,
  linked_at        timestamptz,
  created_at       timestamptz not null default now(),

  constraint clients_full_name_not_blank
    check (length(btrim(full_name)) > 0),

  -- El token del deep link es una credencial: nunca vacío, nunca más largo
  -- que el límite de 64 caracteres del /start de Telegram.
  constraint clients_link_token_length
    check (length(link_token) between 16 and 64),

  -- La vinculación es atómica: o hay chat_id y fecha, o no hay ninguno.
  constraint clients_link_consistency
    check ((telegram_chat_id is null) = (linked_at is null))
);

comment on column clients.link_token is
  'Credencial del deep link de Telegram. CSPRNG. Nunca se escribe en logs.';

create index clients_trainer_id_idx on clients (trainer_id);

-- Un mismo email no puede repetirse dentro de la cartera de un entrenador.
-- Se compara en minúsculas porque los emails no distinguen mayúsculas.
create unique index clients_trainer_email_uniq
  on clients (trainer_id, lower(email))
  where email is not null;

-- -----------------------------------------------------------------------------
-- assessments
--
-- Un cliente puede reevaluarse con el tiempo: 1 cliente → N evaluaciones.
-- -----------------------------------------------------------------------------
create table assessments (
  id                 uuid        primary key default gen_random_uuid(),
  client_id          uuid        not null references clients (id) on delete cascade,

  -- Se guarda íntegro SIEMPRE. Si el parsing falla o Tally cambia sus campos,
  -- el dato original no se pierde (SPEC-001, regla 3).
  raw_payload        jsonb       not null,

  goal               text        not null,
  level              text        not null,
  days_per_week      smallint    not null,
  session_minutes    smallint    not null,
  equipment          text        not null,
  has_limitations    boolean     not null,
  limitations_detail text,
  lifestyle          text,
  notes              text,
  created_at         timestamptz not null default now(),

  constraint assessments_level_valid
    check (level in ('beginner', 'intermediate', 'advanced')),

  constraint assessments_days_per_week_range
    check (days_per_week between 1 and 7),

  constraint assessments_session_minutes_range
    check (session_minutes between 15 and 180),

  -- Sin limitaciones declaradas no puede haber detalle de limitaciones.
  constraint assessments_limitations_consistency
    check (has_limitations or limitations_detail is null)
);

comment on column assessments.limitations_detail is
  'Información de salud. NUNCA se escribe en logs ni en plan_events.metadata.';

create index assessments_client_id_idx on assessments (client_id, created_at desc);

-- -----------------------------------------------------------------------------
-- workout_plans
-- -----------------------------------------------------------------------------
create table workout_plans (
  id                  uuid        primary key default gen_random_uuid(),
  client_id           uuid        not null references clients (id) on delete cascade,
  assessment_id       uuid        not null references assessments (id) on delete cascade,
  state               plan_state  not null default 'NEW',
  version             smallint    not null default 1,
  content             jsonb,
  trainer_feedback    text,
  failure_reason      text,

  -- message_id del mensaje enviado al entrenador, para poder retirarle los
  -- botones después de actuar (SPEC-003, regla 7).
  telegram_message_id bigint,

  -- Máximo 5 ediciones por plan (SPEC-004, regla 9).
  edit_count          smallint    not null default 0,

  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint workout_plans_version_positive
    check (version >= 1),

  constraint workout_plans_edit_count_range
    check (edit_count between 0 and 5),

  -- Un plan que el entrenador puede revisar o que ya salió TIENE contenido.
  -- Los estados sin contenido son los previos a la generación y los de fallo.
  constraint workout_plans_content_required
    check (
      content is not null
      or state in ('NEW', 'GENERATING', 'FAILED', 'MANUAL', 'REJECTED')
    ),

  -- Un plan enviado tiene fecha de envío. checkin week_number depende de ello.
  constraint workout_plans_sent_at_required
    check ((state = 'SENT') = (sent_at is not null))
);

create trigger workout_plans_set_updated_at
  before update on workout_plans
  for each row execute function set_updated_at();

create index workout_plans_client_id_idx on workout_plans (client_id, created_at desc);

-- Índice parcial para /pendientes (SPEC-007).
create index workout_plans_pending_review_idx
  on workout_plans (client_id)
  where state = 'TRAINER_REVIEW';

-- -----------------------------------------------------------------------------
-- plan_events — audit trail
--
-- Append-only. Responde "¿por qué Carlos no recibió su rutina?".
-- -----------------------------------------------------------------------------
create table plan_events (
  id         bigint      generated always as identity primary key,
  plan_id    uuid        not null references workout_plans (id) on delete cascade,
  from_state plan_state,
  to_state   plan_state  not null,
  actor      text        not null,
  metadata   jsonb,
  created_at timestamptz not null default now(),

  constraint plan_events_actor_valid
    check (actor in ('system', 'gemini', 'trainer', 'client'))
);

comment on column plan_events.metadata is
  'Metadatos de la transición. NUNCA datos de salud ni credenciales.';

create index plan_events_plan_id_idx on plan_events (plan_id, created_at);

-- -----------------------------------------------------------------------------
-- checkins
-- -----------------------------------------------------------------------------
create table checkins (
  id               uuid        primary key default gen_random_uuid(),
  client_id        uuid        not null references clients (id) on delete cascade,

  -- NOT NULL a propósito: la restricción UNIQUE de abajo es lo que impide que
  -- el cron duplique check-ins, y en Postgres los NULL no colisionan entre sí.
  -- Con plan_id anulable, esa garantía desaparecería (SPEC-006, regla 3).
  plan_id          uuid        not null references workout_plans (id) on delete cascade,

  week_number      smallint    not null,
  state            text        not null default 'PENDING',
  answers          jsonb,
  sent_at          timestamptz,
  reminder_sent_at timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),

  constraint checkins_week_number_positive
    check (week_number >= 1),

  constraint checkins_state_valid
    check (state in ('PENDING', 'COMPLETED')),

  constraint checkins_completed_at_required
    check ((state = 'COMPLETED') = (completed_at is not null)),

  -- Correr el cron dos veces NO puede crear dos check-ins de la misma semana.
  constraint checkins_unique_per_week
    unique (client_id, plan_id, week_number)
);

create index checkins_pending_idx
  on checkins (client_id, sent_at)
  where state = 'PENDING';

-- -----------------------------------------------------------------------------
-- webhook_events — idempotencia
--
-- Todo webhook inserta aquí ANTES de hacer nada más. Si la inserción viola la
-- restricción de unicidad, el evento ya se procesó: responder 200 y salir.
-- -----------------------------------------------------------------------------
create table webhook_events (
  id           bigint      generated always as identity primary key,
  source       text        not null,
  external_id  text        not null,
  payload      jsonb       not null,
  processed_at timestamptz,
  created_at   timestamptz not null default now(),

  constraint webhook_events_source_valid
    check (source in ('tally', 'telegram')),

  constraint webhook_events_external_id_not_blank
    check (length(btrim(external_id)) > 0),

  -- LA garantía de idempotencia de todo el sistema.
  constraint webhook_events_unique_per_source
    unique (source, external_id)
);

comment on constraint webhook_events_unique_per_source on webhook_events is
  'Garantía de idempotencia. Una violación aquí significa evento duplicado.';

-- -----------------------------------------------------------------------------
-- ai_usage — control de rate limit
--
-- El tier gratuito de Gemini limita por VENTANA DE TIEMPO (peticiones por
-- minuto y por día), no es un saldo que se agota. Por eso el chequeo es
-- COUNT(*) sobre created_at, y no una resta (ADR-005).
-- -----------------------------------------------------------------------------
create table ai_usage (
  id         bigint      generated always as identity primary key,
  provider   text        not null,
  model      text        not null,
  operation  text        not null,
  plan_id    uuid        references workout_plans (id) on delete set null,
  tokens_in  integer,
  tokens_out integer,
  latency_ms integer,
  success    boolean     not null,
  error_code text,
  created_at timestamptz not null default now(),

  constraint ai_usage_operation_valid
    check (operation in ('generate', 'edit')),

  constraint ai_usage_tokens_non_negative
    check (
      (tokens_in  is null or tokens_in  >= 0) and
      (tokens_out is null or tokens_out >= 0) and
      (latency_ms is null or latency_ms >= 0)
    )
);

-- La consulta caliente es "cuántas llamadas en la ventana vigente".
create index ai_usage_window_idx on ai_usage (provider, created_at desc);
