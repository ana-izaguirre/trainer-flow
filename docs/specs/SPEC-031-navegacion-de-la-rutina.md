# SPEC-031 — Navegación de la rutina: índice, por día o completa

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** — aprobada por Ana el 30/09/2026 |
| **Depende de** | SPEC-004, SPEC-005, SPEC-007, SPEC-010, SPEC-029 |
| **Sesiones** | S-50 |

## Resultado

| Pieza | Dónde | Estado |
|---|---|---|
| Patrón `nav:<vista>:<versionId>`, separado de `act:` | `telegram/callback-data.ts` | ✅ CA-2, CA-3, CA-7, 100% mutation |
| Vista de índice y de un día | `telegram/format.ts`, `telegram/client-format.ts` | ✅ CA-1, CA-5, CA-6 |
| Teclado de navegación + fila de decisión | `telegram/keyboard.ts` (`buildNavKeyboard`) | ✅ CA-3, CA-4 |
| El handler de solo lectura, sin transicionar nunca | `telegram/navigation.ts` | ✅ CA-2, CA-4, CA-7, 100% mutation |
| Despacho del prefijo `nav:` | `telegram/webhook.ts` | ✅ CA-8 |
| Primer mensaje = índice, en entrega y `/rutina` | `telegram/delivery.ts`, `commands/router.ts` | ✅ CA-1 |
| `plan` en `VersionForAction` (para repintar el índice/completa del cliente) | `ports/action-ports.ts`, migración 0029, `_shared/db.ts` | ✅ |

## 1. Objetivo

Que quien reciba la rutina elija cómo leerla —de un vistazo por día, o completa—
en vez de recibir siempre un solo bloque largo, sin perder en ningún momento
los botones para decidir sobre ella.

## 2. Diagnóstico

SPEC-029 resolvió que cada ejercicio se lea bien. No resolvió que una rutina de
5 o 7 días **quepa cómodo**: técnicamente cabe en un mensaje (una de 5 días con
4 ejercicios cada uno mide ~1600 caracteres, muy por debajo del límite de 4096
de Telegram), pero es largo de leer de un tirón, y encontrar «el día de hoy»
exige scrollear entre los demás.

El corte de SPEC-029 §6 es por **tamaño** (parte cuando no cabe). Lo que falta
es un corte por **elección**: dejar que la persona pida un día a la vez.

## 3. Alcance

**Incluye:**
- Una vista de **índice**: cabecera + un renglón por día, sin ejercicios.
- Navegación **por día**, con botones para ir al anterior y al siguiente.
- La vista **completa** de siempre (SPEC-029 §4), ahora bajo demanda.
- Los botones de decisión (aprobar/rechazar, me sirve/pedir cambio, editar)
  presentes en **las tres** vistas, no solo en el último mensaje.
- Aplica a **todo** envío de rutina completa (entrega, `/rutina`, tras editar),
  igual que ya exige SPEC-029 §11: un único lugar de formateo.

**No incluye:**
- **Editar el mensaje en el lugar** (`editMessageText` de Telegram). Cada botón
  de navegación manda un **mensaje nuevo**. Es menos prolijo en el historial
  del chat, pero no exige agregar un método nuevo al adaptador de Telegram ni
  guardar el `message_id` de cada envío para saber cuál editar después. Si en
  la práctica el volumen de mensajes navegados molesta, es la mejora natural
  de una siguiente spec (§9 de SPEC-019 tiene el mismo tipo de nota).
- Cambiar el contenido guardado, la validación o el esquema: es presentación,
  igual que SPEC-029.
- Navegación dentro de comandos de edición puntual (`/quitar`, `/nota`): esos
  siguen operando sobre la numeración de siempre, sin vista propia.

## 4. Contratos

### Entrada

El `callback_data` de un botón tocado (nueva vista pedida) o, para el primer
envío de una rutina, ninguno: siempre arranca en el índice.

### Salida

Un único mensaje de Telegram (texto + teclado) por toque de botón. La vista
completa puede seguir partiéndose en varios mensajes por tamaño (SPEC-029
CA-6); índice y día individual nunca se acercan al límite.

