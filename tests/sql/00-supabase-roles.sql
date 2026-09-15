-- Solo para tests locales.
--
-- Un proyecto de Supabase trae estos roles de fábrica. Este archivo los
-- reproduce sobre un PostgreSQL limpio para que las migraciones se apliquen
-- igual que en producción y se pueda verificar RLS de verdad.
--
-- NO es una migración. No se aplica nunca en Supabase.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase concede privilegios por defecto sobre el esquema public.
-- Se reproduce aquí para comprobar que la migración 0002 los revoca de verdad.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
