-- =============================================================================
-- SPEC-004 — La edición conversacional: «¿qué quieres cambiar?» y el
-- siguiente mensaje de texto libre es la respuesta.
--
-- ┌─ POR QUÉ UNA COLUMNA, Y NO «SI HAY UN DRAFT ABIERTO» ──────────────────┐
-- │ Un entrenador casi siempre tiene algún borrador en DRAFT. Sin un       │
-- │ estado explícito, cualquier mensaje casual con un draft abierto        │
-- │ dispararía una llamada a Gemini que nadie pidió. Decidido con Ana      │
-- │ (30/09/2026): un booleano que solo prende «✏️ Editar», y que cualquier │
-- │ comando apaga en silencio — cambiar de intención no es un error.       │
-- └──────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

alter table workout_versions
  add column awaiting_edit_instruction boolean not null default false;

-- -----------------------------------------------------------------------------
-- save_draft_content — ahora también apaga la espera.
--
-- Cualquier guardado sobre el borrador —a mano (SPEC-008) o por la IA de
-- esta spec— resuelve la pregunta pendiente. Reusar esta misma función para
-- las dos es lo que garantiza que «editar» comparte el límite de 5 con el
-- editor manual: es la MISMA columna `edit_count`.
-- -----------------------------------------------------------------------------
drop function if exists save_draft_content(uuid, jsonb);

create function save_draft_content(p_version_id uuid, p_content jsonb)
returns boolean
language plpgsql
security invoker
as $$
begin
  update workout_versions
     set content                   = p_content,
         edit_count                = least(edit_count + 1, 5),
         awaiting_edit_instruction = false
   where id = p_version_id
     and state = 'DRAFT';

  return found;
end;
$$;

comment on function save_draft_content is
  'Edición in-place de un borrador (SPEC-008 regla 5 / SPEC-004). false si ya no está en DRAFT.';

-- -----------------------------------------------------------------------------
-- version_for_action — ahora también trae edit_count (SPEC-004 regla 9).
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
  has_limitations   boolean,
  goal              text,
  session_minutes   smallint,
  edit_count        smallint
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
    coalesce(a.has_limitations, false),
    a.goal,
    a.session_minutes,
    v.edit_count
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  left join assessments a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function version_for_action is
  'La versión con su pertenencia, sus criterios Y su plan. Aprobar valida '
  '(SPEC-008 regla 11); goal/session_minutes son para repintar la vista del '
  'cliente al navegar (SPEC-031); edit_count decide si «✏️ Editar» pregunta '
  'o sugiere regenerar (SPEC-004 regla 9).';

revoke all on function version_for_action from anon, authenticated;

-- -----------------------------------------------------------------------------
-- start_edit_instruction — prende la espera en esta versión, apaga
-- cualquier otra del mismo entrenador (a lo sumo una pendiente a la vez,
-- mismo criterio que «el borrador tocado más recientemente», SPEC-008 §3).
--
-- `false` si ya no aplica: no está en DRAFT (alguien aprobó/rechazó justo
-- antes) o ya llegó a 5 ediciones — la misma guarda que ya aplicó
-- `handleAction` con los datos que tenía, repetida aquí contra el dato
-- fresco, igual que cualquier otra transición de esta base.
-- -----------------------------------------------------------------------------
create function start_edit_instruction(p_version_id uuid)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_trainer_id uuid;
begin
  select c.trainer_id
    into v_trainer_id
    from workout_versions v
    join workout_plans pl on pl.id = v.plan_id
    join clients        c on c.id  = pl.client_id
   where v.id = p_version_id;

  if not found then
    return false;
  end if;

  update workout_versions v
     set awaiting_edit_instruction = false
    from workout_plans pl, clients c
   where v.plan_id = pl.id
     and pl.client_id = c.id
     and c.trainer_id = v_trainer_id
     and v.id <> p_version_id
     and v.awaiting_edit_instruction = true;

  update workout_versions
     set awaiting_edit_instruction = true
   where id = p_version_id
     and state = 'DRAFT'
     and edit_count < 5;

  return found;
end;
$$;

comment on function start_edit_instruction is
  'Prende la espera de instrucción (SPEC-004); false si ya no está en DRAFT o llegó a 5 ediciones.';

