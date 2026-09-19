-- SPEC-016 — Las dos funciones que tocan los campos nuevos.
--
-- `drop` antes de recrear: las dos cambian de firma o de tipo de retorno, y
-- `create or replace` no puede con eso. Las migraciones son inmutables
-- (SPEC-000 regla 8), así que 0006 y 0015 se quedan como están.

drop function if exists ingest_assessment(
  uuid, text, text, jsonb, text, text, smallint, smallint, text, boolean,
  text, text, text, uuid
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
  -- SPEC-016. Al final y con default: un llamante viejo sigue funcionando.
  p_gender             text default null,
  p_age                smallint default null,
  p_weight_kg          numeric default null,
  p_height_cm          smallint default null,
  p_last_weighed       text default null,
  p_quit_reasons       text default null,
  p_menopause_stage    text default null,
  p_chronic_conditions text default null
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
  -- SPEC-001 regla 4: el formulario es onboarding, cada envío crea un cliente
  -- nuevo. No se busca uno existente: fusionar por nombre metería la lesión
  -- de un «Carlos» en la rutina de otro, y en silencio.
  insert into clients (trainer_id, full_name, link_token)
  values (p_trainer_id, p_full_name, p_link_token)
  returning id into v_client_id;

  insert into assessments (
    client_id, raw_payload, goal, level, days_per_week, session_minutes,
    equipment, has_limitations, limitations_detail, lifestyle, notes,
    gender, age, weight_kg, height_cm, last_weighed, quit_reasons,
    menopause_stage, chronic_conditions
  ) values (
    v_client_id, p_raw_payload, p_goal, p_level, p_days_per_week, p_session_minutes,
    p_equipment, p_has_limitations, p_limitations_detail, p_lifestyle, p_notes,
    p_gender, p_age, p_weight_kg, p_height_cm, p_last_weighed, p_quit_reasons,
    p_menopause_stage, p_chronic_conditions
  )
  returning id into v_assessment_id;

  insert into workout_plans (client_id, assessment_id)
  values (v_client_id, v_assessment_id)
  returning id into v_plan_id;

  -- SPEC-001 regla 7: la primera versión nace en NEW, con source='ai' y sin
  -- contenido. La IA todavía no corrió, y puede no correr nunca.
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
-- assessment_for_version — ahora con los campos nuevos.
--
-- Incluye `chronic_conditions`, que es el ÚNICO sitio donde sale: esta función
-- alimenta la ficha 📄 que el entrenador pide pulsando un botón, nunca el
-- prompt (SPEC-016 §3.2).

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
  chronic_conditions text
)
language sql
security invoker
stable
as $$
  select
    v.id, c.id, c.trainer_id, c.profile_id, v.state, c.full_name,
    a.goal, a.level, a.days_per_week, a.session_minutes, a.equipment,
    a.has_limitations, a.limitations_detail, a.lifestyle, a.notes, a.created_at,
    a.gender, a.age, a.weight_kg, a.height_cm, a.last_weighed,
    a.quit_reasons, a.menopause_stage, a.chronic_conditions
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  join assessments      a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function assessment_for_version is
  'La evaluación completa. CON chronic_conditions: solo para la ficha del entrenador (SPEC-016).';

revoke all on function assessment_for_version from anon, authenticated;

-- -----------------------------------------------------------------------------
-- version_for_generation — los campos que SÍ van al prompt.
--
-- ┌─ LO QUE ESTE SELECT NO PIDE ────────────────────────────────────────────┐
-- │ `chronic_conditions` no aparece, y no es un olvido: es la misma regla   │
-- │ de §3.2 puesta en SQL. El tipo `AIRequest` no tiene dónde guardarlo y   │
-- │ esta consulta no lo trae. Dos capas, la misma respuesta.                │
-- │                                                                         │
-- │ `last_weighed` tampoco: dice si el peso es fiable, y eso lo juzga una   │
-- │ persona.                                                                │
-- └─────────────────────────────────────────────────────────────────────────┘

drop function if exists version_for_generation(uuid);

create function version_for_generation(p_version_id uuid)
returns table (
  version_id       uuid,
  state            version_state,
  -- Estas dos las añadió 0008. Recrear una función copiando de la migración
  -- que la CREÓ, y no de la última que la tocó, pierde columnas en silencio:
  -- pasó, y lo atrapó un E2E.
  version_number   smallint,
  client_name      text,
  goal             text,
  level            text,
  days_per_week    smallint,
  session_minutes  smallint,
  equipment        text,
  limitations      text,
  has_limitations  boolean,
  trainer_chat_id  bigint,
  gender           text,
  age              smallint,
  weight_kg        numeric,
  height_cm        smallint,
  quit_reasons     text,
  menopause_stage  text
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
    a.age,
    a.weight_kg,
    a.height_cm,
    a.quit_reasons,
    a.menopause_stage
  from workout_versions v
  join workout_plans  pl on pl.id = v.plan_id
  join assessments     a on a.id  = pl.assessment_id
  join clients         c on c.id  = pl.client_id
  join profiles        p on p.id  = c.trainer_id
  where v.id = p_version_id;
$$;

comment on function version_for_generation is
  'Lo que el prompt necesita. NUNCA chronic_conditions ni last_weighed (SPEC-016 §3.2).';

revoke all on function version_for_generation from anon, authenticated;
