# SPEC-038 — Un comando para salir de una espera de texto

| Campo | Valor |
|---|---|
| **Estado** | **BORRADOR** — 3 preguntas para Ana antes de implementar (§5) |
| **Depende de** | SPEC-004, SPEC-010, SPEC-030 |
| **Sesiones** | Por asignar |
| **Origen** | Pedido de Ana en testing real: "puede pedir un cambio, luego otro... es infinito, puede pedir cambios. Un comando para que pueda limpiar la pantalla" |

## 1. Objetivo

Que el cliente (pidiendo un cambio a su rutina) y el entrenador (dictando una edición conversacional) tengan una forma explícita de decir "ya terminé de escribir" — sin depender de que el otro lado adivine cuándo paró.

## 2. El problema

**Lo que Ana pidió textualmente no se puede hacer.** Telegram no tiene ninguna función, para ningún bot, que borre el historial de chat del lado de quien lo recibe — "limpiar la pantalla" no es algo que la Bot API permita. Lo que sí es un problema real, y resoluble, es lo que describió debajo de ese pedido:

Hoy, mientras el cliente tiene una solicitud de cambio abierta (SPEC-010), **cualquier mensaje de texto que escriba se trata como "más detalle" y se reenvía al entrenador, sin límite** (`checkin/reply.ts` → `handleCheckinText`, `change-request/flows.ts` → `addComment`). El cliente nunca sabe si ya dijo suficiente, así que sigue escribiendo, y cada mensaje nuevo dispara otro aviso al entrenador. No existe ningún comando, para ningún rol, que cierre esa espera a voluntad — ni para el cliente pidiendo un cambio, ni para el entrenador en la edición conversacional del borrador (SPEC-004), aunque ahí sí existe una cancelación *implícita* (tasks previas: cualquier comando o botón del entrenador cancela la espera en silencio, pero solo como efecto secundario de hacer otra cosa, nunca como una acción que el entrenador pida directamente).

## 3. Lo que se puede diseñar ya

- Un comando nuevo, disponible para los dos roles, que cierra la espera de texto libre sobre lo que cada uno tenga abierto:
  - **Cliente** con una solicitud de cambio abierta → deja de tratar sus próximos mensajes como comentario adicional. **La solicitud sigue abierta para el entrenador** — nada de lo ya enviado se retira ni se borra. Solo cambia qué hace el bot con el PRÓXIMO mensaje suelto.
  - **Entrenador** con una edición conversacional en curso (SPEC-004) → mismo efecto que ya dispara cualquier otro comando hoy, pero como acción explícita en vez de efecto secundario.
- Confirmación al ejecutarlo: el bot dice qué se cerró, para que no quede la duda de si funcionó.

## 4. Lo que falta decidir

Las preguntas de §5 son sobre el **nombre y el alcance exacto**, no sobre si construirlo — la pieza central (cerrar la espera de texto) ya tiene un diseño claro arriba.

## 5. Preguntas para Ana

| # | Pregunta | Por qué importa |
|---|---|---|
| **P1** | ¿El comando se llama `/cancelar`, o prefieres otro nombre? | `/cancelar` es intuitivo, pero podría confundirse con "cancelar mi solicitud entera" si no se explica bien en la respuesta del bot. |
| **P2** | Además del comando, ¿hace falta un límite automático (por ejemplo, al tercer mensaje seguido el bot sugiere `/cancelar` solo)? | Sin límite, un cliente que no conoce el comando puede seguir en el mismo problema de hoy. Con límite, hay más código y otra decisión de producto (¿a los cuántos mensajes?). |
| **P3** | ¿El cliente puede reabrir el "modo comentario" después de cancelarlo (por ejemplo, tocando otra vez "✏️ Pedir un cambio" sobre la misma solicitud), o una vez cerrado queda cerrado hasta que el entrenador responda? | Cambia si `/cancelar` es reversible o no. |

## 6. Alcance tentativo (sujeto a §5)

**Incluiría:**
- `/cancelar`, documentado en `/ayuda` de cada rol.
- Confirmación al ejecutarlo, distinta según qué se cerró.
- Sin efecto si no había ninguna espera abierta (mensaje neutro, no un error).

**No incluiría:**
- Borrar o editar mensajes ya enviados en Telegram (no es posible desde la Bot API para mensajes del lado del cliente, y no es lo que soluciona el problema real).
- Retirar una solicitud de cambio ya creada — sigue existiendo, el entrenador la sigue viendo (principio: ningún texto del cliente decide el destino de su rutina, SPEC-010).
- Un límite de mensajes automático, a menos que P2 lo confirme.

## 7. Qué no cambia

El entrenador sigue siendo quien decide cuándo una solicitud está resuelta (`resolveRequests`, al enviar la v2 — SPEC-010 regla 12). `/cancelar` no toca eso: solo decide si el PRÓXIMO mensaje del cliente se interpreta como comentario o no.
