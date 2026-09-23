-- SPEC-023 — La rutina vigente del cliente, para que pueda volver a verla.
--
-- ┌─ EL PARÁMETRO ES EL PERFIL, NO EL CLIENTE ─────────────────────────────┐
-- │ Recibe `p_profile_id`, que sale de la identidad ya verificada por      │
-- │ Telegram (ADR-009), y resuelve el `client_id` aquí dentro.             │
-- │                                                                        │
-- │ Con `p_client_id` habría que comprobar en el código que ese cliente es │
-- │ quien escribe, y esa comprobación se puede olvidar. Así **no existe la │
-- │ forma de pedir la rutina de otro**: no hay dónde ponerla.              │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Devuelve la misma forma que `version_for_delivery` porque el cliente ve
-- exactamente lo que recibió: mismo formateo, mismos botones.

create function sent_version_for_profile(p_profile_id uuid)
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
        join clients        c on c.id  = pl.client_id
       where c.profile_id = p_profile_id
         -- SENT, no APPROVED: una versión aprobada todavía no es suya.
         and v.state = 'SENT'
       -- `sent_at` es cuándo la recibió. `created_at` desempata por si una
       -- versión antigua quedó sin marcar.
       order by v.sent_at desc nulls last, v.created_at desc
       limit 1
    )) d;
$$;

revoke all on function sent_version_for_profile from anon, authenticated;

comment on function sent_version_for_profile is
  'La rutina vigente del cliente que escribe. El parámetro es su perfil, '
  'no su ficha: así no hay forma de pedir la de otro (SPEC-023 §8).';
