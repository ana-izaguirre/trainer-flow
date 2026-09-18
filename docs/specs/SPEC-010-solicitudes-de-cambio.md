# SPEC-010 — Solicitudes de cambio del cliente

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-005, SPEC-008 |
| **Sesiones** | S-22, S-23 |

## Resultado

| Pieza | Estado |
|---|---|
| Los siete motivos y su callback | ✅ 17 tests |
| Los cuatro flujos (aceptar, pedir, comentar, revisar) | ✅ 33 tests |
| El enrutado, con cuatro prefijos por el mismo canal | ✅ 9 tests |
| Las consultas y el UNIQUE parcial | ✅ 20 tests de integración |

## 1. Objetivo

Tras recibir su rutina, el cliente puede aceptarla o pedir cambios. El
entrenador ve la solicitud y produce una versión nueva, **sin tocar la anterior**.

## 2. Alcance

**Incluye:** botones de aceptar y pedir cambio, motivos estructurados, aviso al
entrenador, creación de la versión de revisión, resolución de la solicitud.

**No incluye:** que el cliente edite la rutina. Nunca (§8).

## 3. Contratos

### Mensaje al cliente tras recibir la rutina

```
¿Cómo te parece esta rutina?

[👍 Me sirve]   [✏️ Pedir un cambio]
```

Al pulsar "Pedir un cambio":

```
¿Qué quieres ajustar?

[😰 Muy difícil]      [😴 Muy fácil]
[⏱️ Muy larga]        [🏋️ Sin equipo]
[😖 Ejercicio incómodo] [🔄 Quiero variedad]
[✍️ Otro]

Puedes añadir un comentario después.
```

El `callback_data` de cada motivo es `chg:<reason>:<versionId>`. Prefijo
propio, como `tpl:`: no es una acción sobre la versión, es el motivo elegido.
El más largo, `chg:uncomfortable_exercise:<uuid>`, ocupa **63 de los 64**.
Va justo, así que hay un test que mide los siete contra el límite: un motivo
nuevo con nombre largo se vería ahí y no en un botón muerto en producción.

### El comentario compite con el check-in

Los dos piden texto libre al cliente, y llegan por el mismo canal. **Gana lo
que se le preguntó más tarde**: se compara `change_requests.created_at` con el
`sent_at` del check-in abierto, y el texto va al más reciente.

Es determinista y no depende de ventanas de tiempo. Y es lo que espera
cualquiera: uno contesta a la última pregunta que le hicieron.

### Vista del entrenador

```
🔔 Carlos pidió un cambio

Rutina v1 · enviada hace 9 días
Motivo: 😰 Muy difícil
Comentario: "No termino la semana 1"

[✏️ Crear v2]
```

**Sin botón de responder en V1.** Contestar por chat necesita un canal
entrenador → cliente que hoy no existe, y abrirlo es una funcionalidad, no un
botón. Queda en el backlog: mientras tanto, la respuesta es la v2.

Pulsar «Crear v2» crea la versión nueva en `NEW` y **muestra los mismos tres
botones de SPEC-008** —IA, plantilla, a mano—. No hay un camino especial para
una revisión: es el mismo que para la primera rutina.

## 4. Reglas de negocio

1. **El cliente nunca edita la rutina.** Solo inserta una solicitud.
2. Solo se puede pedir un cambio sobre una versión en `SENT` que sea del propio
   cliente.
3. **La solicitud NO crea una versión.** La versión se crea cuando el entrenador
   empieza la revisión (§8).
4. **La versión anterior permanece intacta:** ni su contenido, ni su estado, ni
   su `sent_at` cambian.
5. El comentario es opcional, máximo 500 caracteres.
6. **Una sola solicitud abierta por versión, garantizado por un índice único
   parcial.** No por una comprobación previa: dos pulsaciones simultáneas la
   pasarían las dos. Otra sobre la misma versión actualiza el motivo en vez de
   duplicar.
7. Al enviar la versión nueva, la solicitud pasa a `RESOLVED` y guarda
   `resolved_by_version_id`.
8. "Me sirve" registra un evento en `plan_events`. **No cambia de estado**:
   `SENT` ya es terminal.
9. El entrenador puede crear la versión nueva por IA, plantilla o manual: el
   mismo camino de SPEC-008.
10. **El mensaje de la rutina lleva los dos botones.** Sin ellos, «pedir un
    cambio» sería un botón que el cliente nunca ve, y la spec entera no
    existiría en la práctica.
