-- SPEC-016 (2ª tanda) — Fecha de nacimiento y fármacos.
--
-- ┌─ POR QUÉ FECHA Y NO EDAD ───────────────────────────────────────────────┐
-- │ Se había puesto `age`, y el entrenador pidió fecha de nacimiento. Tiene │
-- │ razón: una edad se queda vieja. Dentro de dos años la ficha seguiría    │
-- │ diciendo «34» y nadie se enteraría.                                     │
-- │                                                                         │
-- │ La fecha es la fuente de verdad. La edad se DERIVA en la consulta, así  │
-- │ que aguas abajo sigue habiendo un solo valor y el TypeScript no cambia. │
-- │ `age` se queda como respaldo por si un formulario pregunta la edad      │
-- │ directamente — es una ENTRADA alternativa, no una segunda verdad.       │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ LOS FÁRMACOS SÍ VAN AL PROMPT ────────────────────────────────────────┐
-- │ Decisión de Ana: la IA recibe todo el contexto clínico.                │
-- │                                                                        │
-- │ El seguro no se toca: `DRAFT → SENT` no existe, así que el entrenador  │
-- │ sigue aprobando cada rutina antes de que salga. Lo que cambia es que   │
-- │ el borrador que él revisa llega ya con el contexto tenido en cuenta,   │
-- │ y con los `warnings` diciendo cómo.                                    │
-- └────────────────────────────────────────────────────────────────────────┘

alter table assessments
  add column birth_date  date,
  add column medications text;

alter table assessments
  add constraint assessments_birth_date_sane
    check (birth_date is null or birth_date between '1900-01-01' and current_date);

comment on column assessments.birth_date is
  'La fuente de verdad de la edad. `age` es solo un respaldo de entrada.';
comment on column assessments.medications is
  'Fármacos que toma. Va al prompt Y a la ficha; el entrenador sigue aprobando.';

-- -----------------------------------------------------------------------------
-- Las tres funciones, recreadas desde su ÚLTIMA versión (0017), no desde la
-- que las creó. Copiar de la migración original pierde columnas en silencio:
-- ya pasó con `version_for_generation` y lo atrapó un E2E.
--
-- La edad se DERIVA de `birth_date` aquí, con `age` de respaldo. Así aguas
-- abajo sigue llegando un solo valor y el TypeScript no cambia.

drop function if exists ingest_assessment(
  uuid, text, text, jsonb, text, text, smallint, smallint, text, boolean,
  text, text, text, uuid, text, smallint, numeric, smallint, text, text, text, text
);

create function ingest_assessment(
  p_trainer_id         uuid,
  p_full_name          text,
  p_link_token         text,
  p_raw_payload        jsonb,
  p_goal               text,
  p_level              text,
  p_days_per_week      smallint,
  p_session_minutes    smallint,
  p_equipment          text,
  p_has_limitations    boolean,
  p_limitations_detail text default null,
  p_lifestyle          text default null,
  p_notes              text default null,
  p_request_id         uuid default null,
  p_gender             text default null,
  p_age                smallint default null,
  p_weight_kg          numeric default null,
  p_height_cm          smallint default null,
  p_last_weighed       text default null,
  p_quit_reasons       text default null,
  p_menopause_stage    text default null,
  p_chronic_conditions text default null,
  p_birth_date         date default null,
  p_medications        text default null
)
returns table (
  client_id     uuid,
  assessment_id uuid,
  plan_id       uuid,
  version_id    uuid
)
language plpgsql
security invoker
as $$
declare
  v_client_id     uuid;
  v_assessment_id uuid;
  v_plan_id       uuid;
  v_version_id    uuid;
begin
  insert into clients (trainer_id, full_name, link_token)
  values (p_trainer_id, p_full_name, p_link_token)
  returning id into v_client_id;

  insert into assessments (
    client_id, raw_payload, goal, level, days_per_week, session_minutes,
    equipment, has_limitations, limitations_detail, lifestyle, notes,
    gender, age, weight_kg, height_cm, last_weighed, quit_reasons,
    menopause_stage, chronic_conditions, birth_date, medications
  ) values (
    v_client_id, p_raw_payload, p_goal, p_level, p_days_per_week, p_session_minutes,
    p_equipment, p_has_limitations, p_limitations_detail, p_lifestyle, p_notes,
    p_gender, p_age, p_weight_kg, p_height_cm, p_last_weighed, p_quit_reasons,
    p_menopause_stage, p_chronic_conditions, p_birth_date, p_medications
  )
  returning id into v_assessment_id;

  insert into workout_plans (client_id, assessment_id)
  values (v_client_id, v_assessment_id)
  returning id into v_plan_id;

  v_version_id := create_workout_version(
    v_plan_id, 'ai'::version_source, p_trainer_id, null, null, p_request_id
  );

  return query select v_client_id, v_assessment_id, v_plan_id, v_version_id;
