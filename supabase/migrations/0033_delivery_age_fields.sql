-- SPEC-037 — `age` y `birth_date` hasta la entrega.
--
-- ┌─ POR QUÉ AQUÍ, Y NO UN CÁLCULO EN SQL ──────────────────────────────────┐
-- │ `isMinorClient` (edad exacta por `birth_date`, con fallback a `age`) ya  │
-- │ vive en `_core/assessment/minor.ts`, probada contra los mismos bordes   │
-- │ que el CHECK de `assessments`. Repetir ese cálculo en SQL sería la      │
-- │ MISMA clase de bug que el de `birth_date` fuera de rango: dos criterios │
-- │ que pueden divergir sin que nadie lo note. Esta función solo trae los   │
-- │ dos campos crudos; `_shared/db.ts` llama a la función de `_core`.       │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Mismo DROP en cascada que 0031: las dos funciones de abajo llaman a
-- `version_for_delivery` dentro de su cuerpo.

drop function if exists sent_version_for_profile(uuid);
drop function if exists approved_version_for_client(uuid);
drop function if exists version_for_delivery(uuid);

create function version_for_delivery(p_version_id uuid)
returns table (
  version_id       uuid,
  state            version_state,
  content          jsonb,
  client_name      text,
  client_chat_id   bigint,
  trainer_chat_id  bigint,
  goal             text,
  days_per_week    smallint,
  session_minutes  smallint,
  version_number   smallint,
  age              smallint,
  birth_date       date
)
language sql
security invoker
stable
as $$
  select
    v.id,
    v.state,
    v.content,
    c.full_name,
    coalesce(cp.telegram_chat_id, cp.telegram_user_id),
    coalesce(t.telegram_chat_id, t.telegram_user_id),
    a.goal,
    a.days_per_week,
    a.session_minutes,
    v.version_number,
    a.age,
    a.birth_date
  from workout_versions v
  join workout_plans pl on pl.id = v.plan_id
  join clients        c on c.id  = pl.client_id
  join profiles       t on t.id  = c.trainer_id
  left join profiles    cp on cp.id = c.profile_id
  left join assessments  a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

revoke all on function version_for_delivery from anon, authenticated;

comment on function version_for_delivery is
  'La versión lista para escribirle al cliente. NO incluye warnings: SPEC-005 regla 5.';

create function approved_version_for_client(p_client_id uuid)
returns table (
  version_id       uuid,
  state            version_state,
  content          jsonb,
  client_name      text,
  client_chat_id   bigint,
  trainer_chat_id  bigint,
  goal             text,
  days_per_week    smallint,
  session_minutes  smallint,
  version_number   smallint,
  age              smallint,
  birth_date       date
)
language sql
security invoker
stable
as $$
  select d.*
    from version_for_delivery((
      select v.id
        from workout_versions v
        join workout_plans pl on pl.id = v.plan_id
       where pl.client_id = p_client_id
         and v.state = 'APPROVED'
       order by v.created_at desc
       limit 1
    )) d;
$$;

revoke all on function approved_version_for_client from anon, authenticated;

comment on function approved_version_for_client is
  'La rutina que espera entrega diferida (SPEC-005 regla 3).';

create function sent_version_for_profile(p_profile_id uuid)
returns table (
  version_id       uuid,
  state            version_state,
  content          jsonb,
  client_name      text,
  client_chat_id   bigint,
  trainer_chat_id  bigint,
  goal             text,
  days_per_week    smallint,
  session_minutes  smallint,
  version_number   smallint,
  age              smallint,
  birth_date       date
)
language sql
security invoker
stable
as $$
  select d.*
    from version_for_delivery((
      select v.id
        from workout_versions v
        join workout_plans pl on pl.id = v.plan_id
        join clients        c on c.id  = pl.client_id
       where c.profile_id = p_profile_id
         and v.state = 'SENT'
       order by v.sent_at desc nulls last, v.created_at desc
       limit 1
    )) d;
$$;

revoke all on function sent_version_for_profile from anon, authenticated;

comment on function sent_version_for_profile is
  'La rutina vigente del cliente que escribe. El parámetro es su perfil, '
  'no su ficha: así no hay forma de pedir la de otro (SPEC-023 §8).';
