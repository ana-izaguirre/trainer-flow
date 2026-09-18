-- =============================================================================
-- SPEC-008 — Plantillas y creación manual
--
-- Tres operaciones. Las dos primeras tienen que ser atómicas por un CHECK del
-- esquema: `source = 'template'` si y solo si hay `template_id`. Escribir el
-- contenido y la fuente en dos pasos dejaría la fila violando esa regla entre
-- medias, y en un fallo, para siempre.
--
-- Ninguna contiene reglas de negocio: qué transición es legal lo decide
-- `_core/domain/state-machine.ts`, y si el borrador vale, `validateDraft`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fill_version
--
-- Carga contenido en una versión que aún no lo tenía, fija su fuente, y la
-- pasa a DRAFT. Todo o nada.
--
-- `p_expected_state` es la guarda de concurrencia, igual que en
-- `apply_version_transition`: si alguien se adelantó, esta falla en vez de
-- pisarle el trabajo. Es lo que impide que dos pulsaciones de 📋 carguen dos
-- plantillas sobre la misma versión.
-- -----------------------------------------------------------------------------
create function fill_version(
  p_version_id     uuid,
  p_expected_state version_state,
  p_source         version_source,
  p_template_id    text,
  p_content        jsonb,
  p_request_id     uuid default null
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

  -- Fuente y template_id van juntos, o el CHECK rechaza la fila.
  update workout_versions
     set content     = p_content,
         source      = p_source,
         template_id = p_template_id,
         state       = 'DRAFT'
   where id = p_version_id;

  insert into plan_events (
    plan_id, version_id, event_type, from_state, to_state, actor, request_id, metadata
  ) values (
    v_plan_id, p_version_id, 'state_transition', v_current, 'DRAFT',
    'trainer', p_request_id,
    jsonb_build_object('source', p_source, 'template_id', p_template_id)
  );

  return true;
end;
$$;

comment on function fill_version is
  'Carga contenido + fuente + DRAFT, atómico. El CHECK de template_id exige que vayan juntos.';

-- -----------------------------------------------------------------------------
-- save_draft_content
--
-- Una edición sobre un borrador. **Modifica in-place** (regla 5): no crea
-- versión, no cambia estado, no toca `version_number`.
--
-- El `and state = 'DRAFT'` no es una comprobación redundante: es lo que impide
-- que una edición caiga sobre una versión que acaba de aprobarse. Devuelve
-- false en vez de reventar, y quien llama lo cuenta.
-- -----------------------------------------------------------------------------
create function save_draft_content(p_version_id uuid, p_content jsonb)
returns boolean
language plpgsql
security invoker
as $$
begin
  update workout_versions
     set content    = p_content,
         edit_count = least(edit_count + 1, 5)
   where id = p_version_id
     and state = 'DRAFT';

  return found;
end;
$$;

comment on function save_draft_content is
  'Edición in-place de un borrador (SPEC-008 regla 5). false si ya no está en DRAFT.';

-- -----------------------------------------------------------------------------
-- current_draft_for_trainer
--
-- El borrador sobre el que actúan los comandos del editor: **el que el
-- entrenador tocó más recientemente**.
--
-- No «el único abierto»: con dos clientes a la vez esa regla bloquearía los
-- dos. A cambio, quien llama dice de quién es el borrador en cada respuesta,
-- para que un contexto equivocado se vea en el acto (SPEC-008 §3).
-- -----------------------------------------------------------------------------
create function current_draft_for_trainer(p_trainer_id uuid)
returns table (
  version_id     uuid,
  version_number smallint,
  content        jsonb,
  client_name    text
)
language sql
security invoker
stable
as $$
  select v.id, v.version_number, v.content, c.full_name
    from workout_versions v
    join workout_plans   pl on pl.id = v.plan_id
    join clients          c on c.id  = pl.client_id
   where c.trainer_id = p_trainer_id
     and v.state = 'DRAFT'
   order by v.updated_at desc
   limit 1;
$$;

comment on function current_draft_for_trainer is
  'El borrador más recientemente tocado. Es el contexto implícito del editor.';

-- -----------------------------------------------------------------------------
-- version_for_creation
--
-- Lo que hace falta para ORDENAR las plantillas de este cliente y para decidir
-- si `applyTemplate` inyecta el aviso de limitaciones.
--
-- Es un LEFT join sobre la evaluación a propósito: una rutina manual no tiene
-- formulario detrás, y aun así se le pueden ofrecer plantillas. Con un INNER,
-- el botón 📋 no haría nada para esos clientes.
-- -----------------------------------------------------------------------------
create function version_for_creation(p_version_id uuid)
returns table (
  version_id      uuid,
  state           version_state,
  client_name     text,
  version_number  smallint,
  days_per_week   smallint,
  level           text,
  equipment       text,
  has_limitations boolean
)
language sql
security invoker
stable
as $$
  select
    v.id,
    v.state,
    c.full_name,
    v.version_number,
    a.days_per_week,
    a.level,
    a.equipment,
    coalesce(a.has_limitations, false)
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  left join assessments a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function version_for_creation is
  'Criterios para ordenar plantillas. NO devuelve limitations_detail: solo el booleano.';

revoke all on function version_for_creation      from anon, authenticated;
revoke all on function fill_version              from anon, authenticated;
revoke all on function save_draft_content        from anon, authenticated;
revoke all on function current_draft_for_trainer from anon, authenticated;

-- -----------------------------------------------------------------------------
-- version_for_action, otra vez
--
-- Aprobar ahora valida (SPEC-008 regla 11), y validar necesita saber qué pidió
-- el cliente. La 0011 no se edita: las migraciones son inmutables.
--
-- Hace falta el DROP: `create or replace` no puede cambiar el tipo de retorno
-- de una función que ya existe, y añadir columnas a un `returns table` lo es.
-- -----------------------------------------------------------------------------
drop function if exists version_for_action(uuid);

create function version_for_action(p_version_id uuid)
returns table (
  version_id        uuid,
  state             version_state,
  version_number    smallint,
  content           jsonb,
  client_id         uuid,
  trainer_id        uuid,
  client_profile_id uuid,
  client_name       text,
  days_per_week     smallint,
  has_limitations   boolean
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
    c.full_name,
    a.days_per_week,
    coalesce(a.has_limitations, false)
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  -- Sin evaluación no hay criterios contra los que comparar: se valida la
  -- forma. Por eso LEFT y no INNER.
  left join assessments a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function version_for_action is
  'La versión con su pertenencia Y sus criterios. Aprobar valida (SPEC-008 regla 11).';

revoke all on function version_for_action from anon, authenticated;
