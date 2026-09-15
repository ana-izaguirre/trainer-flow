-- =============================================================================
-- SPEC-000 — Esquema inicial de TrainerFlow
--
-- Principio rector: la IA es una CAPACIDAD, no la dueña del dominio.
--   · version_state no contiene ningún estado de IA
--   · el estado de la IA vive en ai_generations
--   · assessment_id es nullable: una rutina manual no necesita formulario
--
-- Reglas (docs/specs/SPEC-000, sección 4):
--   1. Toda tabla tiene id y created_at.
--   2. Toda FK declara explícitamente su ON DELETE.
--   3. Toda restricción expresable en SQL existe como CHECK.
--   4. UNIQUE (source, external_id) en webhook_events.
--   5. UNIQUE (client_id, version_id, week_number) en checkins.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type user_role as enum ('trainer', 'client');

-- De dónde salió el contenido de una versión. Las tres son iguales para el
-- dominio: producen el mismo WorkoutDraft y pasan la misma validación.
create type version_source as enum ('ai', 'template', 'manual');

-- Estados del DOMINIO. Ninguno describe qué está haciendo la IA.
-- Ver docs/STATE-MACHINE.md para la tabla de transiciones.
create type version_state as enum (
  'NEW',         -- creada, sin contenido; esperando origen
  'GENERATING',  -- la IA está trabajando
  'DRAFT',       -- contenido listo, en manos del entrenador
  'APPROVED',    -- aprobada, pendiente de entrega
  'SENT',        -- entregada al cliente (terminal)
  'REJECTED'     -- descartada (terminal)
);

create type change_reason as enum (
  'too_hard', 'too_easy', 'too_long', 'no_equipment',
  'uncomfortable_exercise', 'want_variety', 'other'
);

-- -----------------------------------------------------------------------------
-- updated_at automático. Contabilidad, no lógica de negocio.
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
-- profiles — identidad
--
-- La identidad sale del webhook de Telegram, verificado server-side.
-- telegram_user_id (quién eres) y telegram_chat_id (dónde te escribo) son
-- conceptos distintos aunque coincidan en chats privados.
-- -----------------------------------------------------------------------------
create table profiles (
  id               uuid        primary key default gen_random_uuid(),
  telegram_user_id bigint      not null unique,
  telegram_chat_id bigint      unique,
  role             user_role   not null,
  full_name        text        not null,
  created_at       timestamptz not null default now(),

  constraint profiles_full_name_not_blank
    check (length(btrim(full_name)) > 0),

  -- Permite que otras tablas referencien (id, role) y así validar el rol
  -- en la base de datos, no solo en código.
  constraint profiles_id_role_uniq unique (id, role)
);

comment on column profiles.telegram_user_id is
  'La identidad. Viene del update verificado de Telegram, nunca del cliente.';

-- -----------------------------------------------------------------------------
-- clients — la relación entrenador ↔ cliente
-- -----------------------------------------------------------------------------
create table clients (
  id           uuid        primary key default gen_random_uuid(),

  trainer_id   uuid        not null,
  -- Columna fija que permite la FK compuesta de abajo. Un CHECK la ancla.
  trainer_role user_role   not null default 'trainer',

  profile_id   uuid        unique,
  client_role  user_role   not null default 'client',

  full_name    text        not null,
  email        text,
  link_token   text        not null unique,
  linked_at    timestamptz,
  created_at   timestamptz not null default now(),

  constraint clients_trainer_role_fixed check (trainer_role = 'trainer'),
  constraint clients_client_role_fixed  check (client_role  = 'client'),

  -- Es IMPOSIBLE asignar como entrenador el perfil de un cliente.
  constraint clients_trainer_must_be_trainer
    foreign key (trainer_id, trainer_role)
    references profiles (id, role) on delete restrict,

  constraint clients_profile_must_be_client
    foreign key (profile_id, client_role)
    references profiles (id, role) on delete set null,

  constraint clients_full_name_not_blank
    check (length(btrim(full_name)) > 0),

  -- Credencial del deep link: nunca vacía, nunca más larga que el límite de
  -- 64 caracteres del /start de Telegram.
  constraint clients_link_token_length
    check (length(link_token) between 16 and 64),

  -- La vinculación es atómica: o hay perfil y fecha, o no hay ninguno.
  constraint clients_link_consistency
    check ((profile_id is null) = (linked_at is null))
);

comment on column clients.link_token is
  'Credencial del deep link. CSPRNG. Nunca se escribe en logs.';

create index clients_trainer_id_idx on clients (trainer_id);

create unique index clients_trainer_email_uniq
  on clients (trainer_id, lower(email))
  where email is not null;

