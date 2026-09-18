# SPEC-006 — Check-in semanal

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-005 |
| **Sesiones** | S-21, S-22 |

## Resultado

| Pieza | Estado |
|---|---|
| `calculateWeekNumber` desde `sent_at` (regla 2) | ✅ 10 tests |
| `shouldSendCheckin` (reglas 1 y 8, CA-6) | ✅ 7 tests |
| `needsReminder`, uno solo (regla 6, CA-5) | ✅ 4 tests |
| Parseo y validación de las respuestas (regla 5) | ✅ 14 tests |
| Aviso inmediato al entrenador (regla 7, CA-4) | ✅ 5 tests |
| Mensajes y teclado (§3) | ✅ 14 tests |
| La pasada semanal `runWeeklyCheckins` | ✅ 12 tests |
| Captura de respuestas y CA-7 | ✅ 15 tests |
| Edge Function `weekly-checkin` | ✅ 6 tests |
| Consultas SQL | ✅ 19 tests de integración |
| El job de `pg_cron` | ✅ `supabase/cron/weekly-checkin.sql` |

## 1. Objetivo

Cada semana el cliente recibe un check-in corto por Telegram, y el entrenador
puede consultar las respuestas.

## 2. Alcance

**Incluye:** job programado, envío del check-in, captura de respuestas,
consulta por el entrenador.

**No incluye:** regenerar la rutina a partir del check-in (fuera de V1).

## 3. Contratos

### Disparo

`pg_cron` invoca `weekly-checkin` los lunes a las 9:00 UTC.

El job **no vive en una migración**: programarlo necesita la URL del proyecto
y una credencial, y ninguna de las dos puede estar en el repositorio. Vive en
`supabase/cron/weekly-checkin.sql` y se corre una vez a mano (ver
`docs/DEPLOY.md`).

```sql
select schedule_weekly_checkin(
  'https://<ref>.supabase.co/functions/v1/weekly-checkin',
  '<CHECKIN_CRON_SECRET>'
);
```

**La función está expuesta a internet**, así que exige la cabecera
`x-checkin-cron-secret`, comparada en tiempo constante. Sin ella, cualquiera
podría dispararla en bucle y llenar de check-ins el Telegram de los clientes.

Correrla de más no duplica nada: el `UNIQUE` decide qué check-ins existen, no
el número de llamadas (CA-2).

### Mensaje al cliente

```
📊 Check-in semanal — semana 3

1️⃣ ¿Cuántas sesiones completaste?
[0] [1] [2] [3] [4+]

2️⃣ ¿Cómo te sentiste?
[😫 Muy duro] [💪 Bien] [😌 Fácil]

3️⃣ ¿Alguna molestia? (escribe o pulsa)
[✅ Ninguna]
```

### Vista del entrenador

```
📊 Carlos — semana 3
Sesiones: 3/4
Sensación: 💪 Bien
Molestias: ninguna
```

## 4. Reglas de negocio

1. Solo reciben check-in los clientes con un plan en `SENT`.
2. `week_number` se calcula desde `sent_at` del plan.
3. **`UNIQUE (client_id, version_id, week_number)` garantiza que el cron no
   duplica check-ins** aunque corra dos veces.
4. Estados del check-in: `PENDING` al enviar, `COMPLETED` al responder.
5. Las respuestas son estructuradas (botones), salvo el campo de molestias.
6. Si el cliente no responde en 48 horas, se envía un único recordatorio.
7. Si reporta molestias, **se avisa al entrenador de inmediato.**
8. Un check-in sin responder no bloquea el de la semana siguiente.
9. **Se pregunta por la semana en curso, no por las atrasadas.** Preguntar por
   la semana 2 cuando ya va por la 4 pide un recuerdo que el cliente no tiene.
10. **Un texto suelto solo se lee como molestia si hay un check-in esperándola.**
    Si no, es alguien escribiéndole al bot, y eso no se reinterpreta.
11. **Marcar «enviado» ocurre DESPUÉS de enviar.** Al revés, un check-in
    constaría como mandado sin que nadie lo recibiera, y no se reintentaría.

## 5. Estados

No toca `version_state`. Usa `checkins.state`: `PENDING → COMPLETED`.

## 6. Errores

| Situación | Efecto |
|---|---|
| Cron corre dos veces | `UNIQUE` lo impide. Sin duplicados |
| Cliente sin vincular | Se omite |
| Cliente bloqueó el bot | Se registra y se avisa al entrenador |
| Respuesta parcial | Se guarda lo que haya; sigue `PENDING` |
| Texto libre muy largo | Truncado a 500 caracteres |

## 7. Seguridad

- El cliente solo responde **su propio** check-in. Se valida contra el
  `profile_id`, no contra el `chat_id`: el chat cambia cuando alguien
  reinstala Telegram o cambia de dispositivo, y el perfil no.
- El `callback_data` lleva el `checkinId`, y **eso no autoriza nada**:
  cualquiera puede fabricar uno. Lo que lo detiene es comparar el dueño del
  check-in con la identidad que resolvió el webhook (CA-7).
- Las molestias reportadas son información de salud: **van al entrenador, que
  es quien decide, y NUNCA a los logs.** Los mensajes de error de la capa de
  datos llevan códigos de PostgreSQL, no las respuestas.

## 8. Criterios de aceptación

- **CA-1** — DADO un cliente con plan en `SENT` hace 7 días, CUANDO corre el
  cron, ENTONCES recibe el check-in de la semana 1 en estado `PENDING`.
- **CA-2** — DADO que el cron corre dos veces la misma semana, CUANDO se
  ejecuta, ENTONCES existe **un solo** check-in.
- **CA-3** — DADO un check-in `PENDING`, CUANDO el cliente responde todo,
  ENTONCES pasa a `COMPLETED` con las respuestas guardadas.
- **CA-4** — DADO un cliente que reporta molestia, CUANDO responde, ENTONCES
  el entrenador recibe el aviso inmediato.
- **CA-5** — DADO un check-in sin responder tras 48 horas, CUANDO corre el
  recordatorio, ENTONCES se envía **uno solo**.
- **CA-6** — DADO un cliente sin plan en `SENT`, CUANDO corre el cron,
  ENTONCES no recibe nada.
- **CA-7** — DADO el `checkinId` de otro cliente, CUANDO alguien responde,
  ENTONCES se rechaza.
- **CA-8** — DADO un check-in ya completado, CUANDO se intenta responder otra
  vez, ENTONCES se rechaza con la misma respuesta que uno ajeno.
- **CA-9** — DADO un cliente sin check-in abierto, CUANDO escribe un mensaje,
  ENTONCES no se guarda como molestia.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `calculateWeekNumber` desde `sent_at` |
| Unit | `shouldSendCheckin`: con plan `SENT`, sin plan, ya enviado |
| Unit | `parseCheckinAnswer` para cada botón |
| Integration | CA-1, CA-2 (idempotencia del cron), CA-3, CA-7 |
| E2E | Paso 9 del camino crítico |

## 10. Archivos que toca

```
supabase/migrations/0010_checkins.sql
supabase/cron/weekly-checkin.sql          ← NO es una migración, y a propósito
supabase/functions/_core/checkin/schedule.ts
supabase/functions/_core/checkin/answers.ts
supabase/functions/_core/checkin/format.ts
supabase/functions/_core/checkin/send.ts
supabase/functions/_core/checkin/reply.ts
supabase/functions/_core/ports/checkin-ports.ts
supabase/functions/weekly-checkin/index.ts
supabase/functions/telegram-webhook/index.ts   ← el enrutado de `chk:`
tests/integration/checkins.test.ts
```
