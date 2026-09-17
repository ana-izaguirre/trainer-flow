-- =============================================================================
-- SPEC-003 — El aviso al entrenador necesita saber de quién es la rutina
--
-- `version_for_generation` traía todo lo que la IA necesita, pero no lo que
-- necesita el MENSAJE: el nombre del cliente y el número de versión. Sin ellos
-- el aviso diría «rutina lista» sin decir de quién, y con varios clientes eso
-- no sirve de nada.
--
-- La 0007 no se edita: las migraciones son inmutables (SPEC-000 regla 8).
--
-- Y hace falta un DROP: `create or replace` NO puede cambiar el tipo de
-- retorno de una función que ya existe, y añadir dos columnas a un
-- `returns table` es cambiarlo. Postgres responde
-- «cannot change return type of existing function», que no dice qué hacer.
-- =============================================================================

drop function if exists version_for_generation(uuid);

create function version_for_generation(p_version_id uuid)
returns table (
  version_id       uuid,
  state            version_state,
  version_number   smallint,
  client_name      text,
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

revoke all on function version_for_generation from anon, authenticated;
