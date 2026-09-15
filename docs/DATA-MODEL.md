# TrainerFlow — Modelo de datos

ORM: **ninguno**. Se usa `supabase-js` con tipos generados desde el esquema:

```bash
supabase gen types typescript --linked > supabase/functions/_core/database.types.ts
```

Migraciones en SQL versionado bajo `supabase/migrations/`.

---

## Relaciones

```
trainers
   └── clients
         ├── assessments      (histórico: 1 cliente → N evaluaciones)
         ├── workout_plans    (histórico: 1 cliente → N rutinas)
         │     └── plan_events (audit trail de transiciones)
         └── checkins

webhook_events   (idempotencia, sin relaciones)
ai_usage         (control de rate limit, sin relaciones)
```

---

## Tablas

### `trainers`

Un solo registro en V1, pero la tabla existe desde el día 1 para evitar una
migración dolorosa después.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `full_name` | `text` NOT NULL | |
| `telegram_chat_id` | `bigint` UNIQUE | chat del entrenador |
| `created_at` | `timestamptz` | `now()` |

### `clients`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `trainer_id` | `uuid` FK → `trainers` | `ON DELETE RESTRICT` |
| `full_name` | `text` NOT NULL | |
| `email` | `text` | de Tally, puede faltar |
| `telegram_chat_id` | `bigint` UNIQUE NULL | NULL hasta que se vincule |
| `link_token` | `text` UNIQUE NOT NULL | para el deep link de Telegram |
| `linked_at` | `timestamptz` NULL | cuándo se vinculó |
| `created_at` | `timestamptz` | |

`link_token`: aleatorio, mínimo 32 caracteres, seguro para URL.
Telegram limita el payload de `/start` a 64 caracteres.

### `assessments`

Respuestas del formulario. Un cliente puede reevaluarse con el tiempo.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `client_id` | `uuid` FK → `clients` | `ON DELETE CASCADE` |
| `raw_payload` | `jsonb` NOT NULL | payload íntegro de Tally |
| `goal` | `text` NOT NULL | objetivo |
| `level` | `text` NOT NULL | `beginner` / `intermediate` / `advanced` |
| `days_per_week` | `smallint` NOT NULL | `CHECK BETWEEN 1 AND 7` |
| `session_minutes` | `smallint` NOT NULL | `CHECK BETWEEN 15 AND 180` |
| `equipment` | `text` NOT NULL | |
| `has_limitations` | `boolean` NOT NULL | |
| `limitations_detail` | `text` NULL | |
| `lifestyle` | `text` NULL | |
| `notes` | `text` NULL | |
| `created_at` | `timestamptz` | |

`raw_payload` se guarda siempre: si el parsing falla o Tally cambia campos,
el dato original no se pierde.

### `workout_plans`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `client_id` | `uuid` FK → `clients` | |
| `assessment_id` | `uuid` FK → `assessments` | |
| `state` | `plan_state` NOT NULL | enum, ver abajo |
| `version` | `smallint` NOT NULL | empieza en 1, sube con cada edición |
| `content` | `jsonb` NULL | la rutina estructurada |
| `trainer_feedback` | `text` NULL | instrucción de la última edición |
| `failure_reason` | `text` NULL | por qué falló la generación |
| `created_at` / `updated_at` | `timestamptz` | |

Índice parcial para `/pendientes`:
`CREATE INDEX ON workout_plans (client_id) WHERE state = 'TRAINER_REVIEW';`

### `plan_events` — audit trail

Append-only. Responde *"¿por qué Carlos no recibió su rutina?"*.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigserial` PK | |
| `plan_id` | `uuid` FK → `workout_plans` | |
| `from_state` | `plan_state` NULL | NULL en la creación |
| `to_state` | `plan_state` NOT NULL | |
| `actor` | `text` NOT NULL | `system` / `gemini` / `trainer` / `client` |
| `metadata` | `jsonb` NULL | sin datos sensibles |
| `created_at` | `timestamptz` | |

### `checkins`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `client_id` | `uuid` FK → `clients` | |
| `plan_id` | `uuid` FK → `workout_plans` NULL | |
| `week_number` | `smallint` NOT NULL | |
| `state` | `text` NOT NULL | `PENDING` / `COMPLETED` |
| `answers` | `jsonb` NULL | |
| `sent_at` / `completed_at` | `timestamptz` NULL | |

`UNIQUE (client_id, plan_id, week_number)` — evita check-ins duplicados si el
cron corre dos veces.

### `webhook_events` — idempotencia

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigserial` PK | |
| `source` | `text` NOT NULL | `tally` / `telegram` |
| `external_id` | `text` NOT NULL | id del evento en el origen |
| `payload` | `jsonb` NOT NULL | |
| `processed_at` | `timestamptz` NULL | NULL = recibido, no procesado |
| `created_at` | `timestamptz` | |

**`UNIQUE (source, external_id)` es la garantía de idempotencia.**
Todo webhook inserta aquí primero. Violación de unicidad = duplicado → 200 y salir.

Para Telegram, `external_id` es el `update_id`.
Para Tally, el `eventId` del payload.

### `ai_usage` — rate limit

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigserial` PK | |
| `provider` | `text` NOT NULL | `gemini` |
| `model` | `text` NOT NULL | |
| `operation` | `text` NOT NULL | `generate` / `edit` |
| `plan_id` | `uuid` NULL | trazabilidad |
| `tokens_in` / `tokens_out` | `integer` NULL | |
| `latency_ms` | `integer` NULL | |
| `success` | `boolean` NOT NULL | |
| `error_code` | `text` NULL | |
| `created_at` | `timestamptz` NOT NULL | **clave para la ventana** |

`CREATE INDEX ON ai_usage (provider, created_at DESC);`

**Modelo mental correcto:** el tier gratuito de Gemini limita por *ventana de
tiempo* (peticiones por minuto y por día), no es un saldo que se agota.
El chequeo es `COUNT(*) WHERE created_at > now() - interval`, no una resta.

Los límites viven en configuración, no hardcodeados — los cambia el proveedor.

---

## Enum de estados

```sql
CREATE TYPE plan_state AS ENUM (
  'NEW',            -- evaluación guardada, sin generar
  'GENERATING',     -- Gemini trabajando
  'DRAFT',          -- borrador listo
  'TRAINER_REVIEW', -- esperando al entrenador
  'EDITING',        -- Gemini aplicando correcciones
  'APPROVED',       -- aprobado, pendiente de envío
  'SENT',           -- entregado al cliente
  'REJECTED',       -- descartado
  'FAILED',         -- Gemini falló
  'MANUAL'          -- sin cuota de IA: el entrenador lo hace a mano
);
```

`FAILED` y `MANUAL` no estaban en el diseño original. Son necesarios para que
la degradación controlada (ADR-005) tenga dónde apoyarse.

---

## Seguridad de datos

- **RLS activo en todas las tablas.** Las Edge Functions usan `service_role`,
  que la salta; RLS protege frente a accesos con `anon key`.
- `limitations_detail` contiene información de salud: nunca se registra en
  logs ni se manda a servicios que no sean Gemini.
- `link_token` es una credencial: se genera con CSPRNG y nunca se loguea.
