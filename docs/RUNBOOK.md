# RUNBOOK — cuando algo no funciona

> **La base es el índice. Los logs son el detalle.**
>
> Nunca se empieza buscando en los logs: se empieza por una persona o una
> rutina, se saca el `request_id` de la base, y con él se leen los logs.

## Por dónde empezar

¿Qué dijo Carlos, o qué viste? Busca la frase que más se parezca — cada una
tiene su arreglo abajo, en **§1**:

| Lo que se ve o se dice | Entrada en §1 |
|---|---|
| «Aprobé / rechacé / generé y no pasó nada» | 1.1 |
| «Rechacé (o aprobé, o generé) y ya no puedo hacer nada con ese cliente» | 1.2 |
| «Veo al mismo cliente varias veces» | 1.3 |
| «`/cliente` no hace nada» | 1.4 |
| «`/crear_rutina` dice que no hay ningún borrador abierto» | 1.5 |
| La IA generó algo con menos días, o que se ve mal | 1.6 |
| Nada de lo de arriba — hace falta diagnosticar | §2 (IA) · §3 (entrega) · §4 (bot mudo) |

---

## 1. Los errores más comunes

Ordenados por cuántas veces aparecieron en uso real, no por gravedad técnica.
Si el que buscas no está aquí, salta a §2–§4.

### 1.1 — Aprobar / Rechazar / Generar no hacía nada