revoke all on function start_edit_instruction from anon, authenticated;

-- -----------------------------------------------------------------------------
-- cancel_edit_instruction — apaga sin condición. Cambiar de intención no es
-- un error: se llama cuando la IA falló, o cuando no hubo cuota.
-- -----------------------------------------------------------------------------
create function cancel_edit_instruction(p_version_id uuid)
returns void
language sql
security invoker
as $$
  update workout_versions
     set awaiting_edit_instruction = false
   where id = p_version_id;
$$;

comment on function cancel_edit_instruction is
  'Apaga la espera de esta versión sin guardar nada (SPEC-004).';

revoke all on function cancel_edit_instruction from anon, authenticated;

-- -----------------------------------------------------------------------------
-- cancel_any_edit_instruction — apaga cualquier espera del entrenador, sin
-- conocer la versión. Es lo que cancela en silencio cuando llega un COMANDO
-- en vez de la instrucción que se esperaba.
-- -----------------------------------------------------------------------------
create function cancel_any_edit_instruction(p_trainer_id uuid)
returns void
language sql
security invoker
as $$
  update workout_versions v
     set awaiting_edit_instruction = false
    from workout_plans pl, clients c
   where v.plan_id = pl.id
     and pl.client_id = c.id
     and c.trainer_id = p_trainer_id
     and v.awaiting_edit_instruction = true;
$$;

comment on function cancel_any_edit_instruction is
  'Apaga en silencio la espera pendiente del entrenador, si había alguna (SPEC-004).';

revoke all on function cancel_any_edit_instruction from anon, authenticated;

-- -----------------------------------------------------------------------------
-- version_awaiting_edit — la versión de este entrenador que está esperando
-- su instrucción, si hay alguna. Mismas columnas que `version_for_generation`
-- (migración 0021): es la misma llamada al proveedor, solo que editando un
-- DRAFT en vez de generar desde NEW.
--
-- JOIN con `assessments` (no LEFT): la espera solo se prende sobre una
-- versión CON evaluación — `actions.ts` ya lo decide antes de llegar aquí
-- (sin evaluación, sigue siendo el editor manual). Esta función nunca
-- necesita resolver el caso sin evaluación.
-- -----------------------------------------------------------------------------
create function version_awaiting_edit(p_trainer_id uuid)
returns table (
  version_id         uuid,
  edit_count         smallint,
  client_name        text,
  version_number     smallint,
  goal               text,
  level              text,
  days_per_week      smallint,
  session_minutes    smallint,
  equipment          text,
  limitations        text,
  has_limitations    boolean,
  trainer_chat_id    bigint,
  gender             text,
  age                smallint,
  weight_kg          numeric,
  height_cm          smallint,
  quit_reasons       text,
  menopause_stage    text,
  last_weighed       text,
  chronic_conditions text,
  medications        text,
  lifestyle          text,
  notes              text,
  equipment_detail   text
)
language sql
security invoker
stable
as $$
  select
    v.id,
    v.edit_count,
    c.full_name,
    v.version_number,
    a.goal,
    a.level,
    a.days_per_week,
    a.session_minutes,
    a.equipment,
    case when a.has_limitations then a.limitations_detail end,
    a.has_limitations,
    coalesce(p.telegram_chat_id, p.telegram_user_id),
    a.gender,
    coalesce(extract(year from age(a.created_at, a.birth_date))::smallint, a.age),
    a.weight_kg,
    a.height_cm,
    a.quit_reasons,
    a.menopause_stage,
    a.last_weighed,
    a.chronic_conditions,
    a.medications,
    a.lifestyle,
    a.notes,
    a.equipment_detail
  from workout_versions v
  join workout_plans  pl on pl.id = v.plan_id
  join assessments     a on a.id  = pl.assessment_id
  join clients         c on c.id  = pl.client_id
  join profiles        p on p.id  = c.trainer_id
  where c.trainer_id = p_trainer_id
    and v.awaiting_edit_instruction = true
  limit 1;
$$;

comment on function version_awaiting_edit is
  'La versión de este entrenador esperando su instrucción de edición, si hay alguna (SPEC-004).';

revoke all on function version_awaiting_edit from anon, authenticated;
