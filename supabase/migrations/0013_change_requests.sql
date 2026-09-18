-- =============================================================================
-- SPEC-010 — Solicitudes de cambio del cliente
--
-- ┌─ LA VERSIÓN ANTERIOR NO SE TOCA ──────────────────────────────────────────┐
-- │ Ni su contenido, ni su estado, ni su `sent_at` (regla 4). Por eso la      │
-- │ solicitud es una FILA APARTE y no columnas en la versión: escribirla      │
-- │ dentro mutaría una rutina ya enviada.                                    │
-- └──────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Una sola solicitud abierta por versión (regla 6, CA-8)
--
-- El índice de la 0001 servía para buscar, no para garantizar. **Una
-- comprobación previa la pasarían dos pulsaciones simultáneas**; un UNIQUE, no.
--
-- Parcial sobre OPEN: las resueltas se acumulan, y deben poder hacerlo — el
-- historial de lo que el cliente pidió es justo lo que da contexto a la v3.
-- -----------------------------------------------------------------------------
create unique index change_requests_one_open_per_version
  on change_requests (version_id)
  where state = 'OPEN';

-- -----------------------------------------------------------------------------
-- request_change
--
-- Inserta la solicitud, o actualiza la abierta si ya había una.
--
-- El `on conflict` es la regla 6 hecha mecanismo: pedir dos cambios sobre la
-- misma rutina cambia el motivo, no crea otra fila.
--
-- **No toca `workout_versions`.** Ni una columna (CA-1, CA-4).
-- -----------------------------------------------------------------------------
create function request_change(
  p_version_id uuid,
  p_client_id  uuid,
  p_reason     change_reason,
  p_comment    text default null
)
returns uuid
language sql
security invoker
as $$
  insert into change_requests (version_id, client_id, reason, comment, state)
  values (p_version_id, p_client_id, p_reason, p_comment, 'OPEN')
  on conflict (version_id) where state = 'OPEN'
    do update set reason  = excluded.reason,
                  -- Un motivo nuevo sin comentario no borra el que ya había:
                  -- el cliente lo escribió una vez.
                  comment = coalesce(excluded.comment, change_requests.comment)
  returning id;
$$;

comment on function request_change is
  'Crea o actualiza la solicitud abierta. NO toca la versión (SPEC-010 CA-4).';

-- -----------------------------------------------------------------------------
-- add_change_comment
--
-- El texto libre que el cliente escribe DESPUÉS de elegir el motivo.
--
-- Solo sobre su propia solicitud abierta: el `client_id` viene de la identidad
-- resuelta del webhook, nunca de la petición.
-- -----------------------------------------------------------------------------
create function add_change_comment(p_request_id uuid, p_client_id uuid, p_comment text)
returns boolean
language plpgsql
security invoker
as $$
begin
  update change_requests
     set comment = left(p_comment, 500)
   where id = p_request_id
     and client_id = p_client_id
     and state = 'OPEN';

  return found;
end;
$$;

comment on function add_change_comment is
  'El comentario del cliente. Es texto libre suyo: puede llevar datos de salud.';

-- -----------------------------------------------------------------------------
-- open_change_request_for_client
--
-- La solicitud abierta de este cliente, para atribuirle un texto libre.
--
-- Devuelve `asked_at` para poder compararla con el check-in abierto: los dos
-- piden texto por el mismo canal y gana el más reciente (SPEC-010 §3).
-- -----------------------------------------------------------------------------
create function open_change_request_for_client(p_profile_id uuid)
returns table (
  request_id uuid,
  client_id  uuid,
  has_comment boolean,
  asked_at   timestamptz
)
language sql
security invoker
stable
as $$
  select r.id, r.client_id, r.comment is not null, r.created_at
    from change_requests r
    join clients c on c.id = r.client_id
   where c.profile_id = p_profile_id
     and r.state = 'OPEN'
   order by r.created_at desc
   limit 1;
$$;

comment on function open_change_request_for_client is
  'La solicitud abierta del cliente. `asked_at` decide contra el check-in.';

