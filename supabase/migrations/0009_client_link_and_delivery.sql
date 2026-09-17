-- =============================================================================
-- SPEC-005 — El canje del deep link y la entrega
--
-- Operaciones que no caben en una consulta de PostgREST:
--
--   · `client_for_link`            un join de tres tablas
--   · `ensure_client_profile`      un buscar-o-crear que debe ser atómico
--   · `link_client`                una actualización con guarda de concurrencia
--   · `version_for_delivery`       un join de cinco, dos de ellos opcionales
--   · `version_for_action`         la pertenencia, que decide la autorización
--
-- Ninguna contiene reglas de negocio: quién puede canjear qué lo decide
-- `_core`, y qué transición es legal lo decide la máquina de estados. Aquí
-- solo se aplica de forma atómica lo que el dominio ya autorizó.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- client_for_link
--
-- La ficha detrás de un `link_token`, con lo justo para decidir el canje.
--
-- Devuelve `linked_telegram_user_id` a propósito: permite saber si quien
-- canjea es la misma persona que ya lo hizo SIN crear antes su perfil. Así un
-- intento con un token ajeno no deja rastro en `profiles`.
-- -----------------------------------------------------------------------------
create function client_for_link(p_token text)
returns table (
  client_id                uuid,
  full_name                text,
  linked_profile_id        uuid,
  linked_telegram_user_id  bigint,
  trainer_chat_id          bigint
)
language sql
security invoker
stable
as $$
  select
    c.id,
    c.full_name,
    c.profile_id,
    cp.telegram_user_id,
    coalesce(t.telegram_chat_id, t.telegram_user_id)
  from clients c
  join profiles t on t.id = c.trainer_id
  -- El cliente puede no haberse vinculado todavía: por eso LEFT.
  left join profiles cp on cp.id = c.profile_id
  where c.link_token = p_token;
$$;

comment on function client_for_link is
  'La ficha detrás de un link_token. El token es una credencial: nunca en logs.';

