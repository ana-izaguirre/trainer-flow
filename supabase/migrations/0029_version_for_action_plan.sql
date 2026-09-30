-- =============================================================================
-- SPEC-031 — `version_for_action` trae también `goal` y `session_minutes`
--
-- `days_per_week` y `has_limitations` ya venían (para validar al aprobar,
-- SPEC-008 regla 11). Faltaban los otros dos campos del plan: la navegación
-- de la rutina (índice, por día, completa) necesita reconstruir la vista del
-- CLIENTE cuando navega, y esa vista lleva la misma línea de objetivo que el
-- mensaje de entrega (`version_for_delivery`, que ya trae los tres juntos).
-- =============================================================================

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
  session_minutes   smallint
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
    a.session_minutes
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  -- Sin evaluación no hay criterios contra los que comparar: se valida la
  -- forma. Por eso LEFT y no INNER.
  left join assessments a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function version_for_action is
  'La versión con su pertenencia, sus criterios Y su plan. Aprobar valida '
  '(SPEC-008 regla 11); goal/session_minutes son para repintar la vista del '
  'cliente al navegar (SPEC-031).';

revoke all on function version_for_action from anon, authenticated;
