# RUNBOOK — cuando algo no funciona

> **La base es el índice. Los logs son el detalle.**
>
> Nunca se empieza buscando en los logs: se empieza por una persona o una
> rutina, se saca el `request_id` de la base, y con él se leen los logs.

---

## Cómo se lee un log

Cada línea es un JSON de una sola línea:

```json
{"event":"generate.generated","level":"info","requestId":"3f25…","versionId":"a1b2…","durationMs":8412}
```

| Campo | Para qué sirve |
|---|---|
| `event` | `<función>.<qué pasó>` — `telegram.handled`, `generate.excepcion` |
| `level` | `info` normal · `warn` algo raro · `error` una excepción |
| `requestId` | **El que lo une todo.** Mismo valor en logs y en tres tablas |
| `durationMs` | Cuánto tardó. Está en toda línea de cierre |

Los campos sensibles salen como `[redactado]`. Si ves un dato de salud o un
token en un log, eso es un incidente: `log-event.ts` lo redacta por nombre de
campo, así que significa que el campo se llama de otra forma.

**Buscar un `request_id`** en el panel de Supabase → **Logs → Edge Functions**.
Ojo: esa consulta corre contra `edge_logs`, que vive en el explorador de logs,
**no** en la base de la app. Todas las demás de este documento sí van contra la
base.

```sql
select timestamp, event_message
from edge_logs
where event_message like '%3f2504e0-4f89-41d3-9a0c-0305e82c3301%'
order by timestamp asc;
```

Una pulsación de «Generar» devuelve las líneas de **las dos funciones**,
`telegram-webhook` y `generate-version`, en orden.

---

## 1. «El cliente dice que no le llegó la rutina»

**Primero: ¿en qué estado está?** Eso solo lo dice la base.

```sql
select v.id, v.version_number, v.state, v.sent_at, c.full_name, c.linked_at
from workout_versions v
join workout_plans p on p.id = v.plan_id
join clients c on c.id = p.client_id
where c.full_name ilike '%carlos%'
order by v.created_at desc
limit 5;
```

| Lo que ves | Qué pasa | Qué hacer |
|---|---|---|
| `state = SENT`, `sent_at` con fecha | Salió del sistema | El problema está en Telegram, no aquí → §4 |
| `state = APPROVED` | Aprobada pero no entregada | `c.linked_at` es `null`: **el cliente nunca abrió su enlace** |
| `state = DRAFT` | Esperando al entrenador | No es un fallo: falta que él la apruebe |
| `state = NEW` | Sin contenido | La generación no terminó → §2 |
| `state = GENERATING` | Colgada | La generación se murió a medias → §2 |

**Si hace falta el detalle**, el `request_id` sale de aquí:

```sql
select event_type, from_state, to_state, actor, request_id, created_at
from plan_events
where version_id = '<el id de arriba>'
order by created_at asc;
```

Esa columna cuenta la historia entera de la rutina: quién la movió, cuándo, y
con qué petición. Con el `request_id` de la fila que te interesa, vuelve a
«Cómo se lee un log».

---

## 2. «La generación con IA no responde»

```sql
select id, status, failure_reason, tokens_in, tokens_out,
       latency_ms, request_id, created_at, finished_at
from ai_generations
order by created_at desc
limit 10;
```

| `status` | Qué significa |
|---|---|
| `SUCCEEDED` | Fue bien. Si la rutina no aparece, el problema es posterior |
| `FAILED` | `failure_reason` lo dice. La versión se queda en `NEW` a propósito |
| `GENERATING` sin `finished_at` | **Se murió a medias.** Busca su `request_id` en los logs |

Una fila `GENERATING` de hace rato es el caso que la línea `generate.excepcion`
existe para explicar. Si no hay ninguna línea con ese `request_id`, la función
ni siquiera arrancó: mira las variables de entorno.

**Si no hay ninguna fila reciente**, la generación nunca se disparó. Busca en
los logs de `telegram-webhook`:

```
generation.trigger_rejected   → generate-version contestó un error
generation.trigger_failed     → la petición ni salió (red, URL mal)
```

**El límite de cuota no es un fallo.** Es una ventana de tiempo (ADR-005): si
se agotó, la versión se queda en `NEW` y el entrenador puede usar una
plantilla o escribirla a mano. El sistema funciona completo sin IA.

### Si fallan TODAS, no una

Un fallo aislado es el proveedor teniendo un mal día. Que fallen todas apunta a
configuración, y `failure_reason` dice cuál:

| Lo que dice | Qué pasó | Arreglo |
|---|---|---|
| `…el modelo «X» no existe…` | Ese nombre se retiró, o la clave no lo tiene | `supabase secrets set AI_MODEL='…'` |
| `…GEMINI_API_KEY no es válida…` | Clave mal copiada, caducada o sin permiso | Regenerarla en Google AI Studio |
| `RATE_LIMITED` en todas | Cuota agotada, o `AI_MAX_CALLS` muy bajo | Esperar la ventana, o subir el límite |
| `INVALID_OUTPUT` en todas | El modelo no está devolviendo el JSON pedido | Probar otro `AI_MODEL` |

Los cuatro se corrigen con `supabase secrets set`, **sin desplegar**: el cambio
entra en la siguiente invocación.

Para ver qué modelos acepta la clave que tienes puesta:

```bash
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
  'https://generativelanguage.googleapis.com/v1beta/models' \
  | grep -o '"name": "models/[^"]*"'
```

Sirve cualquiera que liste `generateContent` entre sus métodos.

---

## 3. «El bot no contesta a nadie»

```sql
select source, external_id, request_id, processed_at, created_at
from webhook_events
where source = 'telegram'
order by created_at desc
limit 20;
```

| Lo que ves | Dónde está el corte |
|---|---|
| No hay filas recientes | **Telegram no está llegando.** El webhook no está registrado, o el secreto no coincide |
| Filas con `processed_at` en `null` | Llega y se rompe al procesar → busca su `request_id` |
| Filas normales | El bot procesa; lo que falla es el envío de vuelta → §4 |

Si no llegan filas, comprueba el webhook contra Telegram:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`last_error_message` suele decirlo todo. Un `401` ahí significa que
`TELEGRAM_WEBHOOK_SECRET` no es el mismo que se registró.

---

## 4. Cuando el corte está en Telegram, no en el sistema

Los envíos salientes se loguean desde `_shared/telegram/client.ts`. Búscalos
por el `request_id` de la petición que los originó.

| Síntoma | Causa habitual |
|---|---|
| El entrenador recibe, el cliente no | El cliente nunca pulsó su enlace: `clients.linked_at` es `null` |
| Nadie recibe nada | `TELEGRAM_BOT_TOKEN` mal, o el bot bloqueado |
| Llega el texto sin botones | Un `callback_data` pasado de 64 bytes |

---

## Lo que NO hay que hacer

- **No busques por nombre de cliente en los logs.** No está: es un dato
  personal y no se loguea. Se busca por `request_id`.
- **No cambies una migración para arreglar datos.** Son inmutables
  (SPEC-000 regla 8). Un arreglo va en una migración nueva.
- **No reintentes una generación borrando filas de `ai_generations`.** Es el
  registro de lo que pasó. Para reintentar, la versión vuelve a `NEW`.
