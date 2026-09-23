# SPEC-025 — Videos del cliente para corregir técnica

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-005, SPEC-006, SPEC-009 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que el cliente mande un video haciendo un ejercicio y el entrenador lo vea y
le conteste, sin salir de Telegram.

## 2. Por qué esta y no otra

De todo lo que quedó en el backlog, esta es la única que **hace el producto
suyo**.

> La rutina la genera cualquiera. Mirar una sentadilla en video y decir «te
> falta profundidad, baja hasta aquí» es él.

Y encima es barata, que es lo raro: **Telegram ya guarda y sirve el video.**
El bot recibe un `file_id`, y con ese identificador el archivo se reenvía o se
ve. No hay que almacenar ni servir nada, ni pagar por ello.

## 3. La decisión de diseño

### 3.1 Solo el `file_id`, nunca el archivo

```
Cliente manda video ──► Telegram lo guarda ──► el bot recibe un file_id
                                                      │
                                              se guarda ESO
                                                      │
                            el entrenador lo abre y Telegram lo sirve
```

Guardar el archivo significaría almacenamiento, cuota, backups, borrado y
—sobre todo— **tener video de gente en un bucket propio**. Todo eso a cambio
de nada: Telegram ya lo hace.

**El precio, dicho claro:** un `file_id` no es eterno. Si Telegram lo purga o
el cliente borra el mensaje, el video deja de verse. Para corregir técnica
—que se mira en días, no en años— es el intercambio correcto.

### 3.2 Se responde citando el video

El entrenador contesta con la función de **responder** de Telegram sobre el
video. Nada de comandos ni de elegir de una lista: el hilo ya es la interfaz,
y construir otra encima sería peor.

### 3.3 No lo mira la IA

Ni analizar la técnica, ni «detectar» nada. Es criterio del entrenador, es
información de salud, y una IA equivocándose sobre la forma de una sentadilla
con carga puede lesionar a alguien.

Esto no es una limitación temporal: es **el primer principio del proyecto**
aplicado al caso donde más importa.

## 4. Alcance

**Incluye:**
- El cliente manda un video al bot; se guarda y se avisa al entrenador
- Un texto opcional junto al video («esta es la de ayer, me duele aquí»)
- El entrenador lo recibe con el nombre del cliente y responde por el hilo
- `/videos`, para ver los que están sin contestar

**No incluye:**
- Análisis automático (§3.3)
- Almacenamiento propio (§3.1)
- Video del entrenador hacia el cliente. Puede mandarlo por el chat sin que el
  sistema se entere, y está bien así
- Asociar el video a un ejercicio concreto de la rutina. Pedirlo obligaría a
  elegir de una lista antes de grabar, y ahí es donde se abandona

## 5. Contratos

### Entrada

Un mensaje de Telegram del cliente con `video` o `video_note` (los redondos).
El `caption` es opcional.

### Lo que se guarda

```sql
create table client_videos (
  id            uuid        primary key default gen_random_uuid(),
  client_id     uuid        not null references clients (id) on delete cascade,
  version_id    uuid        references workout_versions (id) on delete set null,
  file_id       text        not null,
  caption       text,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);
```

`version_id` es la rutina vigente en ese momento: sirve para saber **qué
estaba entrenando** cuando lo grabó, sin pedírselo.

### Lo que ve el entrenador

```
🎥 Carlos Pérez — video nuevo
«Esta es la sentadilla de hoy, siento la rodilla rara»

Rutina v2 · semana 3
```

Con el video adjunto. Responde en el hilo, y esa respuesta le llega al cliente.

## 6. Reglas de negocio

1. Solo un **cliente vinculado** puede mandar video. De cualquier otro, se
   ignora sin tocar la base.
2. El video se asocia a su **rutina vigente** (`SENT` más reciente), o a
   ninguna si todavía no tiene.
3. **El entrenador recibe el aviso al momento.** No espera al check-in: un
   dolor descrito en un video es de las cosas que no esperan.
4. Un video **no cambia ningún estado**. No es un check-in, no es una
   solicitud de cambio, no crea una versión.
5. `answered_at` se marca cuando el entrenador responde en ese hilo.
6. Un cliente `PAUSED` o `ENDED` (SPEC-024) **puede seguir mandando video**, y
   el entrenador lo recibe igual. Dejar de escribirle no es dejar de
   escucharle.
