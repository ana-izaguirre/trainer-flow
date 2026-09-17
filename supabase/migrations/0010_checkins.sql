-- =============================================================================
-- SPEC-006 — El check-in semanal
--
-- Las consultas que el cron y el webhook necesitan. Ninguna decide CUÁNDO
-- toca un check-in: eso es `_core/checkin/schedule.ts`, porque el número de
-- semana es lo que hace que el UNIQUE funcione y tiene que ser probable sin
-- una base de datos delante.
--
-- Aquí solo se traen candidatos y se escribe lo que el dominio decidió.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- checkin_candidates
--
-- Un cliente por rutina VIGENTE: la que el plan apunta como actual. Sin eso,
-- un cliente con tres versiones entregadas recibiría tres check-ins.
--
-- `last_week_sent` cuenta solo los check-ins con `sent_at`. Un envío que falló
-- deja la fila sin fecha, y así esa semana se vuelve a intentar sola en vez de
-- darse por preguntada.
-- -----------------------------------------------------------------------------
create function checkin_candidates()
returns table (
  client_id       uuid,
  client_name     text,
  client_chat_id  bigint,
  version_id      uuid,
  state           version_state,
  sent_at         timestamptz,
  last_week_sent  smallint
)
language sql
security invoker
stable
as $$
  select
    c.id,
    c.full_name,
    coalesce(cp.telegram_chat_id, cp.telegram_user_id),
    v.id,
    v.state,
    v.sent_at,
    coalesce((
      select max(k.week_number)
        from checkins k
       where k.client_id = c.id
         and k.version_id = v.id
         and k.sent_at is not null
    ), 0::smallint)
  from workout_plans pl
  join workout_versions v on v.id = pl.current_version_id
  join clients          c on c.id = pl.client_id
  left join profiles   cp on cp.id = c.profile_id
  where v.state = 'SENT'
    and v.sent_at is not null;
$$;

comment on function checkin_candidates is
  'Clientes con rutina entregada. A cuáles toca preguntarles lo decide _core.';

