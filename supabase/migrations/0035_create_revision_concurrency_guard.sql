-- =============================================================================
-- SPEC-010 regla 13 — cerrar la ventana de carrera entre comprobar que no
-- hay una revisión en marcha y crearla.
--
-- La 0034 le dio a `_core` el dato (`current_version_id`) para no crear una
-- v3 cuando una ya está en marcha, pero esa comprobación y el INSERT ocurren
-- en dos pasos separados: dos callbacks casi simultáneos (dos avisos
-- distintos del mismo cliente, o Telegram reintregando el mismo) podrían
-- leer los dos "todavía terminal" antes de que cualquiera cree la suya.
--
-- `p_expected_current_version_id` es una guarda de CONCURRENCIA, no una
-- regla de negocio — el mismo principio que `p_expected_state` en
-- `apply_version_transition` (la 0003): bajo el MISMO lock que ya serializa
-- el cálculo del número de versión, se vuelve a comprobar la vigente antes
-- de insertar. `default null` preserva el comportamiento de siempre para
-- quien no lo pasa (`ingest_assessment`, el `createRevision` sin guarda).
--
-- `create or replace` identifica una función por nombre Y número de
-- parámetros de entrada: agregar uno al final —aunque sea con default— no
-- la reemplaza, crea una SOBRECARGA nueva y deja la de 6 parámetros
-- colgando (y entonces `create_workout_version`, a secas, deja de ser un
-- nombre único). El `drop` explícito, con la firma vieja exacta, es lo que
-- de verdad la reemplaza — mismo patrón que la 0034 con `version_for_request`.
-- -----------------------------------------------------------------------------

drop function if exists create_workout_version(uuid, version_source, uuid, jsonb, text, uuid);

create function create_workout_version(
  p_plan_id     uuid,
  p_source      version_source,
  p_created_by  uuid,
  p_content     jsonb   default null,
  p_template_id text    default null,
  p_request_id  uuid    default null,
  p_expected_current_version_id uuid default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_next_number smallint;
  v_state       version_state;
  v_version_id  uuid;
  v_current_id  uuid;
begin
  -- Bloquea el plan: serializa el cálculo del número de versión Y, cuando
  -- se pide, la comprobación de abajo — las dos bajo el mismo lock.
  select current_version_id into v_current_id
    from workout_plans where id = p_plan_id for update;
  if not found then
    raise exception 'plan % no existe', p_plan_id using errcode = 'foreign_key_violation';
  end if;

  if p_expected_current_version_id is not null
     and v_current_id is distinct from p_expected_current_version_id then
    -- Alguien más ya creó una revisión mientras esta llamada esperaba el
    -- lock: no hay nada que insertar.
    return null;
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
  'Crea versión + marca vigente + registra evento, de forma atómica. p_expected_current_version_id: guarda de concurrencia opcional, no regla de negocio.';
