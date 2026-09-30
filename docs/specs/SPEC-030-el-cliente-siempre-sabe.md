# SPEC-030 — El cliente siempre sabe en qué está su pedido

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** — aprobada por Ana el 26/09/2026 |
| **Depende de** | SPEC-006, SPEC-010, SPEC-023 |
| **Sesiones** | S-43 |

## Resultado

| Regla | Pieza | Estado |
|---|---|---|
| 1, 2 | Una abierta no se pisa; solo avisa quien crea la fila (`created`) | ✅ migración 0027, `flows.ts`, CA-1, CA-2 |
| 4 | El comentario se AÑADE, hasta 500 car., con aviso si se trunca | ✅ `add_change_comment`, CA-4 |
| 5 | `asked_at` decide contra el check-in, y se actualiza al re-preguntar | ✅ |
| 6 | `/cambio_rutina` — los tres casos | ✅ `webhook.ts`, CA-7 |
| 7 | `/rutina` avisa del cambio pendiente antes de la rutina | ✅ CA-6 |
| 8 | Ningún texto suelto se queda sin respuesta | ✅ `SIN_PREGUNTA_PENDIENTE`, CA-8 |
| 12 | `/cambio_rutina` en `AYUDA_CLIENTE` | ✅ |
| 11 | La ficha del entrenador muestra la solicitud abierta (motivo y días, sin el comentario) | ✅ migración 0028, `trainer_client_detail` |
| 14 | `/pendientes` con las dos listas (`DRAFT` y `APPROVED` sin abrir) | ✅ migración 0028, `trainer_awaiting_link` |
| 3 | `force_reply` en cada pregunta de texto libre | ✅ ver nota — 2 de 3 casos |
| 9 | Acuse por botón del check-in (`answerCallback` con texto) | ✅ `formatCheckinAck`, `ButtonReplyOutcome`, CA-9 |
| 10 | Cabecera «actualizada» en la v2 | ✅ migración 0029, `versionNumber`, CA-10 |
| 13 | Aviso de enlace sin abrir 48h | ✅ migración 0030, `sweep-generating`, CA-13 |

**Estado** pasa a **IMPLEMENTADA**: las 14 reglas están hechas.

**1599 unit tests (100% cobertura en `_core`) + 275 integration/E2E + 107 Deno.**

### Regla 13 — sin cron nuevo: el mismo barrido de cada 5 minutos

La regla lo pedía explícito: *"lo revisa el mismo sweep que ya corre cada 5
minutos"* — el de SPEC-002 §11 (`sweep-generating`). **No hace falta ningún
`pg_cron.schedule` nuevo**: el job que ya está programado en producción pasa
a correr las dos comprobaciones en la misma llamada, así que el deploy de
este PR es autosuficiente en ese punto.

Migración 0030: `link_reminder_sent_at` en `workout_versions` (mismo patrón
que `checkins.reminder_sent_at`, migración 0010 — un solo aviso, con
`coalesce` para que una segunda llamada no pise la fecha de la primera),
más `versions_awaiting_link_reminder(p_min_hours)` y `mark_link_reminded`.
`sweepUnopenedLinks` (`_core/delivery/sweep-unopened-links.ts`) sigue el
mismo patrón "enviar, y SOLO ENTONCES marcar" de `checkin/send.ts`: un envío
que falla no marca nada, y el barrido siguiente lo reintenta solo.

El umbral es configurable (`LINK_REMINDER_HOURS`, default 48) igual que
`GENERATION_STALE_MINUTES` — variable de entorno, no secreto.

### Regla 3 — `force_reply`, y por qué el check-in se queda fuera

Resultó más barato de lo que decía la nota original: `TelegramSender.sendMessage`
ganó un cuarto parámetro **opcional** (`forceReply?: boolean`), así que los
~15 archivos con un `sendMessage: (chatId, text, keyboard) => …` a mano
siguen compilando sin tocarlos — TypeScript acepta una implementación con
menos parámetros que la interfaz.

Se aplica a los dos sitios que preguntan texto libre sin ningún teclado de
por medio: el detalle del cambio tras elegir un motivo (incluido «✍️ Otro»,
que hoy comparte el mismo mensaje) y el recordatorio de una solicitud ya
abierta (`estadoAbierto`).

**La molestia del check-in se queda sin `force_reply`, a propósito.** Ese
mensaje YA lleva `inline_keyboard` (las tres filas de botones), y
`reply_markup` de Telegram solo admite un tipo a la vez: ponerle
`force_reply` significaría **quitarle los botones**, que es justo lo
contrario de mejorar la pregunta. El texto ya dice qué hacer («Escríbela o
pulsa el botón»); no hay una versión de este mensaje que gane con el cambio.

