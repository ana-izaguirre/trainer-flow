-- =============================================================================
-- SPEC-002 — Todo lo que la generación necesita saber, en una consulta
--
-- Generar una rutina necesita datos de cinco tablas: la versión, su plan, la
-- evaluación del cliente, el cliente y el perfil del entrenador (para avisarle
-- si algo falla).
--
-- Va en SQL y no en supabase-js porque encadenar cinco `select` anidados
-- produce algo que nadie vuelve a leer, y porque son cinco viajes a la base
-- para responder una sola pregunta.
--
-- NO contiene reglas de negocio: solo reúne. Quién puede generar lo decide
-- `_core`, y cuándo, la máquina de estados.
-- =============================================================================

create or replace function version_for_generation(p_version_id uuid)
returns table (
  version_id       uuid,
  state            version_state,
  goal             text,
  level            text,
  days_per_week    smallint,
  session_minutes  smallint,
  equipment        text,
  limitations      text,
  has_limitations  boolean,
  trainer_chat_id  bigint
)
language sql
security invoker
stable
as $$
  select
    v.id,
    v.state,
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
    -- En un chat privado coinciden, pero son conceptos distintos: uno es quién
    -- eres y el otro dónde te escribo (ADR-009).
    coalesce(p.telegram_chat_id, p.telegram_user_id)
  from workout_versions v
  join workout_plans  pl on pl.id = v.plan_id
  join assessments     a on a.id  = pl.assessment_id
  join clients         c on c.id  = pl.client_id
  join profiles        p on p.id  = c.trainer_id
  where v.id = p_version_id;
$$;

comment on function version_for_generation is
  'Reúne versión, evaluación y entrenador para una generación. Sin reglas de negocio: solo lee.';

revoke all on function version_for_generation from anon, authenticated;
