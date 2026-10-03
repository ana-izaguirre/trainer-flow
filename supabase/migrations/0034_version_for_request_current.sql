-- =============================================================================
-- SPEC-010 regla 13 — `startRevision` necesita saber si YA hay una versión
-- en marcha, no solo el estado de la v1 original.
--
-- Cada comentario que el cliente escribe (`add_change_comment`) le reenvía
-- al entrenador un aviso con su propio botón, y los tres —el original y los
-- de cada comentario— apuntan a la MISMA v1. Sin saber cuál es la versión
-- VIGENTE del plan ahora mismo, `_core` no puede distinguir "primera vez que
-- tocan el botón" de "ya se creó la v2 y esto es un botón viejo".
--
-- `create or replace` no puede agregar columnas al final de un `returns
-- table`: hay que `drop` primero (igual que ya hizo la 0013 con los checkins).
-- -----------------------------------------------------------------------------

drop function if exists version_for_request(uuid);

create function version_for_request(p_version_id uuid)
returns table (
  version_id             uuid,
  state                   version_state,
  plan_id                 uuid,
  version_number          smallint,
  client_id               uuid,
  trainer_id              uuid,
  client_profile_id       uuid,
  client_name             text,
  trainer_chat_id         bigint,
  current_version_id      uuid,
  current_version_state   version_state,
  current_version_number  smallint
)
language sql
security invoker
stable
as $$
  select
    v.id,
    v.state,
    v.plan_id,
    v.version_number,
    c.id,
    c.trainer_id,
    c.profile_id,
    c.full_name,
    coalesce(t.telegram_chat_id, t.telegram_user_id),
    cv.id,
    cv.state,
    cv.version_number
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  join profiles         t on t.id  = c.trainer_id
  join workout_versions cv on cv.id = pl.current_version_id
  where v.id = p_version_id;
$$;

comment on function version_for_request is
  'La versión con su dueño y su plan, MÁS la vigente del plan (regla 13: evita una v3 por accidente).';

revoke all on function version_for_request from anon, authenticated;