### Regla 10 — de dónde salió `versionNumber`

`version_for_delivery` (y las dos que se apoyan en ella, `approved_version_for_client`
y `sent_version_for_profile`) no traía el número de versión: solo hacía falta
para escribirle al cliente, y el cliente nunca lo había visto. La migración
0029 lo suma a las tres, con el `DROP` + `CREATE` que exige cambiar un
`returns table` (`create or replace` no puede).

`formatForClient` decide la cabecera con un solo número: `versionNumber > 1`
→ *"aquí está tu rutina actualizada"*; si no, la de siempre, *"tu rutina está
lista"*. Como `/rutina` (SPEC-023) comparte la misma función de formato, un
cliente que vuelve a pedir su rutina en la v2 también la ve como
"actualizada" — no solo en el momento de la entrega, que es lo consistente:
sigue siendo su v2 se mire cuando se mire.

### Regla 9 — cómo se resolvió el choque con «se responde antes del trabajo»

Se pensó pendiente porque chocaba con una garantía ya probada del webhook: el
`callback_query` se responde **antes** de hacer ningún trabajo, para que
Telegram no deje el botón girando (SPEC-004 regla 2). El acuse con texto solo
se sabe DESPUÉS de guardar la respuesta.

La solución: el check-in es la **única excepción**, detectada por su propio
prefijo (`chk:`) antes de decidir si se responde ya o se difiere. Todo lo
demás sigue exactamente el orden de siempre. Tres salidas cubiertas para que
un botón nunca se quede girando: la respuesta feliz (acuse con texto, tras
guardar), un check-in ajeno o cerrado (blanco, tras el rechazo) y una
identidad que no resuelve (blanco, en el paso 5 — la única salida temprana
entre el diferido y el enrutado).

`handleCheckinAnswer` devuelve un tipo aparte (`ButtonReplyOutcome`) donde
`ack` no es opcional: un botón siempre tiene algo que decir, así que no hay
un `null` que nadie puede alcanzar escondido en el tipo compartido con
`handleCheckinText` (que sí puede ser `null`: un mensaje de texto no tiene
callback al que responder).

## 1. Objetivo

Todo lo que el cliente toca o escribe recibe respuesta, y en cada momento
sabe si tiene un cambio pedido, dónde escribir el detalle y qué va a pasar
después.

## 2. Diagnóstico (probando el bot como cliente)

| # | Lo que pasa | Causa en el código |
|---|---|---|
| 1 | Puede pulsar «Pedir un cambio» y un motivo **muchas veces**; al entrenador le llega un aviso por cada pulsación | `requestChange` no mira si ya hay una solicitud abierta: el `UPSERT` evita la fila duplicada, pero el aviso sale igual |
| 2 | «Anotado… escríbeme el detalle» no dice **dónde** ni **cómo**, y no queda claro que se envió | No hay campo de respuesta; el acuse «Apuntado también» solo sale si el texto se atribuyó a la solicitud |
| 3 | Con **«✍️ Otro»** escribe y **no pasa nada** | Un segundo texto cae en el vacío: `open_change_request_for_client` solo acepta texto si la solicitud **no tiene comentario**. Si ya escribió una vez (o pulsó otro motivo antes), el texto se ignora en silencio |
| 4 | Nada le dice **que espere** a que el entrenador le mande la versión nueva | El texto de confirmación no lo dice |
| 5 | En «Ver mi rutina» sale la anterior como si nada | `/rutina` no sabe que hay un cambio pedido |
| 6 | El menú no tiene «pedir un cambio» | Solo existe como botón debajo de la rutina |
| 7 | En el check-in, al pulsar «3» o «💪 Bien» **no aparece nada** | Solo se contesta al completar las tres preguntas |
| 8 | Un texto que nadie espera **no recibe respuesta** | El webhook no tiene respuesta por defecto para texto de cliente |
| 9 | Un cliente que nunca abre su enlace se queda esperando y **el entrenador no se entera** salvo que entre a mirar la ficha | Nada avisa; solo existe `/reenviar` manual (SPEC-014) |
| 10 | `/pendientes` solo lista `DRAFT`. Una versión `APPROVED` esperando que el cliente abra su enlace **no sale ahí**, solo se ve entrando a la ficha uno por uno | `trainer_pending_versions` filtra `v.state = 'DRAFT'` |