**Arreglado (PR #57, #58).** La causa: el mensaje de confirmación llevaba un
nombre con un caracter que Telegram no acepta sin escapar (un guion, un
punto, un paréntesis), y Telegram descarta el mensaje **entero**, no solo el
caracter. La transición sí ocurría en la base; lo único que fallaba era
avisarlo — por eso el botón "no hacía nada" cuando en realidad sí había
hecho su trabajo.

**Cómo confirmarlo si vuelve a pasar** con un cliente nuevo (sería la misma
familia de bug en un mensaje que todavía no se cubrió):

```sql
select v.id, v.state, v.updated_at, c.full_name
from workout_versions v
join workout_plans p on p.id = v.plan_id
join clients c on c.id = p.client_id
where c.full_name ilike '%<nombre>%'
order by v.updated_at desc limit 3;
```

Si `state` ya cambió al que esperabas, el botón funcionó: el problema es
solo el aviso, y quien lo reciba puede seguir con normalidad. Repórtalo con
el nombre exacto del cliente — el caracter que lo rompe está ahí.

### 1.2 — Rechazar (o aprobar, o generar) dejaba al cliente sin salida

**Arreglado (S-49).** Antes de este cambio, una vez que la tarjeta original
se perdía en el chat, los estados `REJECTED`, `SENT` y `APPROVED` no tenían
**ningún** botón de vuelta — ni el propio mensaje de rechazo, que decía
«puedes empezar otra», era cierto.

**El arreglo:** `/cliente <nombre>` ahora lleva botones según el estado de
la rutina vigente. Ver `docs/STATE-MACHINE.md` → «Cobertura de salida» para
la tabla completa de qué botón aparece en cada estado, y por qué a propósito
faltan algunos (`APPROVED` no ofrece crear v2; ningún estado ofrece Editar).

**Si el botón sigue sin aparecer:** confirma que `/cliente <nombre>`
realmente encuentra al cliente — si dice «no tengo a nadie con ese nombre»,
el problema es de búsqueda, no de botones (prueba con menos letras).

**Mientras tanto, o si es una `GENERATING` que no arrancó ninguna** de las
dos transiciones automáticas: §2.1 tiene el desatasco manual.

### 1.3 — El mismo cliente aparece varias veces en `/clientes`

**No es un bug.** El sistema nunca fusiona por nombre (SPEC-001 regla 4): si
Tally mandó tres formularios con «Ana Izaguirre», hay tres fichas
independientes. Bórralas a mano en Supabase Studio si fueron pruebas, o
recuérdale al cliente que lo rellene una sola vez.

### 1.4 — `/cliente` a secas no hacía nada útil

**Arreglado (PR #56).** Antes decía «No tengo a nadie con ese nombre», que
suena a que sí buscó y no encontró. Ahora pide el nombre directamente:
`Escribe el nombre: /cliente Carlos.`

### 1.5 — `/crear_rutina` dice que no hay ningún borrador abierto

**No es un bug: es el propósito del comando.** `/crear_rutina` (el editor de
texto) actúa sobre **el borrador que se tocó más recientemente**
(`current_draft_for_trainer`), no sobre un cliente concreto — con dos
clientes a la vez, «el único abierto» bloquearía a los dos. Si no hay ningún
`DRAFT` todavía —porque nadie pulsó IA, plantilla o manual sobre esa
versión— no tiene sobre qué trabajar.

Empieza la rutina desde la tarjeta original o desde `/cliente <nombre>`
(con S-49 ya tiene botones); en cuanto exista un borrador, `/crear_rutina`
funciona.

### 1.6 — La IA generó algo con menos días de los pedidos, o que se ve mal

Primero mira `ai_generations.failure_reason` (consulta en §2). Si dice
`INVALID_OUTPUT`, `validateDraft` ya lo rechazó y la versión volvió a `NEW`:
lo que se vio mal no llegó a enviarse a nadie, hay que reintentar.

Si el borrador **sí** llegó con menos días de los pedidos, es un caso que
`validateDraft` debería haber atrapado y no lo hizo: repórtalo con el
`request_id` de esa generación (§2, luego §5.2 para leer el log completo).
Es un bug real de validación, no una rareza de la IA — no lo trates como
«a veces pasa».

---

## 2. «La generación con IA no responde»

```sql
select id, status, failure_reason, request_id, created_at, finished_at
from ai_generations
order by created_at desc limit 10;
```

| `status` | Qué significa | Qué hacer |
|---|---|---|
| `SUCCEEDED` | Fue bien | Si la rutina no aparece, el problema es posterior → §3 |
| `FAILED` | `failure_reason` dice por qué | La versión ya volvió a `NEW` sola. Si fallan TODAS → §2.2 |
| `GENERATING`, sin `finished_at`, de hace rato | Se murió a medias | → §2.1 |

**Si no hay ninguna fila reciente**, la generación nunca se disparó. Busca
en los logs de `telegram-webhook` (§5.2):

```
generation.trigger_rejected   → generate-version contestó un error
generation.trigger_failed     → la petición ni salió (red, URL mal)
```

**El límite de cuota no es un fallo.** Es una ventana de tiempo (ADR-005):
si se agotó, la versión se queda en `NEW` y el entrenador puede usar una
plantilla o escribirla a mano. El sistema funciona completo sin IA.

### 2.1 — Una `GENERATING` colgada

**Desde S-49 esto se arregla solo.** `sweep-generating` (SPEC-002 §11) corre
cada 5 minutos por `pg_cron` y devuelve a `NEW` toda versión con más de
`GENERATION_STALE_MINUTES` (5 por defecto) atascada, con aviso al
entrenador. Si ves una `GENERATING` de más de 10 minutos, dale un momento al
cron antes de tocar nada a mano.

**Si el cron no está programado todavía** (el paso 8b de `docs/DEPLOY.md`),
o hace falta desatascarla YA:

```sql
update workout_versions
   set state = 'NEW'
 where id = '<version_id>'
   and state = 'GENERATING';
```

El `and state = 'GENERATING'` no es opcional: si la generación en realidad
terminó un segundo antes de este UPDATE, esa condición hace que el UPDATE no
toque nada, en vez de pisar un `DRAFT` recién llegado. Corre la consulta de
arriba otra vez después para confirmar en qué quedó.

**Comprobar que el cron está activo:**
```sql
select
  j.jobname, j.schedule, j.active,
  (select status from cron.job_run_details
    where jobid = j.jobid order by start_time desc limit 1) as last_run_status
from cron.job j
where j.jobname = 'sweep-generating';
```

### 2.2 — Si fallan TODAS, no una

Un fallo aislado es el proveedor teniendo un mal día. Que fallen todas
apunta a configuración, y `failure_reason` dice cuál:

| Lo que dice | Qué pasó | Arreglo |
|---|---|---|
| «el modelo «X» no existe» | Ese nombre se retiró, o la clave no lo tiene | `supabase secrets set AI_MODEL='…'` |
| «GEMINI_API_KEY no es válida» | Clave mal copiada, caducada o sin permiso | Regenerarla en Google AI Studio |
| `RATE_LIMITED` en todas | Cuota agotada, o `AI_MAX_CALLS` muy bajo | Esperar la ventana, o subir el límite |
| `INVALID_OUTPUT` en todas | El modelo no devuelve el JSON pedido | Probar otro `AI_MODEL` |

Los cuatro se corrigen con `supabase secrets set`, **sin desplegar**: el
cambio entra en la siguiente invocación. Para ver qué modelos acepta la
clave puesta:

```bash
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
  'https://generativelanguage.googleapis.com/v1beta/models' \
  | grep -o '"name": "models/[^"]*"'
```

Sirve cualquiera que liste `generateContent` entre sus métodos.

---

## 3. «El cliente dice que no le llegó la rutina»

```sql
select v.id, v.version_number, v.state, v.sent_at, c.full_name, c.linked_at
from workout_versions v
join workout_plans p on p.id = v.plan_id
join clients c on c.id = p.client_id
where c.full_name ilike '%<nombre>%'
order by v.created_at desc limit 5;
```

| Lo que ves | Qué pasa | Qué hacer |
|---|---|---|
| `state = SENT`, `sent_at` con fecha | Salió del sistema | El corte está en Telegram, no aquí → §4.2 |
| `state = APPROVED`, `linked_at` NULL | Esperando a que el cliente abra su enlace | No es un fallo. El enlace: `t.me/<bot>?start=<link_token>`, y `link_token` está en `clients` |
| `state = DRAFT` | Esperando al entrenador | No es un fallo: falta que él la apruebe |
| `state = NEW` o `GENERATING` | Sin contenido todavía | → §2 |
| `state = REJECTED` | Se descartó a propósito | No es un fallo. Si hace falta una v2 → §1.2 |

---

## 4. «El bot no contesta a nadie»

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
| Filas con `processed_at` en `null` | Llega y se rompe al procesar → busca su `request_id`, §5.2 |
| Filas normales | El bot procesa; lo que falla es el envío de vuelta → §4.2 |

Si no llegan filas, comprueba el webhook contra Telegram:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`last_error_message` suele decirlo todo. Un `401` ahí significa que
`TELEGRAM_WEBHOOK_SECRET` no es el mismo que se registró.

### 4.2 — Cuando el corte está en Telegram, no en el sistema

Los envíos salientes se loguean desde `_shared/telegram/client.ts`.
Búscalos por el `request_id` de la petición que los originó (§5.2).

| Síntoma | Causa habitual |
|---|---|
| El entrenador recibe, el cliente no | El cliente nunca pulsó su enlace: `clients.linked_at` es `null` |
| Nadie recibe nada | `TELEGRAM_BOT_TOKEN` mal, o el bot bloqueado |
| Llega el texto sin botones | Un `callback_data` pasado de 64 bytes |

---

## 5. Cómo se lee un log

Solo hace falta esto para el 90% de los casos de arriba. El resto —formato
exacto, redacción de campos sensibles— está en `docs/ARCHITECTURE.md`
(SPEC-012) y no se repite aquí.

**5.1 — El formato.** Una línea, JSON, con el mismo `event: '<función>.<qué
pasó>'` que aparece en las tablas de arriba (`generate.generated`,
`generation.trigger_failed`…):

```json
{"event":"generate.generated","level":"info","requestId":"3f25…","versionId":"a1b2…","durationMs":8412}
```

**5.2 — Buscar por `request_id`.** Panel de Supabase → **Logs → Edge
Functions** (corre contra `edge_logs`, el explorador de logs — no la base de
la app, que es donde van todas las demás consultas de este documento):

```sql
select timestamp, event_message
from edge_logs
where event_message like '%<request_id>%'
order by timestamp asc;
```

Una pulsación de «Generar» deja líneas de **las dos funciones**,
`telegram-webhook` y `generate-version`, en ese orden.

---

## Lo que NO hay que hacer

- **No busques por nombre de cliente en los logs.** No está: es un dato
  personal y no se loguea. Se busca por `request_id`.
- **No cambies una migración para arreglar datos.** Son inmutables
  (SPEC-000 regla 8). Un arreglo va en una migración nueva.
- **No reintentes una generación borrando filas de `ai_generations`.** Es el
  registro de lo que pasó. Para reintentar, la versión vuelve a `NEW`
  (§2.1 si quedó atascada en `GENERATING`; en cualquier otro caso, el propio
  sistema ya la dejó ahí y el botón de reintentar alcanza).
