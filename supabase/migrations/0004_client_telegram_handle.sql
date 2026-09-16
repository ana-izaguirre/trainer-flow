-- =============================================================================
-- SPEC-001 — La identidad declarada del cliente es su Telegram, no su email
--
-- El formulario no pregunta el correo: pregunta el usuario de Telegram. No es
-- un cambio cosmético de columna, es dónde vive la identidad del cliente.
--
-- ┌─ ESTO NO ES UNA CREDENCIAL ─────────────────────────────────────────────┐
-- │ `telegram_handle` lo escribe el cliente en un formulario público. Sirve │
-- │ para no confundir a dos clientes llamados «Carlos», y para nada más.    │
-- │                                                                         │
-- │ NO autoriza. NO identifica de verdad. NO da acceso a nada.              │
-- │                                                                         │
-- │ La identidad verificada es `profiles.telegram_user_id`, y solo se       │
-- │ obtiene de un update firmado por Telegram (ADR-006, ADR-009).           │
-- └─────────────────────────────────────────────────────────────────────────┘
-- =============================================================================

drop index clients_trainer_email_uniq;

alter table clients drop column email;

alter table clients add column telegram_handle text;

-- La forma se valida también aquí, no solo en _core: el CHECK es lo que impide
-- que un INSERT desde otro sitio meta una variante sin normalizar y cree un
-- cliente duplicado que el índice único no llega a ver.
--
-- Reglas de Telegram: 5 a 32 caracteres, letras, dígitos y guion bajo,
-- empezando por letra. Un ID numérico de 5 a 15 dígitos también vale.
-- Siempre en minúsculas: normalizar es tarea de `_core`, no de la consulta.
alter table clients add constraint clients_telegram_handle_shape
  check (
    telegram_handle is null
    or telegram_handle ~ '^[a-z][a-z0-9_]{4,31}$'
    or telegram_handle ~ '^[0-9]{5,15}$'
  );

-- Único por entrenador, no global: dos entrenadores distintos pueden tener al
-- mismo cliente sin que uno bloquee al otro.
create unique index clients_trainer_telegram_handle_uniq
  on clients (trainer_id, telegram_handle)
  where telegram_handle is not null;

comment on column clients.telegram_handle is
  'Usuario de Telegram declarado en el formulario, ya normalizado. PISTA de identidad, nunca credencial: no autoriza nada. El id verificado vive en profiles.telegram_user_id.';
