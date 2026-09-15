# SPEC-006 — Check-in semanal

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-005 |
| **Sesiones** | S-17, S-18 |

## 1. Objetivo

Cada semana el cliente recibe un check-in corto por Telegram, y el entrenador
puede consultar las respuestas.

## 2. Alcance

**Incluye:** job programado, envío del check-in, captura de respuestas,
consulta por el entrenador.

**No incluye:** regenerar la rutina a partir del check-in (fuera de V1).

## 3. Contratos

### Disparo

`pg_cron` invoca `weekly-checkin` una vez por semana.

```sql
SELECT cron.schedule(
  'weekly-checkin',
  '0 9 * * 1',   -- lunes 9:00 UTC
  $$ SELECT net.http_post(...) $$
);
```

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
3. **`UNIQUE (client_id, plan_id, week_number)` garantiza que el cron no
   duplica check-ins** aunque corra dos veces.
4. Estados del check-in: `PENDING` al enviar, `COMPLETED` al responder.
5. Las respuestas son estructuradas (botones), salvo el campo de molestias.
6. Si el cliente no responde en 48 horas, se envía un único recordatorio.
7. Si reporta molestias, **se avisa al entrenador de inmediato.**
8. Un check-in sin responder no bloquea el de la semana siguiente.

## 5. Estados

No toca `plan_state`. Usa `checkins.state`: `PENDING → COMPLETED`.

## 6. Errores

| Situación | Efecto |
|---|---|
| Cron corre dos veces | `UNIQUE` lo impide. Sin duplicados |
| Cliente sin vincular | Se omite |
| Cliente bloqueó el bot | Se registra y se avisa al entrenador |
| Respuesta parcial | Se guarda lo que haya; sigue `PENDING` |
| Texto libre muy largo | Truncado a 500 caracteres |

## 7. Seguridad

- El cliente solo responde **su propio** check-in. Se valida por `chat_id`.
- El `callback_data` del check-in lleva el `checkinId`, validado contra el
  `chat_id` que responde.
- Las molestias reportadas son información de salud: no se loguean.

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
supabase/migrations/0003_pg_cron_checkins.sql
supabase/functions/_core/checkin-schedule.ts
supabase/functions/_core/checkin-schedule.test.ts
supabase/functions/_core/checkin-format.ts
supabase/functions/weekly-checkin/index.ts
supabase/functions/telegram-webhook/handlers/checkin.ts
```