Lo común a los diez: **el silencio.** Esta spec cierra cada uno.

### ¿Debería cambiar el estado de la rutina?

**No, la versión no cambia de estado**, y es a propósito (SPEC-010 §5): la v1
enviada es historia y el cliente sigue entrenando con ella. Lo que tiene
estado es la **solicitud** (`OPEN` → `RESOLVED`). El fallo es que ese estado
existía y **nadie lo mostraba**. Ahora lo ven los dos: el cliente en
`/rutina` y en cada respuesta, y el entrenador en la ficha.

## 3. Alcance

**Incluye:** respuestas y estado visible en el flujo de cambio, `/cambio_rutina` en
el menú, aviso en `/rutina`, acuse en cada botón del check-in, respuesta por
defecto al texto libre, línea de la solicitud en la ficha del entrenador.

**No incluye:** chat libre cliente ↔ entrenador (sigue en el backlog de
SPEC-010); menús de comandos distintos por rol (`setMyCommands` por chat,
backlog).

## 4. Contratos

### Tras elegir un motivo (salvo «Otro»)

```
✅ Listo. Le pasé a tu entrenador que quieres un cambio: 😰 Muy difícil.

Cuando prepare tu nueva versión, te llega aquí mismo. Mientras, sigue con
tu rutina actual.

¿Quieres darle más detalle? Escríbelo en tu próximo mensaje.
```

Con `force_reply` y el texto de ayuda «Escribe el detalle…»: Telegram abre
el teclado con la respuesta ya enlazada, así que queda claro **dónde**
escribir.

### Tras elegir «✍️ Otro»

```
✍️ Cuéntame qué quieres cambiar. Escríbelo en tu próximo mensaje y se lo
paso a tu entrenador.
```

También con `force_reply`. Al entrenador ya le llega el aviso con
`Motivo: ✍️ Otro — esperando el detalle`, para que la solicitud no dependa
de que el cliente escriba.

### Tras escribir el detalle

```
📨 Enviado a tu entrenador. Te aviso aquí cuando tenga tu nueva rutina.
```

### Si ya tiene un cambio pedido y vuelve a pulsar (o usa `/cambio_rutina`)

```
🕐 Ya le pediste un cambio a tu entrenador el 24/09: 😰 Muy difícil.

Está preparando tu nueva versión. Si quieres añadir algo, escríbelo en tu
próximo mensaje.
```

Sin aviso nuevo al entrenador.

### `/rutina` con un cambio pedido

Arriba de la rutina, antes de todo:

```
🛠 Pediste un cambio el 24/09. Tu entrenador lo está preparando; mientras,
esta sigue siendo tu rutina.
```

Se muestra la rutina vigente: **no se oculta**, porque el cliente tiene que
seguir entrenando con algo.

### Texto que nadie espera

```
No tengo ninguna pregunta pendiente contigo 🙂

/rutina — ver tu rutina
/cambio_rutina — pedir un cambio
/checkin — enviar tu check-in
/actualizar_datos — cambiar tus datos
```

### Ficha del entrenador

Una línea más cuando hay una solicitud abierta:

```
🔔 Pidió un cambio hace 2 días: 😰 Muy difícil
```

### `/pendientes`, con sus dos categorías

Hoy solo trae la primera lista. Se agrega la segunda, aparte:

```
📋 Esperando tu decisión

Ana Gómez · v1 · 3 días
[✏️ Revisar]

━━━━━━━━━━━━━━━

🔗 Esperando que abran su enlace

Carlos Pérez · v2 · aprobada hace 3 días
[🔗 Reenviar enlace]
```

Si una lista está vacía, esa sección no aparece. Si las dos lo están:
`👍 No hay nada pendiente.`

## 5. Reglas de negocio

1. **Una solicitud abierta por versión, y un aviso por solicitud.** Si ya
   hay una abierta, pulsar «Pedir un cambio», un motivo o `/cambio_rutina` responde
   con el estado (§4) y **no** avisa al entrenador ni cambia el motivo.
   *Reemplaza la segunda frase de SPEC-010 regla 6.*
2. **Solo avisa quien la crea.** `request_change` pasa a devolver si la
   creó; con dos pulsaciones simultáneas, solo una avisa. El índice único
   parcial se queda como garantía.
3. **Toda pregunta de texto libre usa `force_reply`**: el detalle del cambio,
   «Otro» y la molestia del check-in cuando se escribe.