end;
$$;

comment on function ingest_assessment is
  'Cliente + evaluación + plan + primera versión, atómico (SPEC-001).';

revoke all on function ingest_assessment from anon, authenticated;

-- -----------------------------------------------------------------------------

drop function if exists version_for_generation(uuid);

create function version_for_generation(p_version_id uuid)
returns table (
  version_id         uuid,
  state              version_state,
  version_number     smallint,
  client_name        text,
  goal               text,
  level              text,
  days_per_week      smallint,
  session_minutes    smallint,
  equipment          text,
  limitations        text,
  has_limitations    boolean,
  trainer_chat_id    bigint,
  gender             text,
  age                smallint,
  weight_kg          numeric,
  height_cm          smallint,
  quit_reasons       text,
  menopause_stage    text,
  last_weighed       text,
  chronic_conditions text,
  medications        text
)
language sql
security invoker
stable
as $$
  select
    v.id,
    v.state,
    v.version_number,
    c.full_name,
    a.goal,
    a.level,
    a.days_per_week,
    a.session_minutes,
    a.equipment,
    -- Solo se manda el detalle si el cliente declaró limitaciones. El CHECK de
    -- la tabla ya lo garantiza, pero leerlo explícito evita que un cambio
    -- futuro filtre un detalle huérfano al prompt.
    case when a.has_limitations then a.limitations_detail end,
    a.has_limitations,
    -- En un chat privado coinciden, pero son conceptos distintos (ADR-009).
    coalesce(p.telegram_chat_id, p.telegram_user_id),
    a.gender,
    -- La fecha manda; `age` solo si el formulario preguntó la edad directa.
    coalesce(
      extract(year from age(a.created_at, a.birth_date))::smallint,
      a.age
    ),
    a.weight_kg,
    a.height_cm,
    a.quit_reasons,
    a.menopause_stage,
    a.last_weighed,
    a.chronic_conditions,
    a.medications
  from workout_versions v
  join workout_plans  pl on pl.id = v.plan_id
  join assessments     a on a.id  = pl.assessment_id
  join clients         c on c.id  = pl.client_id
  join profiles        p on p.id  = c.trainer_id
  where v.id = p_version_id;
$$;

comment on function version_for_generation is
  'Todo el contexto que el prompt necesita. El entrenador sigue aprobando (SPEC-016).';

revoke all on function version_for_generation from anon, authenticated;

-- -----------------------------------------------------------------------------

drop function if exists assessment_for_version(uuid);

create function assessment_for_version(p_version_id uuid)
returns table (
  version_id         uuid,
  client_id          uuid,
  trainer_id         uuid,
  client_profile_id  uuid,
  state              version_state,
  client_name        text,
  goal               text,
  level              text,
  days_per_week      smallint,
  session_minutes    smallint,
  equipment          text,
  has_limitations    boolean,
  limitations_detail text,
  lifestyle          text,
  notes              text,
  submitted_at       timestamptz,
  gender             text,
  age                smallint,
  weight_kg          numeric,
  height_cm          smallint,
  last_weighed       text,
  quit_reasons       text,
  menopause_stage    text,
  chronic_conditions text,
  birth_date         date,
  medications        text
)
language sql
security invoker
stable
as $$
  select
    v.id, c.id, c.trainer_id, c.profile_id, v.state, c.full_name,
    a.goal, a.level, a.days_per_week, a.session_minutes, a.equipment,
    a.has_limitations, a.limitations_detail, a.lifestyle, a.notes, a.created_at,
    a.gender,
    coalesce(extract(year from age(a.created_at, a.birth_date))::smallint, a.age),
    a.weight_kg, a.height_cm, a.last_weighed,
    a.quit_reasons, a.menopause_stage, a.chronic_conditions,
    a.birth_date, a.medications
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  join assessments      a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function assessment_for_version is
  'La evaluación completa, para la ficha 📄 del entrenador (SPEC-015).';

revoke all on function assessment_for_version from anon, authenticated;