-- -----------------------------------------------------------------------------
-- change_request_for_trainer
--
-- Lo que el entrenador necesita ver al recibir el aviso.
-- -----------------------------------------------------------------------------
create function change_request_for_trainer(p_request_id uuid)
returns table (
  request_id      uuid,
  version_id      uuid,
  plan_id         uuid,
  version_number  smallint,
  state           text,
  reason          change_reason,
  comment         text,
  client_name     text,
  trainer_id      uuid,
  sent_days_ago   integer
)
language sql
security invoker
stable
as $$
  select
    r.id,
    r.version_id,
    v.plan_id,
    v.version_number,
    r.state,
    r.reason,
    r.comment,
    c.full_name,
    c.trainer_id,
    case when v.sent_at is not null
         then floor(extract(epoch from (now() - v.sent_at)) / 86400)::integer
    end
  from change_requests r
  join workout_versions v on v.id = r.version_id
  join clients          c on c.id = r.client_id
  where r.id = p_request_id;
$$;

comment on function change_request_for_trainer is
  'La solicitud con su contexto. El comentario va al entrenador, NUNCA a logs.';

-- -----------------------------------------------------------------------------
-- resolve_change_requests
--
-- Cierra las solicitudes del plan cuando SALE la versión nueva (regla 12).
--
-- Al enviar, no al crear: una revisión abandonada dejaría al cliente sin
-- respuesta y sin solicitud abierta que lo recordara.
--
-- Se cierran las de TODAS las versiones del mismo plan: si pidió un cambio
-- sobre la v1 y otro sobre la v2, la v3 responde a los dos.
-- -----------------------------------------------------------------------------
create function resolve_change_requests(p_version_id uuid)
returns integer
language plpgsql
security invoker
as $$
declare
  v_plan_id uuid;
  v_count   integer;
begin
  select plan_id into v_plan_id from workout_versions where id = p_version_id;
  if not found then
    return 0;
  end if;

  with cerradas as (
    update change_requests r
       set state                  = 'RESOLVED',
           resolved_at            = now(),
           resolved_by_version_id = p_version_id
      from workout_versions v
     where v.id = r.version_id
       and v.plan_id = v_plan_id
       and r.state = 'OPEN'
       and r.version_id <> p_version_id
    returning 1
  )
  select count(*) into v_count from cerradas;

  return v_count;
end;
$$;

comment on function resolve_change_requests is
  'Cierra las solicitudes del plan al ENVIAR la versión nueva (SPEC-010 regla 12).';

revoke all on function request_change                 from anon, authenticated;
revoke all on function add_change_comment             from anon, authenticated;
revoke all on function open_change_request_for_client from anon, authenticated;
revoke all on function change_request_for_trainer     from anon, authenticated;
revoke all on function resolve_change_requests        from anon, authenticated;

-- -----------------------------------------------------------------------------
-- checkin_for_reply y open_checkin_for_profile, otra vez
--
-- El comentario de una solicitud y la molestia de un check-in compiten por el
-- mismo canal: los dos son texto libre del cliente. Para decidir cuál gana hay
-- que comparar CUÁNDO se preguntó cada cosa, y `sent_at` no viajaba.
--
-- La 0010 no se edita: las migraciones son inmutables (SPEC-000 regla 8). Y
-- hace falta el DROP porque `create or replace` no puede cambiar el tipo de
-- retorno de una función que ya existe.
--
-- El orden importa: `open_checkin_for_profile` se define sobre
-- `checkin_for_reply`, así que se borra primero la que depende.
-- -----------------------------------------------------------------------------
drop function if exists open_checkin_for_profile(uuid);
drop function if exists checkin_for_reply(uuid);