4. **Todo texto que se atribuye a la solicitud recibe acuse**, y el
   entrenador recibe **ese texto**. Mientras la solicitud esté abierta y sea
   lo último que se le preguntó, cada mensaje **se añade** al comentario (con
   un salto de línea) hasta 500 caracteres. Si se pasa, se guarda hasta el
   límite y se le dice que el resto no entró.
   *Reemplaza la condición «sin comentario» de SPEC-010.*
5. **La pregunta más reciente es la que se hizo último**, no la de la fila más
   nueva: la solicitud guarda `asked_at`, que se actualiza cada vez que se le
   pide texto (§4), y es lo que compite con el check-in (SPEC-010 regla 11).
6. **`/cambio_rutina`** (cliente): sin rutina enviada → «Todavía no tienes una
   rutina…» (SPEC-023); con una solicitud abierta → estado (regla 1); si no
   → el menú de motivos de la versión vigente.
7. **`/rutina` con solicitud abierta** muestra el aviso de §4 antes de la
   rutina.
8. **Ningún mensaje de cliente queda sin respuesta.** Un texto que no es ni
   del check-in ni de la solicitud recibe la ayuda corta de §4.
9. **Cada botón del check-in da acuse** en el propio botón (el aviso
   emergente de `answerCallbackQuery`): «Anotado: 3 sesiones», «Anotado: 💪
   Bien». Si faltan preguntas: «… Falta: ¿alguna molestia?». El mensaje
   `GRACIAS` sigue saliendo al completar las tres.
10. **La v2 llega presentada como tal:** si la versión entregada no es la
    primera, la cabecera dice `👋 Hola Carlos, aquí está tu rutina
    actualizada.`
11. **Ficha del entrenador:** muestra la solicitud abierta (§4). Solo el
    motivo y la fecha: el comentario puede traer datos de salud y la ficha
    se lee de un vistazo; está completo en el aviso.
12. `AYUDA_CLIENTE` añade `/cambio_rutina` y `/checkin` (SPEC-031). `DEPLOY.md` lista
    los comandos para pegar en BotFather (`/setcommands`).
13. **Enlace sin abrir 48 horas.** Si una versión sigue en `APPROVED` sin
    `clientChatId` 48 horas después de aprobarse, el entrenador recibe un
    aviso con el botón `🔗 Reenviar enlace` (SPEC-014). Un solo aviso por
    versión, igual que el recordatorio del check-in (SPEC-006 regla 6): lo
    revisa el mismo `sweep` que ya corre cada 5 minutos.
14. **`/pendientes` trae dos listas**, no una: las `DRAFT` esperando que el
    entrenador decida (como hoy) y las `APPROVED` sin `clientChatId`
    esperando que el cliente abra su enlace, con su propio botón `🔗
    Reenviar enlace`. La segunda es la misma consulta que usa la regla 13
    para decidir a quién avisar, solo que aquí se lista completa y sin
    umbral de 48 horas: son las mismas que ya hoy solo se ven entrando a la
    ficha, y `/pendientes` es donde deberían estar juntas.

## 6. Estados

La versión: **ninguno nuevo**. La solicitud: los mismos (`OPEN`, `RESOLVED`),
con la columna nueva `asked_at`.

## 7. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| Motivo o `/cambio_rutina` con solicitud abierta | Estado de §4 | Nada cambia, no se avisa |
| Detalle que supera 500 caracteres | «Guardé hasta aquí; el resto no entró» | Comentario truncado |
| `/cambio_rutina` de un entrenador | Ayuda del entrenador | Nada |
| Versión ajena en el callback | Mensaje neutro (sin cambios) | Nada |

## 8. Seguridad

- `/cambio_rutina` no recibe ningún id: sale del **perfil** del que escribe, igual
  que `/rutina` (SPEC-023). No hay forma de pedir sobre la rutina de otro.
- El comentario sigue sin loguearse. La ficha no lo muestra (regla 11).
- `force_reply` no cambia nada de autorización: el texto sigue entrando por
  el mismo camino y se atribuye con la identidad resuelta.

## 9. Criterios de aceptación

- **CA-1** — DADO una solicitud abierta, CUANDO el cliente pulsa otro motivo,
  ENTONCES recibe el estado, el motivo guardado no cambia y el entrenador
  **no** recibe ningún aviso.
- **CA-2** — DADO dos pulsaciones simultáneas del mismo motivo, ENTONCES hay
  una fila `OPEN` y **un** aviso al entrenador.
- **CA-3** — DADO «Otro», CUANDO lo pulsa, ENTONCES el mensaje lleva
  `force_reply` y el entrenador recibe «esperando el detalle».