### Tipos

```typescript
export type RoutineView =
  | { readonly kind: 'index' }
  | { readonly kind: 'day'; readonly dayNumber: number }
  | { readonly kind: 'full' };
```

## 5. Reglas de negocio

1. **El primer mensaje de una rutina es siempre el índice**: cabecera (la
   misma de hoy: saludo/objetivo/resumen para el cliente, título/resumen para
   el entrenador) y una línea `📅 Día N · <foco>` por día, sin ejercicios.
2. **Botones del índice**: `📖 Ver todo` y `▶️ Día 1`, más la fila de decisión
   que corresponda (regla 7).
3. **Vista de un día**: la cabecera de ese día y sus ejercicios, con el mismo
   `formatDayHeader`/`formatExerciseBlock` de SPEC-029 — nada cambia en cómo
   se ve un ejercicio, solo qué días se muestran juntos. Botones: `◀️ Día N-1`
   si `N > 1`, `📋 Índice` siempre, `Día N+1 ▶️` si `N < total`.
4. **Vista completa**: el texto de siempre (SPEC-029 §4). Botón `📋 Índice` en
   el último mensaje si se partió por tamaño.
5. **Cada botón de navegación manda un mensaje nuevo.** No se edita ninguno
   anterior (§3, «No incluye»).
6. **Navegar no cambia `version_state` ni nada del dominio.** Es de solo
   lectura: el mismo `claimEvent`/idempotencia de cualquier callback alcanza.
7. **La fila de decisión va en las tres vistas**, con las mismas
   `actionsForState`/`CLIENT_ACTIONS` que ya existen (`keyboard.ts`). Tocar un
   botón de decisión funciona igual sin importar desde qué vista se tocó: el
   `versionId` viaja en su `callback_data`, no la vista actual.

   **Pedir un cambio (SPEC-010) no distingue vistas, a propósito.** No se
   anota automáticamente «pedido viendo el Día 3»: el flujo sigue siendo
   motivo + comentario libre, igual sin importar desde dónde se tocó. Además
   de ser la opción más simple, es la única que cabe: `chg:<reason>:<id>` ya
   usa 63 de los 64 bytes con `uncomfortable_exercise`, el motivo más largo —
   no hay margen para agregar un número de día ahí sin rediseñar ese
   mecanismo aparte.
8. **Ni las plantillas ni la creación manual cambian nada de esto.** Las tres
   vistas operan sobre `Workout`, el modelo ya validado (principio 2 de
   CLAUDE.md) — no existe ningún campo que diga si vino de la IA, de una
   plantilla o de creación manual, así que no hay rama de código que las
   distinga.
9. **Las advertencias (`⚠️ Tenido en cuenta`) solo en la vista completa del
   entrenador.** Ni en el índice ni en un día individual: son de la rutina
   entera, no de un día suelto, y mostrarlas ahí sería repetirlas en cada
   vista o elegir arbitrariamente en cuál. El cliente, como hoy, no las ve en
   ninguna vista (SPEC-029 regla 7).
10. **Aplica a entrega (SPEC-005) y `/rutina` (SPEC-007)** — los dos casos en
    que alguien pide **leer** su rutina ya aprobada. **No** al editor
    conversacional (`creation/editor-session.ts`, `/ver`) ni a los avisos
    automáticos de `telegram/notify.ts` (p. ej. «la IA terminó»): ahí el
    entrenador está **editando o decidiendo**, y necesita ver todo de una vez
    con la numeración estable de `/quitar`/`/nota` — obligarlo a navegar por
    índice sería estorbar el flujo que esos dos sí necesitan resolver rápido.
    Sigue siendo un único lugar de formateo (`format.ts`/`client-format.ts`);
    lo que cambia es solo cuáles de sus funciones llama cada punto de
    entrada.

### `callback_data` de navegación

11. Formato `nav:<vista>:<versionId>`, con `<vista>` igual a `idx`, `full` o
    `d<N>` (`d1`…`d7`, por `WORKOUT_LIMITS.dayNumber.max`). Es un patrón
    **separado** del `act:<accion>:<versionId>` de `callback-data.ts`: son dos
    cosas distintas —una decide sobre el dominio, la otra solo cambia qué se
    muestra— y mezclarlas en el mismo `CallbackAction` haría que
    `actionsForState` tuviera que filtrar acciones que no son decisiones.
