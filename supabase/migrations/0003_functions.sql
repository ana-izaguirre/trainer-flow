-- =============================================================================
-- SPEC-000 — Operaciones atómicas
--
-- Estas son las DOS únicas operaciones que tocan varias tablas y deben ser
-- todo o nada. supabase-js no hace transacciones de varias sentencias, así que
-- viven aquí y se invocan por RPC.
--
-- IMPORTANTE: estas funciones NO contienen reglas de negocio.
-- La validez de una transición la decide _core/domain/state-machine.ts.
-- Aquí solo se aplica de forma atómica lo que el dominio ya autorizó.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_workout_version
--
-- Crea una versión, la marca como vigente y registra el evento. Todo o nada.
--
-- El número de versión se calcula bajo bloqueo del plan, así que dos peticiones
-- simultáneas no pueden producir dos versiones con el mismo número.
-- -----------------------------------------------------------------------------
create or replace function create_workout_version(
  p_plan_id     uuid,
  p_source      version_source,
  p_created_by  uuid,
  p_content     jsonb   default null,
  p_template_id text    default null,
  p_request_id  uuid    default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_next_number smallint;
  v_state       version_state;
  v_version_id  uuid;
begin
  -- Bloquea el plan: serializa el cálculo del número de versión.
  perform 1 from workout_plans where id = p_plan_id for update;
  if not found then
    raise exception 'plan % no existe', p_plan_id using errcode = 'foreign_key_violation';
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_next_number
    from workout_versions
   where plan_id = p_plan_id;

  -- Sin contenido todavía → NEW (la IA aún no corrió).
  -- Con contenido → DRAFT (plantilla o manual ya lo traen).
  v_state := case when p_content is null then 'NEW' else 'DRAFT' end;

  insert into workout_versions (
    plan_id, version_number, state, content, source, template_id, created_by
  ) values (
    p_plan_id, v_next_number, v_state, p_content, p_source, p_template_id, p_created_by
  )
  returning id into v_version_id;

  update workout_plans
     set current_version_id = v_version_id
   where id = p_plan_id;

  insert into plan_events (
    plan_id, version_id, event_type, from_state, to_state, actor, request_id, metadata
  ) values (
    p_plan_id, v_version_id, 'state_transition', null, v_state,
    case when p_source = 'ai' then 'ai' else 'trainer' end,
    p_request_id,
    jsonb_build_object('source', p_source, 'version_number', v_next_number)
  );

  return v_version_id;
end;
$$;

comment on function create_workout_version is
  'Crea versión + marca vigente + registra evento, de forma atómica. Sin reglas de negocio.';

-- -----------------------------------------------------------------------------
-- apply_version_transition
--
-- Aplica un cambio de estado ya validado por _core y registra el evento.
--
-- p_expected_state es una guarda de concurrencia, NO una regla de negocio: si
-- otra petición cambió el estado mientras tanto, esta falla en vez de pisarla.
-- Es lo que impide que una doble pulsación en Telegram aplique dos veces.
-- -----------------------------------------------------------------------------
create or replace function apply_version_transition(
  p_version_id     uuid,
  p_expected_state version_state,
  p_new_state      version_state,
  p_actor          text,
  p_request_id     uuid  default null,
  p_metadata       jsonb default null
)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_plan_id uuid;
  v_current version_state;
begin
  select plan_id, state
    into v_plan_id, v_current
    from workout_versions
   where id = p_version_id
     for update;

  if not found then
    raise exception 'versión % no existe', p_version_id using errcode = 'foreign_key_violation';
  end if;

  -- Alguien se adelantó: no se pisa, se informa.
  if v_current is distinct from p_expected_state then
    return false;
  end if;

  update workout_versions
     set state   = p_new_state,
         sent_at = case when p_new_state = 'SENT' then now() else sent_at end
   where id = p_version_id;

  insert into plan_events (
    plan_id, version_id, event_type, from_state, to_state, actor, request_id, metadata
  ) values (
    v_plan_id, p_version_id, 'state_transition', v_current, p_new_state,
    p_actor, p_request_id, p_metadata
  );

  return true;
end;
$$;

comment on function apply_version_transition is
  'Aplica una transición ya validada por _core y la registra. Guarda de concurrencia.';

revoke all on function create_workout_version   from anon, authenticated;
revoke all on function apply_version_transition from anon, authenticated;
