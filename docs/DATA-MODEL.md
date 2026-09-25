# TrainerFlow — Modelo de datos

**10 tablas.** Sin ORM: `supabase-js` con tipos generados desde el esquema.

`database.types.ts` se versiona y **nunca se edita a mano**. La fuente de
verdad son las **migraciones**, no el proyecto desplegado: CI genera el
archivo desde ellas en cada run y falla si el versionado no coincide.

Generarlo necesita Docker. Dos caminos:

- **Sin Docker** (sesiones en la nube): cuando CI falla por los tipos, sube
  el archivo correcto como artefacto `database-types`. Se descarga y se
  versiona en `supabase/functions/_core/database.types.ts`.
- **Con Docker**: `pnpm test:integration` (deja creada `trainerflow_test`) y
  después `pnpm types:local`.

`pnpm types` genera contra el proyecto vinculado: sirve para detectar si
producción se desvió de las migraciones, **no** para versionar su salida.

---

## Mapa

```
profiles ─────────────┐  identidad interna (Telegram)
   │                  │
   │ role='trainer'   │ role='client'
   ▼                  ▼
clients ──────────────┘  la relación entrenador ↔ cliente
   ├── assessments        evaluaciones de Tally (histórico)
   ├── checkins           seguimiento semanal
   └── workout_plans      un plan por ciclo
         ├── current_version_id ──┐
         └── workout_versions ◄───┘   las revisiones, inmutables
               ├── change_requests    solicitudes del cliente
               ├── ai_generations     intentos de IA + rate limit
               └── plan_events        audit trail

webhook_events   idempotencia. Sin relaciones
```

**Las plantillas NO son una tabla.** Viven como constante tipada en
`_core/templates.ts`: sin migración, sin query, y funcionan aunque la base de
datos esté caída. Es el punto §6 llevado al extremo simple.

---

## `profiles` — identidad

Toda persona que interactúa con el bot tiene un perfil. La identidad viene del
webhook de Telegram, verificado server-side.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `telegram_user_id` | `bigint` UNIQUE NOT NULL | **la identidad**. Viene del update verificado |
| `telegram_chat_id` | `bigint` UNIQUE | para enviar mensajes |
| `role` | `user_role` NOT NULL | `trainer` \| `client` |
| `full_name` | `text` NOT NULL | |
| `created_at` | `timestamptz` | |

> **`user_id` ≠ `chat_id`.** Coinciden en chats privados, pero son conceptos
> distintos. La identidad es `user_id`; el destino de un mensaje es `chat_id`.

`UNIQUE (id, role)` existe para poder referenciar el rol desde otras tablas.