-- -----------------------------------------------------------------------------
-- ensure_client_profile
--
-- El perfil de quien canjea, creándolo si es su primera vez. **Es el único
-- sitio del sistema donde nace un perfil de cliente**, y solo se llega aquí
-- con un token válido (SPEC-009 regla 1).
--
-- `p_full_name` viene de `clients.full_name`, no del `first_name` del update:
-- ese lo elige quien escribe.
--
-- Devuelve NULL si ese telegram_user_id ya tiene un perfil que no es de
-- cliente. Un entrenador no cambia de rol por pulsar un enlace.
-- -----------------------------------------------------------------------------
create function ensure_client_profile(
  p_telegram_user_id bigint,
  p_chat_id          bigint,
  p_full_name        text
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id   uuid;
  v_role user_role;
begin
  select id, role into v_id, v_role
    from profiles
   where telegram_user_id = p_telegram_user_id;

  if found then
    if v_role <> 'client' then
      return null;
    end if;

    -- Pudo cambiar de dispositivo o reinstalar: el chat se refresca.
    update profiles set telegram_chat_id = p_chat_id where id = v_id;
    return v_id;
  end if;

  insert into profiles (telegram_user_id, telegram_chat_id, role, full_name)
  values (p_telegram_user_id, p_chat_id, 'client', p_full_name)
  -- Dos canjes simultáneos: el segundo no revienta, cae al bloque de abajo.
  on conflict (telegram_user_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id, role into v_id, v_role
      from profiles
     where telegram_user_id = p_telegram_user_id;

    if v_role <> 'client' then
      return null;
    end if;
  end if;

  return v_id;
end;
$$;

comment on function ensure_client_profile is
  'El ÚNICO camino a un perfil de cliente. Exige un link_token válido (SPEC-009 regla 1).';

-- -----------------------------------------------------------------------------
-- link_client
--
-- Ata la ficha al perfil. Devuelve false en vez de reventar cuando no se puede.
--
-- Las dos garantías son de la base, no de una comprobación previa —que dos
-- peticiones simultáneas pasarían las dos:
--
--   · `profile_id is null or = p_profile_id`  → no se pisa una ficha ajena
--   · `UNIQUE (clients.profile_id)`           → una persona, una sola ficha
-- -----------------------------------------------------------------------------
create function link_client(p_client_id uuid, p_profile_id uuid)
returns boolean
language plpgsql
security invoker
as $$
begin
  update clients
     set profile_id = p_profile_id,
         -- Volver a abrir el propio enlace no reescribe la fecha original.
         linked_at  = coalesce(linked_at, now())
   where id = p_client_id
     and (profile_id is null or profile_id = p_profile_id);

  return found;
exception
  when unique_violation then
    -- Esa persona ya está vinculada a OTRA ficha.
    return false;
end;
$$;

comment on function link_client is
  'Ata ficha y perfil. false si otro se adelantó o la persona ya tiene ficha.';

-- -----------------------------------------------------------------------------
-- version_for_delivery
--
-- Todo lo que hace falta para escribirle al cliente, en una consulta.
--
-- Dos joins son LEFT y eso es la regla, no un descuido:
--
--   · el perfil del CLIENTE puede no existir todavía (no ha canjeado su
--     enlace). La versión se devuelve igual, con `client_chat_id` NULL, para
--     que el entrenador pueda enterarse de que sigue pendiente (CA-3). Con un
--     INNER, esa rutina desaparecería sin que nadie lo supiera.
--
--   · la EVALUACIÓN puede no existir: una rutina manual o de plantilla no
--     tiene formulario detrás. El mensaje omite la línea del objetivo en vez
--     de quedarse sin enviar (regla 13).
-- -----------------------------------------------------------------------------
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
  session_minutes  smallint
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
    a.session_minutes
  from workout_versions v
  join workout_plans pl on pl.id = v.plan_id
  join clients        c on c.id  = pl.client_id
  join profiles       t on t.id  = c.trainer_id
  left join profiles    cp on cp.id = c.profile_id
  left join assessments  a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function version_for_delivery is
  'La versión lista para escribirle al cliente. NO incluye warnings: SPEC-005 regla 5.';

-- -----------------------------------------------------------------------------
-- approved_version_for_client
--
-- La rutina aprobada que espera a que el cliente abra su enlace.
--
-- Se define sobre `version_for_delivery` para que la forma de la fila exista
-- una sola vez: dos listas de columnas que deben coincidir acaban sin coincidir.
--
-- En V1 un cliente tiene un plan. Si hubiera varias aprobadas se entrega la
-- más reciente, que es la que el entrenador acaba de mirar.
-- -----------------------------------------------------------------------------
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
  session_minutes  smallint
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

comment on function approved_version_for_client is
  'La rutina que espera entrega diferida (SPEC-005 regla 3).';

-- -----------------------------------------------------------------------------
-- version_for_action
--
-- Lo que hace falta para decidir si el entrenador puede tocar esta versión.
--
-- Devuelve `trainer_id` y `client_profile_id` porque la pertenencia se
-- comprueba en `_core/authorization.ts` contra la identidad resuelta del
-- webhook, NUNCA contra un ID que venga en la petición (SPEC-009 regla 8).
-- Un `callback_data` lo fabrica cualquiera; lo que lo detiene es esta
-- comparación, no el parseo.
-- -----------------------------------------------------------------------------
create function version_for_action(p_version_id uuid)
returns table (
  version_id        uuid,
  state             version_state,
  version_number    smallint,
  content           jsonb,
  client_id         uuid,
  trainer_id        uuid,
  client_profile_id uuid,
  client_name       text
)
language sql
security invoker
stable
as $$
  select
    v.id,
    v.state,
    v.version_number,
    v.content,
    c.id,
    c.trainer_id,
    c.profile_id,
    c.full_name
  from workout_versions v
  join workout_plans pl on pl.id = v.plan_id
  join clients        c on c.id  = pl.client_id
  where v.id = p_version_id;
$$;

comment on function version_for_action is
  'La versión con su pertenencia. Quién puede tocarla lo decide _core/authorization.ts.';

revoke all on function client_for_link             from anon, authenticated;
revoke all on function ensure_client_profile       from anon, authenticated;
revoke all on function link_client                 from anon, authenticated;
revoke all on function version_for_delivery        from anon, authenticated;
revoke all on function approved_version_for_client from anon, authenticated;
revoke all on function version_for_action          from anon, authenticated;