-- -----------------------------------------------------------------------------
-- assessments — evaluaciones de Tally
-- -----------------------------------------------------------------------------
create table assessments (
  id                 uuid        primary key default gen_random_uuid(),
  client_id          uuid        not null references clients (id) on delete cascade,

  -- Se guarda íntegro SIEMPRE: si el parsing falla o Tally cambia sus campos,
  -- el dato original no se pierde.
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

  constraint assessments_limitations_consistency
    check (has_limitations or limitations_detail is null)
);

comment on column assessments.limitations_detail is
  'Información de salud. NUNCA en logs ni en plan_events.metadata.';

create index assessments_client_id_idx on assessments (client_id, created_at desc);

-- -----------------------------------------------------------------------------
-- workout_plans — el contenedor
--
-- assessment_id es NULLABLE a propósito: una rutina manual o de plantilla no
-- necesita un formulario de Tally. El dominio no depende de la IA.
-- -----------------------------------------------------------------------------
create table workout_plans (
  id                 uuid        primary key default gen_random_uuid(),
  client_id          uuid        not null references clients (id) on delete cascade,
  assessment_id      uuid        references assessments (id) on delete set null,
  current_version_id uuid,  -- FK añadida al final: referencia circular
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger workout_plans_set_updated_at
  before update on workout_plans
  for each row execute function set_updated_at();

create index workout_plans_client_id_idx on workout_plans (client_id, created_at desc);

-- -----------------------------------------------------------------------------
-- workout_versions — las revisiones
--
-- Cada versión guarda un SNAPSHOT COMPLETO. Una versión en SENT no se toca
-- nunca: un cambio produce version + 1 y la anterior queda intacta.
-- -----------------------------------------------------------------------------
create table workout_versions (
  id               uuid           primary key default gen_random_uuid(),
  plan_id          uuid           not null references workout_plans (id) on delete cascade,
  version_number   smallint       not null,
  state            version_state  not null default 'NEW',

  -- El Workout completo y validado. NULL solo antes de tener contenido.
  content          jsonb,

  source           version_source not null,
  template_id      text,
  created_by       uuid           not null references profiles (id) on delete restrict,
  trainer_feedback text,
  edit_count       smallint       not null default 0,
  sent_at          timestamptz,
  created_at       timestamptz    not null default now(),
  updated_at       timestamptz    not null default now(),

  constraint workout_versions_number_positive
    check (version_number >= 1),

  -- También es idempotencia: un reintento no crea dos veces la misma versión.
  constraint workout_versions_unique_number
    unique (plan_id, version_number),

  constraint workout_versions_edit_count_range
    check (edit_count between 0 and 5),

  -- Una versión que el entrenador puede revisar, o que ya salió, TIENE contenido.
  constraint workout_versions_content_required
    check (content is not null or state in ('NEW', 'GENERATING', 'REJECTED')),

  -- SENT si y solo si hay fecha de envío. checkins.week_number depende de ello.
  constraint workout_versions_sent_at_required
    check ((state = 'SENT') = (sent_at is not null)),

  -- template_id existe si y solo si el origen es una plantilla.
  constraint workout_versions_template_consistency
    check ((source = 'template') = (template_id is not null))
);

create trigger workout_versions_set_updated_at
  before update on workout_versions
  for each row execute function set_updated_at();

create index workout_versions_plan_idx
  on workout_versions (plan_id, version_number desc);

-- Índice parcial para /pendientes: lo que espera decisión del entrenador.
create index workout_versions_draft_idx
  on workout_versions (plan_id)
  where state = 'DRAFT';

-- Ahora que existe la tabla, se cierra la referencia circular.
alter table workout_plans
  add constraint workout_plans_current_version_fk
  foreign key (current_version_id) references workout_versions (id)
  on delete set null;

-- -----------------------------------------------------------------------------
-- change_requests — solicitudes del cliente
--
-- Tabla aparte, NO columnas en la versión: escribir la solicitud dentro de v1
-- la mutaría, y una versión enviada debe permanecer intacta.
-- -----------------------------------------------------------------------------
create table change_requests (
  id                     uuid          primary key default gen_random_uuid(),
  version_id             uuid          not null references workout_versions (id) on delete cascade,
  client_id              uuid          not null references clients (id) on delete cascade,
  reason                 change_reason not null,
  comment                text,
  state                  text          not null default 'OPEN',
  resolved_by_version_id uuid          references workout_versions (id) on delete set null,
  created_at             timestamptz   not null default now(),
  resolved_at            timestamptz,

  constraint change_requests_state_valid
    check (state in ('OPEN', 'RESOLVED')),

  constraint change_requests_comment_length
    check (comment is null or length(comment) <= 500),

  constraint change_requests_resolved_consistency
    check ((state = 'RESOLVED') = (resolved_at is not null))
);

comment on column change_requests.comment is
  'Texto libre del cliente. Puede contener información de salud: no se loguea.';

create index change_requests_open_idx
  on change_requests (client_id, created_at)
  where state = 'OPEN';

-- -----------------------------------------------------------------------------
-- ai_generations — intentos de IA y control de rate limit
--
-- Una fila por CADA intento, exitoso o no. Aquí vive todo el estado de la IA,
-- fuera del enum del dominio.
--
-- El rate limit es una VENTANA, no un saldo: el tier gratuito limita
-- peticiones por minuto y por día, y se reinicia. El chequeo es
-- COUNT(*) sobre created_at, nunca una resta.
-- -----------------------------------------------------------------------------
create table ai_generations (
  id             bigint      generated always as identity primary key,
  provider       text        not null,
  model          text        not null,
  operation      text        not null,
  version_id     uuid        references workout_versions (id) on delete set null,
  request_id     uuid,
  status         text        not null default 'GENERATING',
  failure_reason text,
  tokens_in      integer,
  tokens_out     integer,
  latency_ms     integer,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,

  constraint ai_generations_operation_valid
    check (operation in ('generate', 'edit')),

  constraint ai_generations_status_valid
    check (status in ('GENERATING', 'SUCCEEDED', 'FAILED')),

  constraint ai_generations_failure_consistency
    check ((status = 'FAILED') = (failure_reason is not null)),

  constraint ai_generations_metrics_non_negative
    check (
      (tokens_in  is null or tokens_in  >= 0) and
      (tokens_out is null or tokens_out >= 0) and
      (latency_ms is null or latency_ms >= 0)
    )
);

comment on table ai_generations is
  'Estado y métricas de la IA. Mantiene al dominio ignorante del proveedor.';

-- La consulta caliente: "cuántas llamadas en la ventana vigente".
create index ai_generations_window_idx on ai_generations (provider, created_at desc);

-- -----------------------------------------------------------------------------
-- plan_events — audit trail
--
-- Append-only. Responde "¿por qué Carlos no recibió su rutina?".
-- -----------------------------------------------------------------------------
create table plan_events (
  id         bigint        generated always as identity primary key,
  plan_id    uuid          not null references workout_plans (id) on delete cascade,
  version_id uuid          references workout_versions (id) on delete cascade,
  event_type text          not null,
  from_state version_state,
  to_state   version_state,
  actor      text          not null,
  request_id uuid,
  metadata   jsonb,
  created_at timestamptz   not null default now(),

  constraint plan_events_actor_valid
    check (actor in ('system', 'ai', 'trainer', 'client')),

  -- Una transición nombra su destino; los demás eventos no.
  constraint plan_events_transition_consistency
    check ((event_type = 'state_transition') = (to_state is not null))
);

comment on column plan_events.metadata is
  'Metadatos de la transición. NUNCA datos de salud ni credenciales.';

create index plan_events_plan_idx on plan_events (plan_id, created_at);
create index plan_events_request_idx on plan_events (request_id) where request_id is not null;

-- -----------------------------------------------------------------------------
-- checkins — seguimiento semanal
-- -----------------------------------------------------------------------------
create table checkins (
  id               uuid        primary key default gen_random_uuid(),
  client_id        uuid        not null references clients (id) on delete cascade,

  -- NOT NULL a propósito: en PostgreSQL los NULL no colisionan dentro de un
  -- UNIQUE, así que con esta columna anulable la garantía de que el cron no
  -- duplica check-ins no existiría de verdad.
  version_id       uuid        not null references workout_versions (id) on delete cascade,

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

  constraint checkins_completed_consistency
    check ((state = 'COMPLETED') = (completed_at is not null)),

  -- Correr el cron dos veces NO puede crear dos check-ins de la misma semana.
  constraint checkins_unique_per_week
    unique (client_id, version_id, week_number)
);

create index checkins_pending_idx
  on checkins (client_id, sent_at)
  where state = 'PENDING';

-- -----------------------------------------------------------------------------
-- webhook_events — idempotencia
--
-- Todo webhook inserta aquí ANTES de hacer nada más. Si la inserción viola la
-- unicidad, el evento ya se procesó: responder 200 y salir.
-- -----------------------------------------------------------------------------
create table webhook_events (
  id           bigint      generated always as identity primary key,
  source       text        not null,
  external_id  text        not null,
  payload      jsonb       not null,
  request_id   uuid,
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
