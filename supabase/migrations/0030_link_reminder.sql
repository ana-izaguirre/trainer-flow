-- SPEC-030 regla 13 — Aviso de enlace sin abrir a las 48 horas.
--
-- ┌─ POR QUÉ NO ES UN CRON NUEVO ───────────────────────────────────────────┐
-- │ La regla dice «lo revisa el mismo sweep que ya corre cada 5 minutos»:   │
-- │ el de SPEC-002 §11 (sweep-generating). Un cliente que no vinculó no     │
-- │ merece su propio job — la Edge Function ya existente pasa a correr las  │
-- │ dos comprobaciones en la misma llamada.                                 │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- `link_reminder_sent_at` es el mismo patrón que `checkins.reminder_sent_at`
-- (migración 0010): un solo aviso por versión, con `coalesce` para que
-- marcar dos veces no pise la fecha del primero.

alter table workout_versions
  add column link_reminder_sent_at timestamptz;

-- -----------------------------------------------------------------------------
-- versions_awaiting_link_reminder
--
-- APPROVED, sin perfil vinculado, aprobada hace al menos `p_min_hours` horas,
-- y sin aviso previo. `v.updated_at` es la misma aproximación de «cuándo se
-- aprobó» que ya usa `trainer_awaiting_link` (migración 0028): no hay una
-- columna `approved_at` aparte, y la transición NEW/DRAFT → APPROVED es la
-- única que toca `updated_at` en ese estado.
-- -----------------------------------------------------------------------------
create function versions_awaiting_link_reminder(p_min_hours integer)
returns table (
  version_id      uuid,
  trainer_chat_id bigint,
  client_name     text
)
language sql
security invoker
stable
as $$
  select
    v.id,
    coalesce(t.telegram_chat_id, t.telegram_user_id),
    c.full_name
  from workout_versions v
  join workout_plans pl on pl.id = v.plan_id
  join clients        c on c.id  = pl.client_id
  join profiles       t on t.id  = c.trainer_id
  where v.state = 'APPROVED'
    and c.profile_id is null
    and v.updated_at <= now() - (p_min_hours || ' hours')::interval
    and v.link_reminder_sent_at is null;
$$;

comment on function versions_awaiting_link_reminder is
  'APPROVED sin vincular, aprobadas hace p_min_hours o más, sin aviso previo (SPEC-030 regla 13).';

revoke all on function versions_awaiting_link_reminder from anon, authenticated;

-- -----------------------------------------------------------------------------
-- mark_link_reminded
--
-- Se llama DESPUÉS de que Telegram acepte el mensaje, igual que
-- mark_checkin_reminded: marcar antes produce un aviso que consta como
-- mandado y que el entrenador no recibió.
-- -----------------------------------------------------------------------------
create function mark_link_reminded(p_version_id uuid)
returns void
language sql
security invoker
as $$
  update workout_versions
     set link_reminder_sent_at = coalesce(link_reminder_sent_at, now())
   where id = p_version_id;
$$;

comment on function mark_link_reminded is
  'Un solo aviso por versión (SPEC-030 regla 13), igual que el recordatorio del check-in.';

revoke all on function mark_link_reminded from anon, authenticated;