create function checkin_for_reply(p_checkin_id uuid)
returns table (
  checkin_id        uuid,
  client_profile_id uuid,
  client_name       text,
  week_number       smallint,
  state             text,
  answers           jsonb,
  sent_at           timestamptz,
  trainer_chat_id   bigint,
  days_per_week     smallint
)
language sql
security invoker
stable
as $$
  select
    k.id,
    c.profile_id,
    c.full_name,
    k.week_number,
    k.state,
    k.answers,
    k.sent_at,
    coalesce(t.telegram_chat_id, t.telegram_user_id),
    a.days_per_week
  from checkins k
  join clients  c on c.id = k.client_id
  join profiles t on t.id = c.trainer_id
  left join workout_versions v  on v.id = k.version_id
  left join workout_plans    pl on pl.id = v.plan_id
  left join assessments       a on a.id = pl.assessment_id
  where k.id = p_checkin_id;
$$;

comment on function checkin_for_reply is
  'El check-in con su dueño y CUÁNDO se preguntó (SPEC-010 §3).';

create function open_checkin_for_profile(p_profile_id uuid)
returns table (
  checkin_id        uuid,
  client_profile_id uuid,
  client_name       text,
  week_number       smallint,
  state             text,
  answers           jsonb,
  sent_at           timestamptz,
  trainer_chat_id   bigint,
  days_per_week     smallint
)
language sql
security invoker
stable
as $$
  select r.*
    from checkin_for_reply((
      select k.id
        from checkins k
        join clients c on c.id = k.client_id
       where c.profile_id = p_profile_id
         and k.state = 'PENDING'
         and k.sent_at is not null
       order by k.sent_at desc
       limit 1
    )) r;
$$;

comment on function open_checkin_for_profile is
  'El check-in abierto de un cliente, con su fecha para competir con la solicitud.';

revoke all on function checkin_for_reply        from anon, authenticated;
revoke all on function open_checkin_for_profile from anon, authenticated;

-- -----------------------------------------------------------------------------
-- version_for_request
--
-- La versión con su pertenencia y el plan al que colgar la v2.
--
-- `client_profile_id` es lo que decide si quien pide el cambio es su dueño:
-- se compara en `_core` contra la identidad resuelta del webhook, nunca
-- contra nada que venga en el `callback_data` (SPEC-009 regla 8).
-- -----------------------------------------------------------------------------
create function version_for_request(p_version_id uuid)
returns table (
  version_id        uuid,
  state             version_state,
  plan_id           uuid,
  version_number    smallint,
  client_id         uuid,
  trainer_id        uuid,
  client_profile_id uuid,
  client_name       text,
  trainer_chat_id   bigint
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
    coalesce(t.telegram_chat_id, t.telegram_user_id)
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  join profiles         t on t.id  = c.trainer_id
  where v.id = p_version_id;
$$;

comment on function version_for_request is
  'La versión con su dueño y su plan. Quién puede pedir el cambio lo decide _core.';

-- -----------------------------------------------------------------------------
-- record_version_accepted
--
-- El «me sirve» del cliente (regla 8).
--
-- **No cambia de estado**: `SENT` ya es terminal, no hay adónde ir. Lo único
-- que hace es dejar constancia, porque saber que una rutina gustó es lo que
-- da contexto a la siguiente.
--
-- `from_state` y `to_state` van en NULL **porque el CHECK lo exige**:
-- `(event_type = 'state_transition') = (to_state is not null)`. Ponerlos
-- rellenos aquí haría fallar el insert justo al pulsar el botón.
-- -----------------------------------------------------------------------------
create function record_version_accepted(
  p_version_id uuid,
  p_client_id  uuid,
  p_request_id uuid default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_plan_id uuid;
begin
  select plan_id into v_plan_id from workout_versions where id = p_version_id;
  if not found then
    return;
  end if;

  insert into plan_events (
    plan_id, version_id, event_type, actor, request_id, metadata
  ) values (
    v_plan_id, p_version_id, 'client_feedback', 'client', p_request_id,
    jsonb_build_object('accepted', true, 'client_id', p_client_id)
  );
end;
$$;

comment on function record_version_accepted is
  'Deja constancia del «me sirve». NO cambia estado: SENT es terminal (regla 8).';

revoke all on function version_for_request     from anon, authenticated;
revoke all on function record_version_accepted from anon, authenticated;
