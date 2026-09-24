-- =============================================================================
-- SPEC-002 §11 — Qué GENERATING lleva demasiado tiempo
--
-- El resto del arreglo de S-49 (botones en `/cliente`) no toca este caso:
-- una `GENERATING` no tiene ningún botón a propósito, mientras trabaja de
-- verdad. Solo `generate-version` sabe devolverla a `NEW` cuando algo sale
-- mal. Si la función muere ANTES de llegar a esa línea —timeout de la
-- plataforma, un OOM, cualquier fallo que no pase por su propio try/catch—,
-- no queda nadie que la desatasque.
--
-- Esta consulta es la mitad de solo-lectura de ese arreglo: la Edge Function
-- `sweep-generating` la usa para encontrar candidatas, y para cada una aplica
-- la transición de siempre (`apply_version_transition`), con la MISMA guarda
-- de concurrencia que usa cualquier otro camino: si la generación real
-- terminó un instante antes, el `UPDATE ... WHERE state = 'GENERATING'` no
-- toca nada.
-- =============================================================================

create function stale_generating_versions(p_min_minutes integer)
returns table (
  version_id      uuid,
  trainer_chat_id bigint,
  client_name     text,
  minutes_stuck   integer
)
language sql
security invoker
stable
as $$
  select
    v.id,
    coalesce(p.telegram_chat_id, p.telegram_user_id),
    c.full_name,
    floor(extract(epoch from (now() - v.updated_at)) / 60)::integer
  from workout_versions v
  join workout_plans pl on pl.id = v.plan_id
  join clients        c on c.id  = pl.client_id
  join profiles        p on p.id  = c.trainer_id
  where v.state = 'GENERATING'
    and v.updated_at <= now() - (p_min_minutes || ' minutes')::interval
  order by v.updated_at;
$$;

comment on function stale_generating_versions is
  'GENERATING de hace más de p_min_minutes: la generación murió a medias (SPEC-002 §11).';

revoke all on function stale_generating_versions from anon, authenticated;
