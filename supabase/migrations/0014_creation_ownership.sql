-- SPEC-013 — La pertenencia le faltaba a `version_for_creation`.
--
-- ┌─ QUÉ SE ARREGLA AQUÍ ───────────────────────────────────────────────────┐
-- │ `listTemplates`, `loadTemplate` y `startManual` reciben el `version_id` │
-- │ de un `callback_data`, que es dato NO confiable, y actuaban sin        │
-- │ comprobar de quién era la versión. Dos de ellos ESCRIBEN.              │
-- │                                                                        │
-- │ No era un olvido del código: el dato para comprobar no se cargaba.     │
-- │ Esta función devolvía criterios para ordenar plantillas y nada más.    │
-- │ `version_for_action`, que sí autoriza, trae `trainer_id` desde el      │
-- │ principio. Ahora esta también.                                         │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- `create or replace` NO sirve: cambia el tipo de retorno, y Postgres lo
-- rechaza. Hay que soltarla antes. Las migraciones son inmutables
-- (SPEC-000 regla 8), así que 0012 se queda como está y esto va aparte.

drop function if exists version_for_creation(uuid);

create function version_for_creation(p_version_id uuid)
returns table (
  version_id        uuid,
  state             version_state,
  client_name       text,
  version_number    smallint,
  days_per_week     smallint,
  level             text,
  equipment         text,
  has_limitations   boolean,
  -- Lo nuevo: con esto se puede responder «¿de quién es esta versión?».
  client_id         uuid,
  trainer_id        uuid,
  client_profile_id uuid
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
    coalesce(a.has_limitations, false),
    c.id,
    c.trainer_id,
    c.profile_id
  from workout_versions v
  join workout_plans   pl on pl.id = v.plan_id
  join clients          c on c.id  = pl.client_id
  left join assessments a on a.id  = pl.assessment_id
  where v.id = p_version_id;
$$;

comment on function version_for_creation is
  'Criterios para ordenar plantillas Y pertenencia, para poder autorizar (SPEC-013). NO devuelve limitations_detail: solo el booleano.';

revoke all on function version_for_creation from anon, authenticated;
