# SPEC-024 — El cliente que se va

| Campo | Valor |
|---|---|
| **Estado** | APROBADA — aprobada por Ana el 30/09/2026, pendiente de implementar |
| **Depende de** | SPEC-006, SPEC-007 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que un cliente que deja de entrenar **deje de recibir mensajes**, y que el
entrenador vea su cartera sin los que ya no están.

## 2. El problema

La tabla `clients` guarda nombre, email, token de vinculación… y **ningún
estado**. Un cliente, una vez creado, es cliente para siempre.

El check-in semanal le llega a todo cliente con un plan en `SENT`. Un plan
enviado se queda enviado. Entonces:

```
Marzo    el cliente deja de entrenar
         ↓
         su rutina sigue en SENT
         ↓
Cada     «📊 Check-in semanal — semana 47»
lunes    «📊 Check-in semanal — semana 48»
         …para siempre
```

Tres consecuencias, y ninguna es cosmética:

| | |
|---|---|
| **Al cliente** | Mensajes semanales de un servicio que ya no usa |
| **Al entrenador** | `/clientes` y `/checkins` llenos de gente que se fue |
| **Al sistema** | Las señales de SPEC-021 contaminadas: «no está contestando» de alguien que se dio de baja hace cuatro meses |

Es el tipo de fallo que no se ve hasta el mes dos, y que para entonces ya
mandó veinte mensajes.

## 3. La decisión de diseño

### 3.1 Estado del cliente, no de la rutina

La tentación es cambiar la rutina a un estado nuevo. No: **la rutina se
entregó de verdad y eso es un hecho histórico.** `SENT` es terminal y así debe
seguir (SPEC-000).

Quien cambia es el cliente. El estado va en `clients`.

### 3.2 Tres estados, y ninguno destruye nada

```
ACTIVE  ──pausar──►  PAUSED  ──reanudar──►  ACTIVE
   │                    │
   └──────terminar──────┴──►  ENDED
```

| Estado | Qué significa | Check-ins |
|---|---|---|
| `ACTIVE` | Entrenando. Es el de siempre | ✅ |
| `PAUSED` | Lesión, viaje, vacaciones. Vuelve | ❌ |
| `ENDED` | Se fue | ❌ |

**Nada se borra.** El histórico, las rutinas y los check-ins se quedan: son lo
que el entrenador necesita si esa persona vuelve dentro de un año, y borrarlos
sería tirar el trabajo hecho.

`ENDED` no es irreversible —la gente vuelve— pero reactivar es una acción
explícita, no un efecto de que llegue un mensaje.

### 3.3 Es una decisión del entrenador, siempre

**Nada marca a un cliente por su cuenta.** Ni tres check-ins sin responder, ni
dos meses de silencio. El sistema **avisa** —esa es la señal
`NOT_ANSWERING` de SPEC-021— y Carlos decide.

Dar de baja a alguien automáticamente es el sistema decidiendo sobre una
relación comercial que no conoce.

## 4. Alcance

**Incluye:**
- `status` en `clients`, con sus tres valores
- `/pausar <nombre>`, `/reanudar <nombre>`, `/terminar <nombre>`
- El check-in salta a quien no esté `ACTIVE`
- `/clientes` muestra solo los activos, con un pie que cuenta los demás

**No incluye:**
- Marcar a nadie automáticamente (§3.3)
- Borrar datos. Nunca
- Facturación, cobros ni fechas de renovación
- Motivo de la baja. Si hace falta, cabe en las notas

## 5. Contratos

### Tipos

```sql
create type client_status as enum ('ACTIVE', 'PAUSED', 'ENDED');

alter table clients
  add column status      client_status not null default 'ACTIVE',
  add column status_at   timestamptz   not null default now();
```

### Comandos

| Comando | Efecto |
|---|---|
| `/pausar Carlos` | `ACTIVE → PAUSED` |
| `/reanudar Carlos` | `PAUSED → ACTIVE`, o `ENDED → ACTIVE` |
| `/terminar Carlos` | `ACTIVE → ENDED`, o `PAUSED → ENDED` |

Los tres buscan por nombre parcial, reutilizando `matchClientName` de
SPEC-007: una sola forma de nombrar a un cliente en todo el bot.

### La vista del entrenador

```
👥 Tus clientes (4 activos)

• Carlos Pérez — v2, semana 3
• Ana Gómez — v1, semana 1
• …

⏸️ 1 en pausa · ✅ 2 terminados
```

