-- =============================================================================
-- SPEC-002 §11 — El barrido de generaciones atascadas
--
-- Mismo motivo que supabase/cron/weekly-checkin.sql, y no se repite entero
-- aquí: necesita la URL del proyecto y una credencial que no pueden vivir en
-- una migración, y `pg_cron`/`pg_net` no existen en el Postgres pelado de los
-- tests.
--
-- Uso, desde el SQL Editor de Supabase:
--
--   select schedule_generation_sweep(
--     'https://<ref>.supabase.co/functions/v1/sweep-generating',
--     '<el valor de SWEEP_CRON_SECRET>'
--   );
--
-- Para cambiar el intervalo o el secreto, se vuelve a llamar: reemplaza el job.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function schedule_generation_sweep(p_url text, p_secret text)
returns bigint
language plpgsql
security invoker
as $$
declare
  v_job_id bigint;
begin
  -- Reemplazar en vez de acumular: llamar dos veces no deja dos jobs
  -- forzando la misma versión a la vez.
  perform cron.unschedule('sweep-generating')
    where exists (select 1 from cron.job where jobname = 'sweep-generating');

  -- Cada 5 minutos: por debajo del umbral por defecto de
  -- GENERATION_STALE_MINUTES, así que una atascada no espera dos pasadas.
  -- Correrlo de más no pisa nada (ver sweep-stale-generations.ts).
  select cron.schedule(
    'sweep-generating',
    '*/5 * * * *',
    format(
      $job$
      select net.http_post(
        url     := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-sweep-cron-secret', %L
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

comment on function schedule_generation_sweep is
  'Programa el barrido de GENERATING atascadas. Se llama a mano con la URL y el secreto (SPEC-002 §11).';

revoke all on function schedule_generation_sweep from anon, authenticated;