## `clients` — la relación

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `trainer_id` | `uuid` FK → `profiles` | `ON DELETE RESTRICT` |
| `profile_id` | `uuid` FK → `profiles` UNIQUE | NULL hasta que se vincule |
| `full_name` | `text` NOT NULL | |
| `link_token` | `text` UNIQUE NOT NULL | `CHECK length BETWEEN 16 AND 64` |
| `linked_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

**El rol se valida en la base de datos**, no solo en código, mediante una FK
compuesta contra `profiles (id, role)`:

```sql
trainer_role text not null generated always as ('trainer') stored,
foreign key (trainer_id, trainer_role) references profiles (id, role)
```

Así es **imposible** asignar el perfil de un cliente como entrenador.

Otras restricciones:
- La vinculación es atómica: `(profile_id IS NULL) = (linked_at IS NULL)`
### No hay identidad declarada en `clients`

El formulario es onboarding: **cada envío crea un cliente nuevo**. No se busca
un cliente existente al que enganchar la evaluación.

Fusionar por nombre metería la lesión de un «Carlos Pérez» en la rutina de
otro, y en silencio. Un duplicado se ve en la lista y se borra; una fusión
no se ve nunca.

La identidad verificada vive en `profiles.telegram_user_id`, y solo sale de un
update firmado por Telegram (ADR-006, ADR-009).

`link_token` es una credencial: CSPRNG, nunca en logs, máximo 64 caracteres
(límite del `/start` de Telegram).

## `assessments` — evaluaciones

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `client_id` | `uuid` FK → `clients` | `ON DELETE CASCADE` |
| `raw_payload` | `jsonb` NOT NULL | payload íntegro de Tally |
| `goal` | `text` NOT NULL | |
| `level` | `text` NOT NULL | `beginner` \| `intermediate` \| `advanced` |
| `days_per_week` | `smallint` NOT NULL | `CHECK BETWEEN 1 AND 7` |
| `session_minutes` | `smallint` NOT NULL | `CHECK BETWEEN 15 AND 180` |
| `equipment` | `text` NOT NULL | |
| `has_limitations` | `boolean` NOT NULL | |
| `limitations_detail` | `text` | **dato de salud.** Nunca en logs |
| `lifestyle`, `notes` | `text` | |
| `created_at` | `timestamptz` | |

`raw_payload` se guarda siempre: si el parsing falla o Tally cambia campos, el
dato original no se pierde.

## `workout_plans` — el contenedor

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `client_id` | `uuid` FK → `clients` | `ON DELETE CASCADE` |
| `assessment_id` | `uuid` FK → `assessments` **NULL** | ver abajo |
| `current_version_id` | `uuid` FK → `workout_versions` NULL | la versión vigente |
| `created_at` / `updated_at` | `timestamptz` | |

> **`assessment_id` es nullable a propósito.** Una rutina creada a mano o desde
> una plantilla no necesita un formulario de Tally. Es el punto §1 expresado en
> el esquema: el dominio no depende de la IA ni del formulario.

## `workout_versions` — las revisiones

**El corazón del modelo.** Cada versión guarda un snapshot completo (§7).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `plan_id` | `uuid` FK → `workout_plans` | `ON DELETE CASCADE` |
| `version_number` | `smallint` NOT NULL | 1, 2, 3… |
| `state` | `version_state` NOT NULL | ver `STATE-MACHINE.md` |
| `content` | `jsonb` NULL | el `Workout` completo y validado |
| `source` | `version_source` NOT NULL | `ai` \| `template` \| `manual` |
| `template_id` | `text` NULL | cuál plantilla, si `source='template'` |
| `created_by` | `uuid` FK → `profiles` | quién la creó |
| `trainer_feedback` | `text` NULL | instrucción de la última edición |
| `edit_count` | `smallint` NOT NULL | `CHECK BETWEEN 0 AND 5` |
| `sent_at` | `timestamptz` NULL | base del `week_number` de los check-ins |
| `created_at` / `updated_at` | `timestamptz` | |

`UNIQUE (plan_id, version_number)` — y también es la idempotencia: un reintento
no puede crear dos veces la misma versión.

Restricciones de consistencia:
- Una versión en `DRAFT`, `APPROVED` o `SENT` **tiene contenido**
- `state = 'SENT'` **si y solo si** `sent_at` no es NULL
- `template_id` no es NULL **si y solo si** `source = 'template'`

**Una versión en `SENT` no se modifica nunca.** Un cambio produce `version + 1`.

## `change_requests` — solicitudes del cliente

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `version_id` | `uuid` FK → `workout_versions` | sobre qué versión |
| `client_id` | `uuid` FK → `clients` | |
| `reason` | `change_reason` NOT NULL | ver abajo |
| `comment` | `text` NULL | máximo 500 caracteres |
| `state` | `text` NOT NULL | `OPEN` \| `RESOLVED` |
| `resolved_by_version_id` | `uuid` FK → `workout_versions` NULL | la versión que lo resolvió |
| `created_at` / `resolved_at` | `timestamptz` | |

Motivos (`change_reason`): `too_hard`, `too_easy`, `too_long`, `no_equipment`,
`uncomfortable_exercise`, `want_variety`, `other`.

> **Es una tabla aparte, no columnas en la versión.** El punto §7 dice que la
> versión anterior debe permanecer intacta. Escribir la solicitud dentro de v1
> sería mutarla.

Índice parcial `WHERE state = 'OPEN'` para `/pendientes`.

## `ai_generations` — intentos de IA y rate limit

Una fila por **cada** intento, exitoso o no.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` identity PK | |
| `provider` | `text` NOT NULL | `gemini`. Nunca hardcodeado en `_core` |
| `model` | `text` NOT NULL | |
| `operation` | `text` NOT NULL | `generate` \| `edit` |
| `version_id` | `uuid` FK → `workout_versions` NULL | trazabilidad |
| `request_id` | `uuid` NULL | cruza con los logs |
| `status` | `text` NOT NULL | `GENERATING` \| `SUCCEEDED` \| `FAILED` |
| `failure_reason` | `text` NULL | `RATE_LIMITED`, `TIMEOUT`, `INVALID_OUTPUT`… |
| `tokens_in` / `tokens_out` | `integer` NULL | `CHECK >= 0` |
| `latency_ms` | `integer` NULL | `CHECK >= 0` |
| `created_at` / `finished_at` | `timestamptz` | |

