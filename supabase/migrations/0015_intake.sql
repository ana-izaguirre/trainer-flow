-- SPEC-015 — La evaluación completa que originó una versión.
--
-- ┌─ POR QUÉ HACE FALTA UNA FUNCIÓN NUEVA ─────────────────────────────────┐
-- │ `version_for_creation` trae `has_limitations` pero NO el detalle, y es │
-- │ deliberado: alimenta un aviso que se ve en la pantalla de bloqueo.     │
-- │                                                                        │
-- │ Esta alimenta un mensaje que el entrenador pide pulsando un botón,     │
-- │ así que sí trae el detalle. Son dos lecturas con dos reglas: mezclarlas│
-- │ significaría que la más laxa manda en las dos.                         │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Trae la pertenencia porque se alcanza desde un `callback_data`, que es dato
-- no confiable (SPEC-013).

create function assessment_for_version(p_version_id uuid)
returns table (
  version_id         uuid,
  client_id          uuid,
  trainer_id         uuid,
  client_profile_id  uuid,
  state              version_state,
  client_name        text,
  goal               text,
  level              text,
  days_per_week      smallint,
  session_minutes    smallint,
  equipment          text,
  has_limitations    boolean,
  limitations_detail text,
  lifestyle          text,
  notes              text,
  submitted_at       timestamptz
)
language sql
security invoker
stable
as $$
  select
    v.id,
    c.id,
    c.trainer_id,
    c.profile_id,
    v.state,
    c.full_name,
    a.goal,
    a.level,
    a.days_per_week,
    a.session_minutes,
    a.equipment,
    a.has_limitations,
    a.limitations_detail,
    a.lifestyle,
    a.notes,
    a.created_at
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  -- INNER: sin evaluación no hay ficha que enseñar, y el flujo lo dice.
  join assessments      a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function assessment_for_version is
  'La evaluación completa, CON limitations_detail. Solo para un mensaje que el entrenador pide (SPEC-015).';

revoke all on function assessment_for_version from anon, authenticated;
