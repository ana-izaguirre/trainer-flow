-- =============================================================================
-- SPEC-014 §3 — El cliente dueño de una versión, con su link_token
--
-- La spec original dejó esto fuera a propósito: «si resulta incómodo en uso
-- real, se añade entonces — necesitaría migración, porque
-- trainer_client_detail no devuelve el token». Pasó.
--
-- Resuelve por version_id, no por client_id: es lo que viaja en el
-- `callback_data` del botón 🔗 de la ficha (igual que `assessment_for_version`
-- para 📄), y cualquier versión de un cliente resuelve al mismo cliente.
--
-- `link_token` es una credencial (SPEC-001 regla 6): por eso esta función,
-- como todas las que la tocan, es `security invoker` y solo la llama
-- `service_role` — nunca `anon` ni `authenticated`.
-- =============================================================================

create function client_for_resend(p_version_id uuid)
returns table (
  client_id   uuid,
  trainer_id  uuid,
  profile_id  uuid,
  full_name   text,
  linked      boolean,
  link_token  text
)
language sql
security invoker
stable
as $$
  select
    c.id,
    c.trainer_id,
    c.profile_id,
    c.full_name,
    c.profile_id is not null,
    c.link_token
  from workout_versions v
  join workout_plans pl on pl.id = v.plan_id
  join clients        c on c.id  = pl.client_id
  where v.id = p_version_id;
$$;

comment on function client_for_resend is
  'El cliente dueño de esta versión, con su link_token, para reenviar el enlace (SPEC-014 §3).';

revoke all on function client_for_resend from anon, authenticated;