Índice `(provider, created_at DESC)`.

> **El rate limit es una ventana, no un saldo.** El tier gratuito limita
> peticiones por minuto y por día, y se reinicia. El chequeo es
> `COUNT(*) WHERE created_at > now() - intervalo`, nunca una resta.
> Los límites viven en configuración, no en el código.

## `plan_events` — audit trail

Append-only. Responde *"¿por qué Carlos no recibió su rutina?"*.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` identity PK | |
| `plan_id` | `uuid` FK → `workout_plans` | |
| `version_id` | `uuid` FK → `workout_versions` NULL | NULL en eventos del plan |
| `event_type` | `text` NOT NULL | `state_transition`, `change_requested`… |
| `from_state` / `to_state` | `version_state` NULL | solo en transiciones |
| `actor` | `text` NOT NULL | `system` \| `ai` \| `trainer` \| `client` |
| `request_id` | `uuid` NULL | cruza con los logs |
| `metadata` | `jsonb` NULL | **nunca datos de salud ni credenciales** |
| `created_at` | `timestamptz` | |

## `checkins` — seguimiento semanal

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `client_id` | `uuid` FK → `clients` | |
| `version_id` | `uuid` FK → `workout_versions` **NOT NULL** | la versión que está siguiendo |
| `week_number` | `smallint` NOT NULL | `CHECK >= 1` |
| `state` | `text` NOT NULL | `PENDING` \| `COMPLETED` |
| `answers` | `jsonb` NULL | |
| `sent_at` / `reminder_sent_at` / `completed_at` | `timestamptz` NULL | |
| `created_at` | `timestamptz` | |

`UNIQUE (client_id, version_id, week_number)` — correr el cron dos veces no
duplica check-ins.

> **`version_id` es NOT NULL a propósito.** En PostgreSQL los NULL no colisionan
> dentro de un `UNIQUE`, así que con la columna anulable esa garantía no
> existiría de verdad.

## `webhook_events` — idempotencia

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `bigint` identity PK | |
| `source` | `text` NOT NULL | `tally` \| `telegram` |
| `external_id` | `text` NOT NULL | `eventId` o `update_id` |
| `payload` | `jsonb` NOT NULL | |
| `request_id` | `uuid` NULL | |
| `processed_at` | `timestamptz` NULL | |
| `created_at` | `timestamptz` | |

**`UNIQUE (source, external_id)` es la garantía de idempotencia del sistema.**
Todo webhook inserta aquí antes de hacer nada más. Si viola la unicidad, el
evento ya se procesó: `200` y salir.

---

## Enums

```sql
CREATE TYPE user_role      AS ENUM ('trainer', 'client');
CREATE TYPE version_source AS ENUM ('ai', 'template', 'manual');
CREATE TYPE version_state  AS ENUM
  ('NEW', 'GENERATING', 'DRAFT', 'APPROVED', 'SENT', 'REJECTED');
CREATE TYPE change_reason  AS ENUM
  ('too_hard', 'too_easy', 'too_long', 'no_equipment',
   'uncomfortable_exercise', 'want_variety', 'other');
```

---

## Atomicidad

Una sola operación toca varias tablas y **debe ser todo o nada**: crear una
versión, apuntar `current_version_id` y registrar el evento.

`supabase-js` no hace transacciones de varias sentencias, así que vive en una
función de PostgreSQL:

```sql
create function create_workout_version(...) returns uuid
```

Una llamada RPC desde la Edge Function. Atómica por definición, sin librerías.

**Ninguna otra operación la necesita:** aprobar, rechazar y enviar tocan una
sola tabla, y un `UPDATE` ya es atómico.

---

## Seguridad

- **RLS activo en las 10 tablas, con denegación total.**
- Las Edge Functions usan `service_role`, que salta RLS por diseño. **La
  autorización real vive en `_core/authorization.ts`**, funciones puras con
  cobertura del 100%.
- RLS es la red de seguridad frente a una fuga de la `anon key`.
- Las políticas por rol están diseñadas en `SECURITY.md` y se activan cuando
  exista un cliente que porte un JWT. Hoy no lo hay: la interfaz es Telegram.
- `limitations_detail` y `comment` contienen información de salud: nunca se
  escriben en logs ni en `plan_events.metadata`.
- `link_token` es una credencial: CSPRNG, nunca logueada, nunca en errores.
