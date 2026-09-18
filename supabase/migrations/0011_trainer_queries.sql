-- =============================================================================
-- SPEC-007 — Las consultas del entrenador
--
-- ┌─ AQUÍ NO HAY NI UN UPDATE, Y ESO ES LA GARANTÍA ──────────────────────────┐
-- │ «Los comandos son de solo lectura» no es una nota de la spec: estas      │
-- │ funciones son `stable` y no escriben nada. Un comando no puede aprobar   │
-- │ una rutina aunque el código lo intentara, porque no hay con qué.         │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- **Todas reciben el `trainer_id` y filtran por él.** El entrenador solo ve a
-- los suyos, y eso se decide en el WHERE, no después en memoria (§7).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- trainer_clients
--
-- Una fila por cliente, con lo justo para pintar `/clientes`.
--
-- La versión que se mira es la VIGENTE (`current_version_id`), no la última
-- creada: son lo mismo salvo durante una transición, y ahí la vigente es la
-- que el entrenador considera suya.
-- -----------------------------------------------------------------------------
create function trainer_clients(p_trainer_id uuid)
returns table (
  client_id            uuid,
  full_name            text,
  version_state        version_state,
  version_number       smallint,
  linked               boolean,
  pending_checkin_days integer
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
    -- El check-in PENDING más antiguo que ya salió. NULL si no hay ninguno:
    -- «no debe nada» y «lleva cinco días» no son lo mismo.
    (
      select floor(extract(epoch from (now() - min(k.sent_at))) / 86400)::integer
        from checkins k
       where k.client_id = c.id
         and k.state = 'PENDING'
         and k.sent_at is not null
    )
  from clients c
  left join workout_plans    pl on pl.client_id = c.id
  left join workout_versions  v on v.id = pl.current_version_id
  where c.trainer_id = p_trainer_id
  order by c.full_name;
$$;

comment on function trainer_clients is
  'La cartera del entrenador. Filtra por trainer_id en el WHERE (SPEC-007 §7).';

-- -----------------------------------------------------------------------------
-- trainer_client_detail
--
-- La ficha de `/cliente <nombre>`.
--
-- **`limitations_detail` NO sale de aquí.** La ficha se lee de un vistazo en
-- el móvil; el texto crudo vive en la rutina, que es donde el entrenador lo
-- necesita al revisarla. Solo viaja el booleano.
-- -----------------------------------------------------------------------------
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
  last_answers         jsonb
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
    ultimo.answers
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
  'La ficha de un cliente. NO devuelve limitations_detail: solo el booleano.';

-- -----------------------------------------------------------------------------
-- trainer_pending_versions
--
-- Las rutinas en DRAFT esperando decisión, para `/pendientes`.
--
-- Salen ordenadas por antigüedad: la que lleva más esperando va primero, que
-- es la que más urge.
-- -----------------------------------------------------------------------------
create function trainer_pending_versions(p_trainer_id uuid)
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
    and v.state = 'DRAFT'
  order by v.updated_at;
$$;

comment on function trainer_pending_versions is
  'Rutinas en DRAFT esperando al entrenador. La más antigua primero.';

-- -----------------------------------------------------------------------------
-- trainer_stale_checkins
--
-- Check-ins sin responder de más de `p_min_days` días, para `/checkins`.
--
-- El umbral entra por parámetro y no va escrito aquí: cuántos días es «ya
-- toca reclamar» es una decisión de producto, y vive en `_core`.
-- -----------------------------------------------------------------------------
create function trainer_stale_checkins(p_trainer_id uuid, p_min_days integer)
returns table (
  client_name  text,
  week_number  smallint,
  days_waiting integer,
  reminded     boolean
)
language sql
security invoker
stable
as $$
  select
    c.full_name,
    k.week_number,
    floor(extract(epoch from (now() - k.sent_at)) / 86400)::integer,
    k.reminder_sent_at is not null
  from checkins k
  join clients c on c.id = k.client_id
  where c.trainer_id = p_trainer_id
    and k.state = 'PENDING'
    and k.sent_at is not null
    and k.sent_at <= now() - (p_min_days || ' days')::interval
  order by k.sent_at;
$$;

comment on function trainer_stale_checkins is
  'Check-ins colgados. El umbral lo decide _core, no esta consulta.';

revoke all on function trainer_clients          from anon, authenticated;
revoke all on function trainer_client_detail    from anon, authenticated;
revoke all on function trainer_pending_versions from anon, authenticated;
revoke all on function trainer_stale_checkins   from anon, authenticated;