-- -----------------------------------------------------------------------------
-- create_checkin
--
-- Crea el check-in de esa semana, o devuelve el que ya había.
--
-- **El `UNIQUE (client_id, version_id, week_number)` es lo que impide que dos
-- pasadas del cron creen dos** (regla 3, CA-2). No una comprobación previa:
-- dos ejecuciones simultáneas la pasarían las dos.
--
-- Devolver el id existente en vez de fallar es lo que permite reintentar un
-- envío que se cayó.
-- -----------------------------------------------------------------------------
create function create_checkin(
  p_client_id   uuid,
  p_version_id  uuid,
  p_week_number smallint
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  insert into checkins (client_id, version_id, week_number, state)
  values (p_client_id, p_version_id, p_week_number, 'PENDING')
  on conflict (client_id, version_id, week_number) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from checkins
     where client_id = p_client_id
       and version_id = p_version_id
       and week_number = p_week_number;
  end if;

  return v_id;
end;
$$;

comment on function create_checkin is
  'El check-in de esa semana, o el que ya existía. El UNIQUE es la garantía (CA-2).';

-- -----------------------------------------------------------------------------
-- checkins_to_remind
--
-- Los que llevan un rato sin respuesta. Cuánto es «un rato» lo decide
-- `needsReminder`; aquí solo se acota para no traer el historial entero.
-- -----------------------------------------------------------------------------
create function checkins_to_remind()
returns table (
  checkin_id       uuid,
  client_chat_id   bigint,
  week_number      smallint,
  state            text,
  sent_at          timestamptz,
  reminder_sent_at timestamptz
)
language sql
security invoker
stable
as $$
  select
    k.id,
    coalesce(cp.telegram_chat_id, cp.telegram_user_id),
    k.week_number,
    k.state,
    k.sent_at,
    k.reminder_sent_at
  from checkins k
  join clients   c on c.id  = k.client_id
  join profiles cp on cp.id = c.profile_id
  where k.state = 'PENDING'
    and k.sent_at is not null
    and k.reminder_sent_at is null
    and k.sent_at > now() - interval '14 days';
$$;

comment on function checkins_to_remind is
  'Check-ins sin responder. Cuándo recordar lo decide _core/checkin/schedule.ts.';

-- -----------------------------------------------------------------------------
-- checkin_for_reply
--
-- El check-in con su DUEÑO.
--
-- `client_profile_id` es lo único que autoriza la respuesta: el `checkinId`
-- viaja en el `callback_data` y cualquiera puede fabricar uno (CA-7). La
-- comparación se hace en `_core` contra la identidad resuelta del webhook.
-- -----------------------------------------------------------------------------
create function checkin_for_reply(p_checkin_id uuid)
returns table (
  checkin_id        uuid,
  client_profile_id uuid,
  client_name       text,
  week_number       smallint,
  state             text,
  answers           jsonb,
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
    coalesce(t.telegram_chat_id, t.telegram_user_id),
    a.days_per_week
  from checkins k
  join clients  c on c.id = k.client_id
  join profiles t on t.id = c.trainer_id
  -- Una rutina manual no tiene evaluación: entonces no hay total que mostrar.
  left join workout_versions v  on v.id = k.version_id
  left join workout_plans    pl on pl.id = v.plan_id
  left join assessments       a on a.id = pl.assessment_id
  where k.id = p_checkin_id;
$$;

comment on function checkin_for_reply is
  'El check-in con su dueño. Quién puede contestarlo lo decide _core (CA-7).';

-- -----------------------------------------------------------------------------
-- open_checkin_for_profile
--
-- El check-in que espera una molestia por escrito.
--
-- Un mensaje suelto solo se lee como respuesta si hay uno abierto. Se toma el
-- más reciente: si hubiera dos, el viejo ya no es lo que el cliente contesta.
-- -----------------------------------------------------------------------------
create function open_checkin_for_profile(p_profile_id uuid)
returns table (
  checkin_id        uuid,
  client_profile_id uuid,
  client_name       text,
  week_number       smallint,
  state             text,
  answers           jsonb,
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
  'El check-in abierto de un cliente, para atribuirle un texto libre.';

-- -----------------------------------------------------------------------------
-- save_checkin_answers
--
-- Guarda las respuestas y cierra el check-in cuando están las tres.
--
-- `completed_at` va junto al estado porque el CHECK de la tabla exige que
-- vayan de la mano: separarlos haría fallar la escritura.
-- -----------------------------------------------------------------------------
create function save_checkin_answers(
  p_checkin_id uuid,
  p_answers    jsonb,
  p_completed  boolean
)
returns void
language sql
security invoker
as $$
  update checkins
     set answers      = p_answers,
         state        = case when p_completed then 'COMPLETED' else state end,
         completed_at = case when p_completed then coalesce(completed_at, now()) end
   where id = p_checkin_id;
$$;

comment on function save_checkin_answers is
  'Las respuestas del cliente. Son información de salud: NUNCA en logs.';

-- -----------------------------------------------------------------------------
-- mark_checkin_sent / mark_checkin_reminded
--
-- Se llaman DESPUÉS de que Telegram acepte el mensaje. Marcar antes produce
-- un check-in que consta como mandado y que nadie recibió.
-- -----------------------------------------------------------------------------
create function mark_checkin_sent(p_checkin_id uuid)
returns void
language sql
security invoker
as $$
  update checkins set sent_at = coalesce(sent_at, now()) where id = p_checkin_id;
$$;

create function mark_checkin_reminded(p_checkin_id uuid)
returns void
language sql
security invoker
as $$
  update checkins
     set reminder_sent_at = coalesce(reminder_sent_at, now())
   where id = p_checkin_id;
$$;

revoke all on function checkin_candidates       from anon, authenticated;
revoke all on function create_checkin           from anon, authenticated;
revoke all on function checkins_to_remind       from anon, authenticated;
revoke all on function checkin_for_reply        from anon, authenticated;
revoke all on function open_checkin_for_profile from anon, authenticated;
revoke all on function save_checkin_answers     from anon, authenticated;
revoke all on function mark_checkin_sent        from anon, authenticated;
revoke all on function mark_checkin_reminded    from anon, authenticated;
