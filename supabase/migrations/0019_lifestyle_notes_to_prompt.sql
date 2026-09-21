-- SPEC-016 — `lifestyle` y `notes` también al prompt.
--
-- Comparando campo por campo lo que recoge el formulario contra lo que recibe
-- la IA, estos dos se quedaban fuera sin que nadie lo hubiera decidido:
--
--   · «Sedentario, trabajo de oficina» cambia volumen y recuperación.
--   · «¿Algo más que tu entrenador deba saber?» es lo que el cliente quiso
--     contar con sus propias palabras.
--
-- Se recrea desde la versión de 0018, que es la última. Copiar de la
-- migración que creó la función pierde columnas: ya pasó una vez.

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
  medications        text,
  lifestyle          text,
  notes              text
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
    -- Solo se manda el detalle si el cliente declaró limitaciones.
    case when a.has_limitations then a.limitations_detail end,
    a.has_limitations,
    coalesce(p.telegram_chat_id, p.telegram_user_id),
    a.gender,
    coalesce(extract(year from age(a.created_at, a.birth_date))::smallint, a.age),
    a.weight_kg,
    a.height_cm,
    a.quit_reasons,
    a.menopause_stage,
    a.last_weighed,
    a.chronic_conditions,
    a.medications,
    a.lifestyle,
    a.notes
  from workout_versions v
  join workout_plans  pl on pl.id = v.plan_id
  join assessments     a on a.id  = pl.assessment_id
  join clients         c on c.id  = pl.client_id
  join profiles        p on p.id  = c.trainer_id
  where v.id = p_version_id;
$$;

comment on function version_for_generation is
  'Todo el contexto del formulario que el prompt necesita (SPEC-016).';

revoke all on function version_for_generation from anon, authenticated;
