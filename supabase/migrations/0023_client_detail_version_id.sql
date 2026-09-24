-- =============================================================================
-- SPEC-007 (ampliada) / SPEC-015 — La ficha necesita el version_id vigente
--
-- `/cliente <nombre>` va a llevar botones (SPEC-007 regla 7): "Nueva versión"
-- y "Ver evaluación" actúan sobre una versión concreta, y hasta ahora
-- `trainer_client_detail` nunca devolvía su id.
--
-- Hace falta el DROP: `create or replace` no puede cambiar el tipo de retorno
-- de una función que ya existe, y añadir una columna a un `returns table` lo
-- es. Mismo patrón que "version_for_action, otra vez" en 0012.
-- =============================================================================

drop function if exists trainer_client_detail(uuid);

create function trainer_client_detail(p_client_id uuid)
returns table (
  client_id            uuid,
  full_name            text,
  version_state        version_state,
  version_number       smallint,
  linked               boolean,
  pending_checkin_days integer,
  goal                 text,
  level                text,
  days_per_week        smallint,
  session_minutes      smallint,
  equipment            text,
  has_limitations      boolean,
  sent_days_ago        integer,
  last_week_number     smallint,
  last_answers         jsonb,
  version_id           uuid
)
language sql
security invoker
stable
as $$
  select
    c.id,
    c.full_name,
    v.state,
    v.version_number,
    c.profile_id is not null,
    (
      select floor(extract(epoch from (now() - min(k.sent_at))) / 86400)::integer
        from checkins k
       where k.client_id = c.id and k.state = 'PENDING' and k.sent_at is not null
    ),
    a.goal,
    a.level,
    a.days_per_week,
    a.session_minutes,
    a.equipment,
    coalesce(a.has_limitations, false),
    case when v.sent_at is not null
         then floor(extract(epoch from (now() - v.sent_at)) / 86400)::integer
    end,
    ultimo.week_number,
    ultimo.answers,
    v.id
  from clients c
  left join workout_plans    pl on pl.client_id = c.id
  left join workout_versions  v on v.id = pl.current_version_id
  left join assessments       a on a.id = pl.assessment_id
  -- El último check-in CONTESTADO: uno a medias no dice nada del cliente.
  left join lateral (
    select k.week_number, k.answers
      from checkins k
     where k.client_id = c.id
       and k.answers is not null
     order by k.week_number desc
     limit 1
  ) ultimo on true
  where c.id = p_client_id;
$$;

comment on function trainer_client_detail is
  'La ficha de un cliente. NO devuelve limitations_detail: solo el booleano. Lleva version_id para los botones de la ficha (SPEC-007 regla 7).';

revoke all on function trainer_client_detail from anon, authenticated;