- **CA-4** — DADO una solicitud con comentario, CUANDO el cliente escribe otra
  vez, ENTONCES el texto se añade, recibe «📨 Enviado…» y el entrenador lo
  recibe.
- **CA-5** — DADO una solicitud abierta y un check-in enviado DESPUÉS, CUANDO
  el cliente vuelve a pulsar «Pedir un cambio» y escribe, ENTONCES el texto va
  a la solicitud (regla 5).
- **CA-6** — DADO una solicitud abierta, CUANDO pide `/rutina`, ENTONCES
  recibe el aviso de §4 y la rutina vigente con sus botones.
- **CA-7** — `/cambio_rutina` en sus tres casos (regla 6).
- **CA-8** — DADO un texto sin nada pendiente, ENTONCES recibe la ayuda corta.
- **CA-9** — DADO un botón del check-in, CUANDO lo pulsa, ENTONCES
  `answerCallback` lleva el texto del acuse y, si faltan preguntas, cuál.
- **CA-10** — DADO una v2 entregada, ENTONCES la cabecera dice «actualizada».
- **CA-11** — DADO una solicitud abierta, CUANDO el entrenador abre la ficha,
  ENTONCES ve motivo y fecha, y **no** el comentario.
- **CA-12** — Un cliente no puede llegar con `/cambio_rutina` a una versión ajena.
- **CA-13** — DADO una versión `APPROVED` sin `clientChatId` 48 horas después
  de aprobarse, ENTONCES el entrenador recibe el aviso con `🔗 Reenviar
  enlace`, y **no** un segundo aviso en el siguiente barrido.
- **CA-14** — DADO un `DRAFT` y un `APPROVED` sin abrir, CUANDO el entrenador
  pide `/pendientes`, ENTONCES ve las dos en secciones separadas, cada una
  con su botón. DADO que no hay ninguna de las dos, ENTONCES ve «No hay nada
  pendiente».

## 10. Tests

| Nivel | Caso |
|---|---|
| Unit | CA-1, CA-3, CA-4, CA-6 a CA-11 en `flows.test.ts`, `reply.test.ts`, `webhook.test.ts`, `format.test.ts` |
| Integration | CA-2 (concurrencia), CA-5 (`asked_at`), CA-12 |
| E2E | `change-request.test.ts`: pedir dos veces → un aviso; «Otro» + dos textos → los dos llegan |

## 11. Archivos que toca

```
supabase/migrations/0027_change_request_feedback.sql   asked_at; request_change devuelve created;
                                                       append_change_comment; ficha con la solicitud
supabase/functions/_core/change-request/flows.ts       reglas 1–5, /cambio_rutina
supabase/functions/_core/checkin/reply.ts              acuse por botón
supabase/functions/_core/checkin/format.ts             textos del acuse
supabase/functions/_core/ports/telegram-ports.ts       force_reply; answerCallback(id, text?)
supabase/functions/_core/ports/change-request-ports.ts
supabase/functions/_core/telegram/webhook.ts           /cambio_rutina, texto sin destino
supabase/migrations/0029_version_number_en_entrega.sql  version_number en las tres funciones de entrega
supabase/migrations/0030_link_reminder.sql              link_reminder_sent_at; versions_awaiting_link_reminder; mark_link_reminded
supabase/functions/_core/delivery/sweep-unopened-links.ts  regla 13, nuevo
supabase/functions/_core/ports/link-reminder-ports.ts   nuevo
supabase/functions/_core/creation/quick-create.ts       SPEC-031, no de esta spec pero en el mismo PR
supabase/functions/_core/telegram/client-format.ts     cabecera de v2, aviso de /rutina
supabase/functions/_core/ports/delivery-ports.ts        versionNumber en VersionForDelivery
supabase/functions/_core/commands/router.ts            /rutina con aviso; /pendientes con las dos listas
supabase/functions/_core/commands/format.ts            ficha, AYUDA_CLIENTE, formatPending con dos secciones
supabase/functions/_core/ports/query-ports.ts           AwaitingLink; pendingVersions o awaitingLink(trainerId)
supabase/functions/_shared/telegram/client.ts          reply_markup force_reply; texto del callback
supabase/functions/_shared/db.ts                       createLinkReminderRepo, versionNumber en readDelivery
supabase/functions/sweep-generating/index.ts           corre los dos barridos (regla 13, sin cron nuevo)
docs/specs/SPEC-010 (reglas 6 y 11), docs/DEPLOY.md (comandos de BotFather, paso 8b)
```
