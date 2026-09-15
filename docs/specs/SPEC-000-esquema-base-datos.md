# SPEC-000 — Esquema de base de datos y migraciones

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** (CA-7 pendiente de verificar en local) |
| **Depende de** | — |
| **Sesiones** | S-02, S-03, S-04 |

## Resultado

| CA | Qué verifica | Estado |
|---|---|---|
| CA-1 | Las 10 tablas y 4 enums se crean sin error | ✅ |
| CA-2 | Idempotencia por `UNIQUE` | ✅ |
| CA-3 | Los `CHECK` rechazan datos inválidos | ✅ |
| CA-4 | Borrar un cliente arrastra sus datos | ✅ |
| CA-5 | Un entrenador con clientes no se borra | ✅ |
| CA-6 | `anon` no obtiene ningún dato | ✅ |
| CA-7 | Los tipos generados compilan | ⏳ Pendiente |
| CA-8 | El versionado conserva las versiones anteriores | ✅ |
| CA-9 | Las operaciones atómicas son todo o nada | ✅ |
| CA-10 | Los roles se validan en la base de datos | ✅ |

**44 tests de integración en verde.** `pnpm test:integration`

**Sobre CA-7:** `supabase gen types` necesita Docker con acceso al registro de
imágenes. El archivo **no se escribe a mano**: se genera con `pnpm types:local`.
`tests/integration/types.test.ts` ya tiene el guardián contra la deriva.

## 1. Objetivo

Tener el esquema completo en migraciones versionadas, con constraints, índices,
RLS, operaciones atómicas y tipos generados.

## 2. Alcance

**Incluye:** 10 tablas, 4 enums, constraints, índices, RLS de denegación total,
dos funciones atómicas, generación de tipos.

**No incluye:** políticas RLS por rol (ver ADR-010), plantillas (viven en
`_core/templates.ts`), triggers de negocio.

## 3. Contratos

`docs/DATA-MODEL.md` es la fuente de verdad del esquema.
`docs/STATE-MACHINE.md` es la fuente de verdad de los estados.

```bash
supabase gen types typescript --linked > supabase/functions/_core/database.types.ts
```

Este archivo **se versiona** y **nunca se edita a mano**.

## 4. Reglas de negocio

1. Toda tabla tiene `id` y `created_at`.
2. Toda FK declara explícitamente su `ON DELETE`.
3. Toda restricción expresable en SQL existe como `CHECK`, no solo en TypeScript.
4. `UNIQUE (source, external_id)` en `webhook_events` — idempotencia del sistema.
5. `UNIQUE (plan_id, version_number)` en `workout_versions`.
6. `UNIQUE (client_id, version_id, week_number)` en `checkins`.
7. RLS habilitado en las 10 tablas, con denegación por defecto.
8. Las migraciones son inmutables: una vez desplegadas, los cambios van en una
   migración nueva.
9. **El enum `version_state` no contiene ningún estado de IA.** El estado de la
   IA vive en `ai_generations`.
10. **Las funciones SQL no contienen reglas de negocio.** La validez de una
    transición la decide `_core/domain/state-machine.ts`.

## 5. Estados

Crea `version_state` con los 6 estados de `STATE-MACHINE.md`, más
`user_role`, `version_source` y `change_reason`.

## 6. Errores

| Situación | Respuesta |
|---|---|
| Migración falla a medias | La transacción revierte |
| Tipos desincronizados | El build de TypeScript falla |
| Transición con estado inesperado | `apply_version_transition` devuelve `false` |

## 7. Seguridad

- RLS activo en las 10 tablas, cero políticas.
- Privilegios revocados a `anon` y `authenticated`, también por defecto para
  tablas futuras.
- Las funciones atómicas tienen sus privilegios revocados a `anon`.
- Los roles se validan con FK compuesta contra `profiles (id, role)`.

## 8. Criterios de aceptación

- **CA-1** — DADO un PostgreSQL limpio, CUANDO se aplican las migraciones,
  ENTONCES se crean 10 tablas, 4 enums y 2 funciones sin error.
- **CA-2** — DADO `webhook_events` con `('tally','evt_1')`, CUANDO se inserta la
  misma pareja, ENTONCES Postgres la rechaza.
- **CA-3** — DADO un `assessment`, CUANDO `days_per_week = 9`, ENTONCES el
  `CHECK` lo rechaza.
- **CA-4** — DADO un cliente con datos, CUANDO se borra, ENTONCES se borran en
  cascada evaluaciones, planes, versiones y eventos.
- **CA-5** — DADO un entrenador con clientes, CUANDO se intenta borrar,
  ENTONCES Postgres lo impide.
- **CA-6** — DADO `anon`, CUANDO consulta cualquier tabla o función, ENTONCES no
  obtiene nada.
- **CA-7** — DADO el esquema aplicado, CUANDO se generan los tipos, ENTONCES
  `database.types.ts` compila.
- **CA-8** — DADO un plan con v1 en `SENT`, CUANDO se crea v2, ENTONCES el
  contenido, el estado y el `sent_at` de v1 **no cambian**.
- **CA-9** — DADO `create_workout_version`, CUANDO se invoca, ENTONCES crea la
  versión, actualiza `current_version_id` y registra el evento, todo o nada.
- **CA-10** — DADO un perfil con `role='client'`, CUANDO se intenta asignar como
  entrenador, ENTONCES la FK compuesta lo rechaza.

## 9. Tests

| Nivel | Caso |
|---|---|
| Integration | CA-1 a CA-6, CA-8 a CA-10 |
| Integration | Guarda de concurrencia: doble pulsación registra una sola acción |
| Integration | Una solicitud de cambio no muta la versión |
| Integration | Un plan puede existir sin evaluación (rutina manual) |
| Integration | Una rutina manual no genera ninguna fila en `ai_generations` |

## 10. Archivos

```
supabase/config.toml
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_rls_policies.sql
supabase/migrations/0003_functions.sql
supabase/functions/_core/database.types.ts
tests/sql/00-supabase-roles.sql
tests/helpers/db.ts
tests/integration/schema.test.ts
tests/integration/types.test.ts
```
