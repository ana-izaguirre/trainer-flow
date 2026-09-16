-- =============================================================================
-- SPEC-001 — El formulario es onboarding, no un canal de actualización
--
-- `telegram_handle` existía para reconocer a un cliente que volvía a llenar el
-- formulario. Ese caso no existe: un cliente que ya está dentro habla por
-- Telegram, y su entrenador crea una versión nueva. No vuelve al formulario.
--
-- Sin ese caso, el campo solo aportaba una forma de perder un envío: un typo
-- en el usuario invalidaba la evaluación entera.
--
-- ┌─ QUÉ PASA AHORA CON LOS DUPLICADOS ─────────────────────────────────────┐
-- │ Cada envío del formulario crea un cliente nuevo. Punto.                 │
-- │                                                                         │
-- │ Si alguien lo llena dos veces, quedan dos filas y el entrenador borra   │
-- │ una. Es VISIBLE.                                                        │
-- │                                                                         │
-- │ La alternativa —resolver por nombre— fusionaría en silencio a dos       │
-- │ personas distintas llamadas «Carlos», metiendo la lesión de uno en la   │
-- │ rutina del otro. Un duplicado que se ve es mejor que una fusión que no. │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- La identidad verificada sigue donde siempre: profiles.telegram_user_id,
-- que solo sale de un update firmado por Telegram (ADR-006, ADR-009).
-- =============================================================================

drop index clients_trainer_telegram_handle_uniq;

alter table clients drop constraint clients_telegram_handle_shape;

alter table clients drop column telegram_handle;
