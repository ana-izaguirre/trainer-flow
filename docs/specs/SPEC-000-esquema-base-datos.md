# SPEC-000 — Esquema de base de datos y migraciones

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** (CA-7 pendiente de verificar en local) |
| **Depende de** | — |
| **Sesiones** | S-02, S-03, S-04 |

## Resultado de la implementación

| CA | Qué verifica | Estado |
|---|---|---|
| CA-1 | Las 8 tablas se crean sin error | ✅ Verificado |
| CA-2 | `UNIQUE (source, external_id)` rechaza duplicados | ✅ Verificado |
| CA-3 | Los `CHECK` rechazan datos inválidos | ✅ Verificado |
| CA-4 | Borrar un cliente arrastra sus datos | ✅ Verificado |
| CA-5 | Un entrenador con clientes no se borra | ✅ Verificado |
| CA-6 | `anon` no obtiene ningún dato | ✅ Verificado |
| CA-7 | Los tipos generados compilan | ⏳ Pendiente |

**35 tests de integración**, 32 en verde y 3 en espera de CA-7.

```bash
pnpm test:integration
```

**Sobre CA-7.** `supabase gen types` necesita Docker, y en el entorno remoto
donde se implementó esto el registro de imágenes está bloqueado. El archivo
**no se escribió a mano** a propósito: se genera en local con

```bash
pnpm types:local     # contra la base de datos local
pnpm types           # contra el proyecto vinculado
```

`tests/integration/types.test.ts` ya contiene el guardián contra la deriva:
en cuanto el archivo exista, verifica que declara las 8 tablas, todas sus
columnas y los 10 valores del enum. Hasta entonces esos 3 tests quedan en
espera.

### Cambios sobre el diseño original

Tres decisiones se ajustaron al implementar, y `DATA-MODEL.md` ya las refleja:

1. **`checkins.plan_id` pasa a NOT NULL.** En PostgreSQL los NULL no colisionan
   dentro de una restricción `UNIQUE`, así que con `plan_id` anulable la
   garantía de idempotencia del cron (regla 5) no existía de verdad.
2. **Cuatro columnas nuevas** que specs posteriores necesitan:
   `workout_plans.telegram_message_id`, `.edit_count`, `.sent_at` y
   `checkins.reminder_sent_at`.
3. **Cinco `CHECK` de consistencia** añadidos, por la regla 3 de esta spec
   (toda restricción expresable en SQL existe como `CHECK`).

## 1. Objetivo

Tener el esquema completo de PostgreSQL versionado en migraciones, con
constraints, índices, RLS y tipos TypeScript generados.

## 2. Alcance

**Incluye:** las 8 tablas de `docs/DATA-MODEL.md`, el enum `plan_state`,
constraints, índices, políticas RLS, generación de tipos.

**No incluye:** datos de prueba de producción, funciones de Postgres, triggers
de negocio (la lógica vive en las Edge Functions).

## 3. Contratos

Ver `docs/DATA-MODEL.md` como fuente de verdad del esquema.

Tipos generados en `supabase/functions/_core/database.types.ts`:

```bash
supabase gen types typescript --linked > supabase/functions/_core/database.types.ts
```

Este archivo **se versiona** y **nunca se edita a mano**.

## 4. Reglas de negocio

1. Toda tabla tiene `id` y `created_at`.
2. Toda FK declara explícitamente su `ON DELETE`.
3. Toda restricción de negocio expresable en SQL existe como `CHECK`,
   no solo en TypeScript.
4. `UNIQUE (source, external_id)` en `webhook_events` — es la garantía de
   idempotencia de todo el sistema.
5. `UNIQUE (client_id, plan_id, week_number)` en `checkins`.
6. RLS habilitado en las 8 tablas, con política por defecto deniega-todo.
7. Las migraciones son inmutables: una vez commiteada, una migración no se
   edita. Los cambios van en una migración nueva.

## 5. Estados

Crea el enum `plan_state` con los 10 valores definidos en `docs/DATA-MODEL.md`.

## 6. Errores

| Situación | Respuesta |
|---|---|
| Migración falla a medias | Transacción revierte; se corrige y se vuelve a aplicar |
| Tipos desincronizados del esquema | El build de TypeScript falla |

## 7. Seguridad

- RLS activo en las 8 tablas.
- Política por defecto: nadie lee nada con `anon key`.
- Las Edge Functions usan `service_role` y saltan RLS por diseño.
- `link_token` con `UNIQUE` y `NOT NULL`.

## 8. Criterios de aceptación

- **CA-1** — DADO un Supabase local limpio, CUANDO se ejecuta
  `supabase db reset`, ENTONCES las 8 tablas se crean sin error.
- **CA-2** — DADO `webhook_events` con una fila `('tally','evt_1')`, CUANDO
  se inserta la misma pareja, ENTONCES Postgres rechaza con violación de
  unicidad.
- **CA-3** — DADO un `assessment`, CUANDO se inserta `days_per_week = 9`,
  ENTONCES el `CHECK` lo rechaza.
- **CA-4** — DADO un cliente con planes asociados, CUANDO se borra el
  cliente, ENTONCES sus planes se borran en cascada.
- **CA-5** — DADO un `trainer` con clientes, CUANDO se intenta borrarlo,
  ENTONCES Postgres lo impide (`ON DELETE RESTRICT`).
- **CA-6** — DADO un cliente con `anon key`, CUANDO consulta `clients`,
  ENTONCES RLS devuelve cero filas.
- **CA-7** — DADO el esquema aplicado, CUANDO se generan los tipos, ENTONCES
  `database.types.ts` compila sin errores.

## 9. Tests

| Nivel | Caso |
|---|---|
| Integration | CA-1 a CA-7, contra Supabase local |

## 10. Archivos que toca

```
supabase/config.toml
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_rls_policies.sql
supabase/functions/_core/database.types.ts
```
