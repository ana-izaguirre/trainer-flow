-- =============================================================================
-- SPEC-000 — Row Level Security
--
-- Modelo de acceso de V1:
--
--   Edge Functions  → service_role → salta RLS por diseño. Aquí vive la
--                     autorización real (verificación de chat_id de Telegram).
--   anon / authenticated → SIN ACCESO A NADA.
--
-- Habilitar RLS sin definir políticas produce denegación total. Eso es
-- exactamente lo que queremos: la política por defecto es deniega-todo.
--
-- Supabase concede privilegios automáticamente a anon y authenticated sobre
-- las tablas nuevas del esquema public. Por eso además se revocan de forma
-- explícita: defensa en profundidad frente a una fuga de la anon key.
-- =============================================================================

alter table trainers       enable row level security;
alter table clients        enable row level security;
alter table assessments    enable row level security;
alter table workout_plans  enable row level security;
alter table plan_events    enable row level security;
alter table checkins       enable row level security;
alter table webhook_events enable row level security;
alter table ai_usage       enable row level security;

-- Sin políticas definidas: nadie que pase por RLS puede leer ni escribir.

revoke all on trainers       from anon, authenticated;
revoke all on clients        from anon, authenticated;
revoke all on assessments    from anon, authenticated;
revoke all on workout_plans  from anon, authenticated;
revoke all on plan_events    from anon, authenticated;
revoke all on checkins       from anon, authenticated;
revoke all on webhook_events from anon, authenticated;
revoke all on ai_usage       from anon, authenticated;

-- Las secuencias de las columnas de identidad también quedan fuera de alcance.
revoke all on all sequences in schema public from anon, authenticated;

-- Y las tablas que se creen en el futuro nacen igual de cerradas.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

comment on schema public is
  'RLS activo y deniega-todo. El acceso va por service_role desde Edge Functions.';