7. Máximo **5 videos sin contestar** por cliente. Al sexto se le dice que su
   entrenador todavía no ha visto los anteriores. Es lo que evita que el bot
   se convierta en un buzón de treinta videos sin mirar.
8. **El `caption` se acota y se escapa** como cualquier texto libre.

## 7. Estados

**Ninguno.** No toca `version_state` ni `checkins.state`. Tabla propia, con su
`answered_at`.

## 8. Errores

| Situación | Respuesta |
|---|---|
| Lo manda alguien sin vincular | Se ignora, sin tocar la base |
| Lo manda el entrenador | Se ignora: este camino es del cliente |
| Sexto video sin contestar | «Tu entrenador aún no ha visto los anteriores» |
| El cliente no tiene rutina todavía | Se guarda igual, con `version_id` nulo |
| Telegram ya no sirve el `file_id` | Se dice que el video expiró, y se pide de nuevo |

## 9. Seguridad

> **Un video de alguien entrenando es un dato personal, y el `caption` puede
> traer información de salud.**

- El `caption` **nunca se loguea**, igual que las molestias del check-in.
- El `file_id` tampoco: quien lo tenga puede descargar el archivo.
- Solo el entrenador **de ese cliente** recibe el aviso y puede verlo.
- Nada de esto pasa por la IA (§3.3).
- No se guarda el archivo: **si esta base se filtrara, no habría ni un video
  dentro.** Es la ventaja de §3.1 que no se ve al principio.

## 10. Criterios de aceptación

- **CA-1** — DADO un cliente vinculado, CUANDO manda un video, ENTONCES se
  guarda con su `file_id` y el entrenador recibe el aviso al momento.
- **CA-2** — DADO un video con `caption`, CUANDO se guarda, ENTONCES el texto
  aparece en el aviso y **no aparece en ningún log**.
- **CA-3** — DADO un cliente con rutina en `SENT`, CUANDO manda un video,
  ENTONCES queda asociado a esa versión.
- **CA-4** — DADO un cliente sin rutina, CUANDO manda un video, ENTONCES se
  guarda con `version_id` nulo, sin error.
- **CA-5** — DADO alguien sin vincular, CUANDO manda un video, ENTONCES se
  ignora **sin ninguna escritura**.
- **CA-6** — DADO 5 videos sin contestar, CUANDO manda el sexto, ENTONCES se
  le avisa y no se guarda.
- **CA-7** — DADO un cliente `ENDED`, CUANDO manda un video, ENTONCES llega
  igual (regla 6).
- **CA-8** — DADO que el entrenador responde en el hilo, CUANDO se procesa,
  ENTONCES `answered_at` queda puesto.
- **CA-9** — DADO un video, CUANDO se guarda, ENTONCES **ningún
  `version_state` cambia**.

## 11. Tests

| Nivel | Caso |
|---|---|
| Unit | Reconocer `video` y `video_note` en el update |
| Unit | El tope de 5 sin contestar |
| Unit | Formateo del aviso, con y sin `caption` |
| Unit | Un video de alguien sin vincular no llama a ningún puerto |
| Integration | Se asocia a la versión vigente, o a ninguna |
| Integration | `answered_at` al responder |
| Security | Ni el `caption` ni el `file_id` salen en los logs |
| E2E | Video del cliente → aviso al entrenador → respuesta → marcado |

## 12. Archivos que toca

```
supabase/migrations/00XX_client_videos.sql        la tabla
supabase/functions/_core/telegram/update.ts       reconocer el video
supabase/functions/_core/videos/                  el flujo (nuevo)
supabase/functions/_core/ports/video-ports.ts     los puertos (nuevo)
supabase/functions/_shared/db.ts                  el adaptador
```

## 13. Lo que hay que decidir antes

1. **¿El tope de 5 es el correcto?** Salió de una conversación, no de datos.
2. **¿El entrenador quiere `/videos`**, o le basta con el aviso del momento?
3. **¿Qué pasa si el video expira?** Hoy se propone avisar y pedirlo de nuevo.
   La alternativa —guardar el archivo— cambia toda la §3.1 y la §9.