11. **Un texto libre del cliente va a lo último que se le preguntó.** Si tiene
    una solicitud esperando comentario y un check-in esperando molestia, gana
    la más reciente de las dos.
12. **La solicitud se resuelve al ENVIAR la v2, no al crearla.** Si se
    resolviera al crearla, una revisión abandonada dejaría al cliente sin
    respuesta y sin solicitud abierta que lo recordara.

## 5. Estados

**No añade estados.** Es el punto clave de este diseño:

```
v1 en SENT
  │  solicitud → INSERT change_requests (OPEN)
  │  v1 SIGUE EN SENT, sin tocar ✅
  ▼
el entrenador empieza la revisión
  ▼
create_workout_version() → v2 en NEW o DRAFT
  ▼
v2: DRAFT → APPROVED → SENT
  ├─ workout_plans.current_version_id → v2
  └─ change_requests → RESOLVED
```

## 6. Errores

| Situación | Efecto |
|---|---|
| Solicitud sobre una versión que no es `SENT` | Denegada |
| Solicitud sobre la versión de otro cliente | Denegada, mensaje neutro |
| Segunda solicitud sobre la misma versión | Actualiza la abierta, no duplica |
| Comentario > 500 caracteres | Truncado con aviso |
| El entrenador no atiende en 7 días | Recordatorio, una sola vez |
| Gemini falla al crear v2 | v2 vuelve a `NEW`; plantilla o manual |

## 7. Seguridad

- `canRequestChange` verifica que la versión pertenece al cliente **y** está en
  `SENT`, contra la identidad resuelta del webhook.
- El `versionId` del `callback_data` se valida como UUID y por pertenencia.
- El comentario es texto libre del cliente: puede contener información de salud.
  **Nunca se loguea.** Se muestra al entrenador porque lo necesita.
- Un cliente nunca puede hacer `UPDATE` sobre `workout_versions`.

## 8. Criterios de aceptación

- **CA-1** — DADO v1 en `SENT`, CUANDO el cliente pide un cambio, ENTONCES se
  crea un `change_request` en `OPEN` y **v1 no cambia en nada**.
- **CA-2** — DADO una solicitud abierta, CUANDO el entrenador crea la revisión,
  ENTONCES se crea v2 y `current_version_id` apunta a v2.
- **CA-3** — DADO que v2 se envía, CUANDO se completa, ENTONCES la solicitud
  pasa a `RESOLVED` con `resolved_by_version_id = v2`.
- **CA-4** — DADO v2 enviada, CUANDO se consulta v1, ENTONCES conserva su
  contenido original, su estado `SENT` y su `sent_at`.
- **CA-5** — DADO un cliente, CUANDO intenta modificar una versión directamente,
  ENTONCES se deniega.
- **CA-6** — DADO una versión en `DRAFT`, CUANDO se intenta pedir un cambio,
  ENTONCES se deniega.
- **CA-7** — DADO el cliente A, CUANDO pide un cambio sobre la versión del
  cliente B, ENTONCES se deniega con mensaje neutro.
- **CA-8** — DADO dos solicitudes sobre la misma versión, CUANDO llega la
  segunda, ENTONCES hay **una sola** fila en `OPEN`.
- **CA-9** — DADO "Me sirve", CUANDO se pulsa, ENTONCES se registra el evento y
  el estado sigue en `SENT`.
- **CA-10** — DADO que el cliente recibe su rutina, CUANDO llega, ENTONCES el
  mensaje trae los dos botones.
- **CA-11** — DADO un cliente con solicitud y check-in abiertos, CUANDO escribe,
  ENTONCES el texto va al más reciente de los dos.
- **CA-12** — DADO una solicitud abierta, CUANDO el entrenador pulsa «Crear v2»,
  ENTONCES la solicitud **sigue OPEN** hasta que la v2 se envíe.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `canRequestChange`: `SENT` propia sí; `DRAFT` no; ajena no |
| Unit | `parseChangeReason` para los 7 motivos y uno desconocido |
| Integration | CA-1 a CA-8 |
| **E2E-4** | Ciclo completo, aserverando que v1 queda byte a byte igual |

## 10. Archivos

```
supabase/functions/_core/domain/change-request.ts
supabase/functions/_core/domain/change-request.test.ts
supabase/functions/telegram-webhook/handlers/change-request.ts
```
