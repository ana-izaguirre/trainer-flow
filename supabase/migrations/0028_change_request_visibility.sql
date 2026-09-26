-- =============================================================================
-- SPEC-030 — Reglas 11 y 14: la solicitud abierta, visible en dos sitios más
--
-- Hasta aquí, una solicitud de cambio abierta solo se veía si el cliente
-- volvía a tocar el botón (SPEC-030 regla 1) o el entrenador leía el aviso
-- original. En la ficha no aparecía, y una versión APPROVED esperando que el
-- cliente abra su enlace solo se veía entrando cliente por cliente: no
-- estaba junto a las `/pendientes` de verdad, que son las DRAFT.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- trainer_client_detail — con la solicitud abierta, si hay una
--
-- Solo motivo y días (regla 11): el comentario puede traer datos de salud y
-- la ficha se lee de un vistazo en el móvil. Está completo en el aviso que
-- ya recibió el entrenador cuando se creó.
-- -----------------------------------------------------------------------------
drop function if exists trainer_client_detail(uuid);

create function trainer_client_detail(p_client_id uuid)
returns table (
  client_id                 uuid,
  full_name                 text,
  version_state             version_state,
  version_number            smallint,
  linked                    boolean,
  pending_checkin_days      integer,
  goal                      text,
  level                     text,
  days_per_week             smallint,
  session_minutes           smallint,
  equipment                 text,
  has_limitations           boolean,
  sent_days_ago             integer,
  last_week_number          smallint,
  last_answers              jsonb,
  version_id                uuid,
  change_request_reason     change_reason,
  change_request_days_ago   integer
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
    v.id,
    cambio.reason,
    cambio.days_ago
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
  -- La solicitud de cambio abierta, si hay una.
  left join lateral (
    select r.reason, floor(extract(epoch from (now() - r.created_at)) / 86400)::integer as days_ago
      from change_requests r
     where r.client_id = c.id and r.state = 'OPEN'
     order by r.created_at desc
     limit 1
  ) cambio on true
  where c.id = p_client_id;
$$;

comment on function trainer_client_detail is
  'La ficha de un cliente. NO devuelve limitations_detail ni el comentario de '
  'la solicitud: solo el booleano y el motivo. Lleva version_id para los '
  'botones de la ficha (SPEC-007 regla 7) y la solicitud abierta (SPEC-030 regla 11).';

revoke all on function trainer_client_detail from anon, authenticated;

-- -----------------------------------------------------------------------------
-- trainer_awaiting_link — versiones APPROVED esperando que el cliente abra
-- su enlace, para la segunda lista de `/pendientes` (SPEC-030 regla 14)
--
-- Antes solo se veían entrando a la ficha de cada cliente uno por uno.
-- -----------------------------------------------------------------------------
create function trainer_awaiting_link(p_trainer_id uuid)
returns table (
  version_id     uuid,
  client_name    text,
  version_number smallint,
  days_waiting   integer
)
language sql
security invoker
stable
as $$
  select
    v.id,
    c.full_name,
    v.version_number,
    floor(extract(epoch from (now() - v.updated_at)) / 86400)::integer
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  where c.trainer_id = p_trainer_id
    and v.state = 'APPROVED'
    and c.profile_id is null
  order by v.updated_at;
$$;

comment on function trainer_awaiting_link is
  'Rutinas APPROVED esperando que el cliente abra su enlace. La más antigua primero.';

revoke all on function trainer_awaiting_link from anon, authenticated;
