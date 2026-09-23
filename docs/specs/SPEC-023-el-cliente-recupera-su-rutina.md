# SPEC-023 — El cliente recupera su rutina

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-005, SPEC-009 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que el cliente pueda volver a ver su rutina cuando quiera, sin depender de su
historial de Telegram ni de escribirle al entrenador.

## 1.bis El comando es `/rutina`, no `/mirutina`

Esta spec proponía `/mirutina`. **Verlo usar lo desmintió en un día.**

Una clienta recién vinculada escribió `/rutina` —lo natural— y chocó con «eso
solo lo puede consultar tu entrenador», porque SPEC-022 acababa de darle ese
nombre al comando con el que el ENTRENADOR dicta una.

Nadie escribe `/mirutina`. Así que `/rutina` es del cliente y el del
entrenador pasa a `/crear_rutina`.

## 2. El problema

El cliente **no tiene ningún comando**. Solo botones, y los botones viven
pegados a un mensaje concreto.

| Lo que quiere hacer | ¿Puede hoy? |
|---|---|
| Pedir un cambio | ✅ El botón del mensaje de entrega |
| Responder el check-in | ✅ Le llega solo cada lunes |
| **Volver a ver su rutina** | ❌ **Solo subiendo en el historial** |

Si archiva el chat, cambia de teléfono, o la rutina queda doscientos mensajes
arriba, no hay forma de recuperarla. Y escribirle al bot no sirve: un texto
suelto **solo** se interpreta si hay un check-in esperando respuesta
(SPEC-006 regla 10).

Es la primera queja que va a llegar de un cliente real.

## 3. Alcance

**Incluye:**
- `/rutina`, para el cliente vinculado
- Reenvía la **versión vigente**: la última en `SENT`
- El mismo formato que recibió al entregársela, con sus botones

**No incluye:**
- Ver versiones anteriores. La vigente es la que importa
- Que el cliente vea la ficha, los avisos internos o notas del entrenador
- Un comando equivalente para el entrenador: ya tiene `/cliente <nombre>`

## 4. Contratos

### Entrada

```
/rutina
```

Sin argumentos. El cliente es quien escribe, y el sistema sabe quién es por su
`telegram_user_id` (ADR-009).

### Salida

El mismo mensaje de SPEC-005, con los botones de aceptar y pedir cambio. **No
se genera un formato nuevo**: `formatWorkoutForClient` ya existe y se reutiliza
tal cual.

## 5. Reglas de negocio

1. **Solo el cliente**, y **solo su propia rutina**. No admite argumentos: no
   hay forma de pedir la de otro.
2. Se devuelve la versión **más reciente en `SENT`**. Una en `DRAFT` o
   `APPROVED` todavía no es suya.
3. Sin ninguna versión en `SENT`: se responde que su entrenador aún está
   preparándola. **No un error.**
4. Un cliente sin vincular no llega hasta aquí: `/start <token>` es lo primero.
5. **El entrenador que escriba `/rutina` recibe `/ayuda`.** No es suyo, y el
   simétrico ya lo tiene.
6. **No cambia ningún estado.** Reenviar no es reentregar: `sent_at` no se
   toca y no se registra un evento de entrega.

## 6. Estados

**Ninguno.** Es solo lectura.

## 7. Errores

| Situación | Respuesta |
|---|---|
| Todavía no hay rutina en `SENT` | «Tu entrenador está preparándola. Te avisamos en cuanto esté» |
| Lo envía el entrenador | `/ayuda` |
| Lo envía alguien sin vincular | El mensaje de `/start`, sin tocar la base |

## 8. Seguridad

- No admite parámetros: **es imposible pedir la rutina de otro**, aunque se
  fabrique el mensaje a mano.
- La consulta filtra por el `client_id` resuelto desde el perfil que escribe,
  nunca desde el texto.
- Ve lo mismo que ya recibió. Ni avisos internos, ni notas del entrenador.

## 9. Criterios de aceptación

- **CA-1** — DADO un cliente con rutina en `SENT`, CUANDO envía `/rutina`,
  ENTONCES recibe esa rutina con sus botones.
- **CA-2** — DADO un cliente con v1 `SENT` y v2 `DRAFT`, CUANDO la pide,
  ENTONCES recibe **la v1**.
- **CA-3** — DADO un cliente sin ninguna versión en `SENT`, CUANDO la pide,
  ENTONCES recibe el aviso de que está en camino, no un error.
- **CA-4** — DADO que la pide el entrenador, CUANDO llega, ENTONCES recibe
  `/ayuda`.
- **CA-5** — DADO `/rutina` con cualquier argumento, CUANDO llega, ENTONCES
  el argumento **se ignora** y se devuelve la suya.
- **CA-6** — DADO que la pide, CUANDO se responde, ENTONCES `sent_at` **no
  cambia** y no se registra ningún evento de entrega.

## 10. Archivos que toca

```
supabase/functions/_core/telegram/webhook.ts    + el enrutado
supabase/functions/_core/ports/query-ports.ts   + findCurrentRoutine
supabase/functions/_shared/db.ts                el adaptador
supabase/migrations/00XX_client_routine.sql     la consulta
docs/specs/SPEC-007-comandos-telegram.md        + el comando en su lista
```

## 11. Por qué es pequeña y aun así importa

Reutiliza el formateo, los botones y la autorización que ya existen. Lo único
nuevo es la consulta y el enrutado.

Y **cierra el único agujero del producto que un cliente nota en su primera
semana**: haber recibido algo que no puede volver a encontrar.
