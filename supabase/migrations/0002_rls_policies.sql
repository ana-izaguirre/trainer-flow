-- =============================================================================
-- SPEC-000 — Row Level Security
--
-- Modelo de acceso de V1 (ver ADR-010):
--
--   Telegram → Edge Functions → service_role → salta RLS por diseño.
--   La autorización REAL vive en _core/authorization.ts: funciones puras,
--   cobertura 100%, invocadas antes de cada operación.
--
--   anon / authenticated → SIN ACCESO A NADA.
--
-- Habilitar RLS sin políticas produce denegación total. Eso es exactamente lo
-- que queremos: no hay ningún cliente que porte un JWT, así que unas políticas
-- por rol nunca se evaluarían y darían una falsa sensación de seguridad.
--
-- Las políticas por rol están diseñadas en docs/SECURITY.md y se activan el día
-- que exista un cliente con JWT (una WebApp, un dashboard).
-- =============================================================================

alter table profiles         enable row level security;
alter table clients          enable row level security;
alter table assessments      enable row level security;
alter table workout_plans    enable row level security;
alter table workout_versions enable row level security;
alter table change_requests  enable row level security;
alter table ai_generations   enable row level security;
alter table plan_events      enable row level security;
alter table checkins         enable row level security;
alter table webhook_events   enable row level security;

-- Sin políticas: nadie que pase por RLS lee ni escribe nada.

-- Supabase concede privilegios automáticamente a anon y authenticated sobre las
-- tablas nuevas del esquema public. Se revocan explícitamente: defensa en
-- profundidad frente a una fuga de la anon key.
revoke all on profiles         from anon, authenticated;
revoke all on clients          from anon, authenticated;
revoke all on assessments      from anon, authenticated;
revoke all on workout_plans    from anon, authenticated;
revoke all on workout_versions from anon, authenticated;
revoke all on change_requests  from anon, authenticated;
revoke all on ai_generations   from anon, authenticated;
revoke all on plan_events      from anon, authenticated;
revoke all on checkins         from anon, authenticated;
revoke all on webhook_events   from anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;

-- Las tablas futuras nacen igual de cerradas.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

comment on schema public is
  'RLS activo y deniega-todo. Autorización en _core/authorization.ts (ADR-010).';