El pie **siempre aparece si hay alguno**. Esconderlos del todo haría que
«¿dónde está Marta?» no tuviera respuesta dentro del bot.

## 6. Reglas de negocio

1. Un cliente nace `ACTIVE`. La migración pone `ACTIVE` a todos los que ya
   existen.
2. **Solo reciben check-in los clientes `ACTIVE`** con un plan en `SENT`. La
   condición se suma a la de SPEC-006 regla 1.
3. Los tres comandos son **exclusivos del entrenador**, y **solo sobre sus
   clientes** (SPEC-013).
4. Repetir el estado actual no es un error: se responde que ya estaba así.
5. **No se borra nada, nunca.** Rutinas, check-ins y solicitudes se quedan.
6. Un cliente `PAUSED` o `ENDED` **sigue pudiendo abrir su rutina** con
   `/mirutina` (SPEC-023). Se le dejó de escribir; no se le echó.
7. `status_at` registra cuándo cambió. Es lo que permite decir «en pausa desde
   hace 3 semanas» sin mirar los logs.
8. **Ningún cambio de estado del cliente toca `version_state`.** Son dos
   máquinas distintas y no se hablan (§3.1).

## 7. Estados

No toca `version_state`. Máquina propia, en `clients.status`.

## 8. Errores

| Situación | Respuesta |
|---|---|
| Nombre que no existe | «No encuentro a nadie con ese nombre» |
| Nombre ambiguo | La lista de coincidencias, igual que `/cliente` |
| Cliente de otro entrenador | **Igual que si no existiera** |
| Ya estaba en ese estado | «Carlos ya estaba en pausa» |
| Lo envía un cliente | `/ayuda`, sin tocar la base |

## 9. Seguridad

- Comandos solo del entrenador, verificado antes de consultar nada.
- La consulta filtra por `trainer_id`: pausar al cliente de otro es imposible.
- Sin borrado: nada de esto destruye datos, así que un comando equivocado se
  deshace con el contrario.

## 10. Criterios de aceptación

- **CA-1** — DADO un cliente `ACTIVE`, CUANDO el entrenador envía
  `/pausar Carlos`, ENTONCES queda `PAUSED` y se confirma.
- **CA-2** — DADO un cliente `PAUSED` con plan en `SENT`, CUANDO corre el
  check-in semanal, ENTONCES **no recibe nada**.
- **CA-3** — DADO un cliente `ENDED`, CUANDO corre el check-in, ENTONCES
  tampoco.
- **CA-4** — DADO un cliente `PAUSED`, CUANDO se reanuda, ENTONCES vuelve a
  `ACTIVE` y el siguiente lunes recibe su check-in.
- **CA-5** — DADO un cliente `ENDED`, CUANDO envía `/mirutina`, ENTONCES
  **la recibe igual** (regla 6).
- **CA-6** — DADO un cliente ya `PAUSED`, CUANDO se pausa otra vez, ENTONCES
  se dice que ya estaba, sin error.
- **CA-7** — DADO el cliente de otro entrenador, CUANDO se intenta pausar,
  ENTONCES se responde como si no existiera y **no se filtra ni el nombre**.
- **CA-8** — DADO que se pausa a un cliente, CUANDO se mira su rutina,
  ENTONCES sigue en `SENT`: el estado de la versión **no cambió**.
- **CA-9** — DADO 4 activos, 1 en pausa y 2 terminados, CUANDO se envía
  `/clientes`, ENTONCES salen los 4 y un pie con los otros 3.

## 11. Tests

| Nivel | Caso |
|---|---|
| Unit | Las transiciones válidas y las repetidas |
| Unit | `shouldSendCheckin` excluye a quien no está `ACTIVE` |
| Unit | Formateo de `/clientes` con y sin inactivos |
| Integration | La migración pone `ACTIVE` a los que ya existían |
| Integration | Pausar el cliente de otro entrenador no cambia nada (CA-7) |
| Integration | Pausar no toca `version_state` (CA-8) |
| E2E | Pausar → el lunes no llega nada → reanudar → llega |

## 12. Archivos que toca

```
supabase/migrations/00XX_client_status.sql     el enum y la columna
supabase/functions/_core/domain/client.ts      las transiciones (nuevo)
supabase/functions/_core/commands/router.ts    los tres comandos
supabase/functions/_core/checkin/schedule.ts   la condición de envío
supabase/functions/_core/commands/format.ts    el pie de /clientes
docs/specs/SPEC-006-checkin-semanal.md         regla 1 gana la condición
docs/specs/SPEC-007-comandos-telegram.md       + los tres comandos
```