12. Con el UUID más largo, `nav:d15:` mide 44 bytes: muy por debajo del
    límite de 64 (mismo cuidado que ya exige `keyboard.ts`).
13. Un día fuera de rango en el `callback_data` (`callback_data` es dato no
    confiable, igual que hoy) responde con el índice, sin error visible: no
    hay nada sensible que proteger en qué día se pidió, a diferencia del
    `versionId`, que sigue pasando por `authorization.ts` sin cambios.

## 6. Estados

No añade ni cambia ningún `version_state` (regla 6).

## 7. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| Día fuera de rango en `nav:d<N>:<id>` | Se responde con el índice | Ninguno — solo lectura |
| `versionId` no autorizado para quien tocó el botón | Igual que hoy: lo bloquea `authorization.ts` | Ninguno |

## 8. Seguridad

Nada nuevo respecto a SPEC-029: el `callback_data` de navegación es tan no
confiable como el de decisión, y quien decide si esa persona puede ver esa
versión sigue siendo `authorization.ts`, no el parseo del callback.

## 9. Lo que queda para después

Editar el mensaje en el lugar (`editMessageText` + guardar `message_id`), si
el volumen de mensajes por navegación resulta molesto en la práctica. Exige
agregar ese método a `TelegramSender` y a su adaptador en `_shared`, y decidir
dónde vive el `message_id` a editar — trabajo real, no una línea.

## 10. Criterios de aceptación

- **CA-1** — DADO que se entrega una rutina, CUANDO se manda el primer
  mensaje, ENTONCES es la vista de índice: cabecera y un renglón por día, sin
  ejercicios.
- **CA-2** — DADO el índice, CUANDO se toca `▶️ Día 1`, ENTONCES llega un
  mensaje nuevo con solo ese día y sus ejercicios.
- **CA-3** — DADO un día que no es ni el primero ni el último, ENTONCES sus
  botones incluyen `◀️` y `▶️`; DADO el primero, no aparece `◀️`; DADO el
  último, no aparece `▶️`.
- **CA-4** — DADO cualquier vista (índice, día, completa), ENTONCES incluye la
  fila de decisión que corresponde al rol y al estado de la versión.
- **CA-5** — DADO `📖 Ver todo`, ENTONCES el contenido es idéntico al formato
  de SPEC-029 §4, con `⚠️ Tenido en cuenta` solo si hay `warnings` y solo para
  el entrenador.
- **CA-6** — DADO el cliente, CUANDO ve cualquier vista, ENTONCES nunca
  aparecen `warnings`.
- **CA-7** — DADO un `callback_data` `nav:d99:<id>` sobre una rutina de 5
  días, ENTONCES se responde con el índice, sin error.
- **CA-8** — DADO cualquier vista, CUANDO se toca un botón de decisión,
  ENTONCES el efecto es idéntico al de hoy, sin importar desde qué vista se
  tocó.

## 11. Tests

| Nivel | Caso |
|---|---|
| Unit | CA-1 a CA-7 en `format.test.ts`, `client-format.test.ts`, `callback-data.test.ts`, `keyboard.test.ts` |
| Integration | CA-8 sobre el router de callbacks: decisión tomada desde el índice y desde un día individual |
| E2E | Los existentes que miran el texto de entrega se actualizan a la vista de índice como primer mensaje |

## 12. Archivos que toca

```
supabase/functions/_core/telegram/format.ts           vista de índice, vista de un día
supabase/functions/_core/telegram/client-format.ts     ídem, versión cliente
supabase/functions/_core/telegram/keyboard.ts          teclados de navegación (◀️ 📋 ▶️ 📖)
supabase/functions/_core/telegram/callback-data.ts     patrón nav:<vista>:<versionId>
supabase/functions/_core/commands/router.ts            despacha callback_data de navegación
+ sus tests
docs/specs/SPEC-029                                    referencia cruzada a esta spec
```
