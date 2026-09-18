-- =============================================================================
-- SPEC-006 §3 — El disparo semanal
--
-- ┌─ ESTO NO ES UNA MIGRACIÓN, Y ES A PROPÓSITO ───────────────────────────┐
-- │ Programar el job necesita DOS valores que no pueden vivir en el repo:  │
-- │ la URL del proyecto y una credencial para llamar a la Edge Function.   │
-- │                                                                        │
-- │ Si esto fuera una migración, o llevaría esos valores escritos —un      │
-- │ secreto commiteado, que es bloqueante— o fallaría en cada `db reset`.  │
-- │ Se corre UNA VEZ a mano, con los valores delante. Ver docs/DEPLOY.md.  │
-- │                                                                        │
-- │ Tampoco puede ir en `supabase/migrations/`: `pg_cron` y `pg_net` son   │
-- │ extensiones de Supabase, y los tests corren contra un PostgreSQL       │
-- │ pelado donde `create extension` fallaría.                              │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- Uso, desde el SQL Editor de Supabase:
--
--   select schedule_weekly_checkin(
--     'https://<ref>.supabase.co/functions/v1/weekly-checkin',
--     '<el valor de CHECKIN_CRON_SECRET>'
--   );
--
-- Para cambiar la hora o el secreto, se vuelve a llamar: reemplaza el job.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function schedule_weekly_checkin(p_url text, p_secret text)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_job_id bigint;
begin
  -- Reemplazar en vez de acumular: llamar dos veces no deja dos jobs
  -- mandando el mismo check-in.
  perform cron.unschedule('weekly-checkin')
    where exists (select 1 from cron.job where jobname = 'weekly-checkin');

  -- Lunes 9:00 UTC. La Edge Function decide a QUIÉN le toca: el cron solo
  -- la despierta, así que correrlo de más no duplica nada (CA-2).
  select cron.schedule(
    'weekly-checkin',
    '0 9 * * 1',
    format(
      $job$
      select net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-checkin-cron-secret', %L
        ),
        body    := '{}'::jsonb
      );
      $job$,
      p_url,
      p_secret
    )
  ) into v_job_id;

  return v_job_id;
end;
$$;

comment on function schedule_weekly_checkin is
  'Programa el check-in semanal. Se llama a mano con la URL y el secreto (SPEC-006).';

revoke all on function schedule_weekly_checkin from anon, authenticated;
