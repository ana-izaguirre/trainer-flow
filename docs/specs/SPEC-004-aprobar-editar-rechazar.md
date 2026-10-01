# SPEC-004 — Aprobar, editar y rechazar

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** — aprobada por Ana el 30/09/2026 |
| **Depende de** | SPEC-003, SPEC-009 |
| **Sesiones** | S-10, S-11 |

## Resultado

| Pieza | Estado |
|---|---|
| `answerCallbackQuery` siempre, y lo primero (regla 2, CA-5) | ✅ |
| Solo el entrenador dueño (regla 3, CA-4) | ✅ |
| Aprobar `DRAFT → APPROVED` (regla 4, CA-1) | ✅ |
| Rechazar `DRAFT → REJECTED` (regla 5) | ✅ |
| La máquina de estados decide qué es legal (regla 1, CA-7, CA-8) | ✅ |
| Doble pulsación (CA-2) | ✅ Vía la guarda de la transición |
| Enrutado del `callback_query` en el webhook | ✅ |
| Flujo conversacional de edición, con evaluación de Tally (regla 6, CA-3) | ✅ `_core/ai/edit-version.ts` |
| Sin evaluación, sigue siendo el editor manual (`/ver`) | ✅ |
| Estado explícito de espera, cancelado por cualquier comando | ✅ `awaiting_edit_instruction` |
| Máximo 5 ediciones, compartido con el editor manual (regla 9, CA-6) | ✅ |
| Retirar los botones tras actuar (regla 8) | ⏳ Ver nota |

> **Sobre la regla 8.** Retirar los botones necesita `editMessageReplyMarkup`,
> que el puerto no tiene. Mientras tanto la doble pulsación la para la guarda
> de la transición, que es **más robusta**: retirar botones es cosmético y dos
> pulsaciones simultáneas lo esquivarían igual.

## 1. Objetivo

El entrenador decide sobre cada borrador: lo aprueba, lo rechaza, o pide
cambios en lenguaje natural y recibe una versión nueva.

## 2. Alcance

**Incluye:** manejo de `callback_query`, las tres acciones, el flujo
conversacional de edición, versionado, audit trail.

**No incluye:** el envío al cliente (SPEC-005).

## 3. Contratos

### Entrada

`callback_query` con `callback_data = act:<approve|edit|reject>:<versionId>`.

Para editar, el siguiente mensaje de texto del entrenador es la instrucción.

### Flujo de edición

```
[✏️ Editar]
   ↓
Bot: "¿Qué quieres cambiar en la rutina de Carlos?"
   ↓
Entrenador: "Quita sentadilla, tiene molestia de rodilla"
   ↓
La versión en DRAFT se modifica in-place. No cambia de estado.
   ↓
Nuevo mensaje con botones
```

### Cómo se reconoce «el siguiente mensaje», en concreto

**El problema que esto resuelve.** Un entrenador casi siempre tiene algún
borrador en `DRAFT` — cualquier generación pendiente de revisar. Sin un
estado explícito, cualquier mensaje casual («gracias», «dale») con un draft
abierto dispararía una llamada a Gemini que nadie pidió. Decidido con Ana
(30/09/2026): **estado explícito**, no «si hay un draft abierto, se
interpreta» (que es el patrón que usa SPEC-010 para el cliente, pero ahí la
ventana es corta y la abre el propio cliente; un DRAFT del entrenador puede
vivir días).

- `workout_versions` gana una columna `awaiting_edit_instruction` (boolean).
- Pulsar «✏️ Editar» la prende **en esa versión** y la apaga en cualquier
  otra del mismo entrenador (a lo sumo una espera pendiente a la vez — mismo
  criterio que «el borrador tocado más recientemente», SPEC-008 §3). Antes de
  prenderla se comprueba la regla 9: con `edit_count = 5` no se pregunta nada,
  se sugiere rechazar y regenerar.
- El próximo mensaje de **texto libre** (no comando) de ese entrenador se
  busca contra «¿alguna de mis versiones está esperando instrucción?».
  - Ninguna esperando → no se reinterpreta nada (igual que hoy: un mensaje
    suelto del entrenador no produce respuesta).
  - Alguna esperando, vacío tras `trim()` → se vuelve a preguntar, la espera
    sigue.
  - Alguna esperando, más de 500 caracteres → se rechaza pidiendo que lo
    resuma, la espera sigue.
  - Alguna esperando, válido → se apaga la espera y se dispara la edición
    (§"La llamada a la IA", abajo).
- Un **comando** del entrenador antes de escribir la instrucción cancela la
  espera en silencio: se apaga la bandera, el comando sigue su curso normal.
  Cambiar de intención no es un error.

### Sin evaluación de Tally, sigue siendo el editor manual

**El problema.** La conversación llama al mismo `AIProvider` que generar
(SPEC-002), y `AIRequest` exige `goal`, `level`, `daysPerWeek`… — datos que
vienen de la evaluación de Tally. Una rutina de **plantilla o manual** no
tiene evaluación detrás (`VersionForAction.constraints` ya es `null` para
esas, regla que SPEC-008 §11 ya usa para «validar la forma en vez de un
encaje con criterios que no existen»). Sin ese dato, no hay con qué llamar a
la IA — y descubrirlo recién al escribir la instrucción dejaría al
entrenador contestando una pregunta que nunca se va a resolver, el mismo
tipo de encierro que el estado explícito de arriba evita para el caso del
mensaje casual.

**La solución.** `constraints === null` decide el camino, en «✏️ Editar»
mismo, antes de preguntar nada:

- Con evaluación (`constraints !== null`): el camino nuevo — prende la
  espera, pregunta qué cambiar.
- Sin evaluación (`constraints === null`): el camino de siempre — manda al
  editor manual (`/ver`, SPEC-008/SPEC-022), sin prender ninguna espera.

No es una limitación nueva: es la misma que ya tiene «🤖 Generar con IA»,
aplicada al mismo botón que ahora también llama a la IA.

### La llamada a la IA

Mismo orquestador que SPEC-002 (`generateVersion`), aplicado a una versión en
`DRAFT` en vez de `NEW`:

1. Cuota (`checkRateLimit`, misma ventana). Sin cuota: se avisa, el contenido
   no cambia, la espera ya está apagada — puede volver a pulsar «✏️ Editar».
2. Se llama al `AIProvider` con `instruction` seteada (el campo ya existía en
   `AIRequest` para esto) y el resto de los datos de la versión. Mismo
   reintento que generar: solo `API_ERROR`/`TIMEOUT`.
3. Éxito y `validateDraft` pasa: se guarda in-place (`save_draft_content`,
   ya existente — el mismo camino que usa el editor manual), `edit_count + 1`,
   sigue en `DRAFT`. Se manda la rutina completa con sus botones, igual que
   cualquier edición manual (regla del editor: nunca «actualizada» a secas).
4. Fallo, o el borrador no valida: **la versión queda exactamente como
   estaba** (tabla de errores §6) — ni `content` ni `edit_count` cambian. Se
   avisa el fallo.

Ambos casos se registran en `ai_generations` con `operation = 'edit'` —la
columna y su `check` ya distinguían `'generate'` de `'edit'` desde la
migración inicial, sin usarse todavía.

## 4. Reglas de negocio

1. **Toda acción se valida contra la máquina de estados.** Una acción sobre
   un plan en estado incorrecto se rechaza con un mensaje claro.
2. `answerCallbackQuery` se responde en menos de 3 segundos, siempre, incluso
   si el trabajo posterior es lento. Si no, Telegram muestra el botón colgado.
3. **Solo el entrenador puede aprobar, editar o rechazar.** Se verifica el
   `chat_id`.
4. Aprobar: `DRAFT → APPROVED`. Dispara SPEC-005.
5. Rechazar: `DRAFT → REJECTED`. Terminal. Se pide el motivo, opcional.
6. Editar una versión en `DRAFT`: se modifica **in-place**. No crea versión ni
   cambia estado. Editar una versión en `SENT` **no está permitido**: se crea
   `version + 1` (SPEC-010).
7. **La edición también consume cuota** y pasa por el mismo chequeo de rate
   limit de SPEC-002.
8. Tras actuar, los botones del mensaje original se retiran para evitar
   dobles pulsaciones.
9. Máximo 5 ediciones por plan. Superado eso, se sugiere rechazar y empezar
   de nuevo.
10. Todo cambio de estado escribe en `plan_events` con `actor = 'trainer'`.

## 5. Estados

```
DRAFT ──┬── EDIT ────► DRAFT  (in-place, no cambia estado)
        ├── APPROVE ─► APPROVED ──► (SPEC-005)
        └── REJECT ──► REJECTED  (terminal)
```

**Prohibido por diseño:** cualquier camino a `SENT` que no pase por `APPROVED`.

> **SPEC-022 §12.ter, M3 (implementado).** El mensaje de rechazo
> decía «Puedes empezar otra» sin decir cómo. Ahora lleva el botón
> **✏️ Crear v2** (`revise` → `startRevision`), el mismo que la ficha ofrece
> sobre una versión `REJECTED`. Sin estados ni transiciones nuevas.

## 6. Errores

| Situación | Efecto |
|---|---|
| Botón pulsado dos veces | Segunda pulsación: "Esta rutina ya fue procesada" |
| Acción sobre plan en estado inválido | Mensaje explicando el estado actual |
| Instrucción de edición vacía | Se vuelve a preguntar; la espera sigue |
| Instrucción de edición > 500 caracteres | Se pide que lo resuma; la espera sigue |
| Gemini falla durante la edición | Se conserva la versión anterior; se avisa |
| Un comando llega antes de la instrucción | La espera se cancela en silencio |
| Sexta edición | Se sugiere rechazar y regenerar, sin preguntar nada |
| `chat_id` no autorizado | Se ignora y se registra |

## 7. Seguridad

- **Autorización estricta:** solo el `chat_id` del entrenador.
  Este es el punto donde el principio del producto se hace cumplir.
- La instrucción de edición es entrada no confiable: se valida longitud
  (máximo 500 caracteres) y se pasa a Gemini como dato, no como instrucción
  de sistema.
- El `versionId` del `callback_data` se valida como UUID y por **pertenencia**,
  contra la identidad resuelta del webhook (SPEC-009), nunca contra el ID recibido.

## 8. Criterios de aceptación

- **CA-1** — DADO una versión en `DRAFT`, CUANDO el entrenador aprueba,
  ENTONCES pasa a `APPROVED` y se registra en `plan_events`.
- **CA-2** — DADO un plan ya en `APPROVED`, CUANDO se vuelve a pulsar
  aprobar, ENTONCES se responde "ya fue procesada" y el estado no cambia.
- **CA-3** — DADO una versión en `DRAFT`, CUANDO se pide una edición,
  ENTONCES se modifica in-place, sigue en `DRAFT` y `version_number` no cambia.
- **CA-4** — DADO un `callback_query` de un `chat_id` que no es el entrenador,
  CUANDO llega, ENTONCES se ignora y el estado no cambia.
- **CA-5** — DADO cualquier `callback_query`, CUANDO llega, ENTONCES
  `answerCallbackQuery` se responde en menos de 3 segundos.
- **CA-6** — DADO un plan con 5 ediciones, CUANDO se pide la sexta, ENTONCES
  se sugiere rechazar y no se llama a Gemini.
- **CA-7** — DADO un plan en `DRAFT`, CUANDO se intenta la transición a
  `SENT`, ENTONCES la máquina de estados lo rechaza.
- **CA-8** — DADO un plan rechazado, CUANDO se intenta aprobarlo, ENTONCES se
  rechaza (`REJECTED` es terminal).
- **CA-9** — DADO un `DRAFT` sin evaluación de Tally (plantilla o manual),
  CUANDO se pulsa «✏️ Editar», ENTONCES manda al editor manual (`/ver`) y no
  prende ninguna espera.
- **CA-10** — DADO una espera de instrucción prendida, CUANDO llega un
  COMANDO antes del texto, ENTONCES la espera se cancela en silencio y el
  comando sigue su curso normal.
- **CA-11** — DADO una instrucción vacía o de más de 500 caracteres, CUANDO
  llega, ENTONCES se rechaza sin llamar a la IA y la espera sigue abierta.
- **CA-12** — DADO que la IA falla al editar (cualquier motivo), CUANDO
  responde, ENTONCES la versión queda exactamente como estaba — ni `content`
  ni `edit_count` cambian.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | Máquina de estados: **las 11 transiciones válidas y todas las inválidas** |
| Unit | `REJECTED` y `SENT` son terminales |
| Unit | `parseCallbackData` con datos válidos y malformados |
| Unit | `canEdit` devuelve false en la sexta edición |
| Integration | CA-1 a CA-4, CA-6, CA-8 |
| E2E | Pasos 5–6 del camino crítico |

## 10. Archivos que toca

```
supabase/migrations/00XX_edit_instruction.sql
supabase/functions/_core/domain/state-machine.ts        (sin cambios: EDIT ya existe)
supabase/functions/_core/callback-data.ts
supabase/functions/_core/telegram/actions.ts
supabase/functions/_core/telegram/webhook.ts
supabase/functions/_core/ai/edit-version.ts              (nuevo — análogo a generate-version.ts)
supabase/functions/_core/ai/edit-version.test.ts
supabase/functions/_core/ports/ai-provider.ts             (sin cambios: instruction ya existía)
supabase/functions/_core/ports/generation-ports.ts        (GenerationRecord gana `operation`)
supabase/functions/_core/ports/action-ports.ts            (VersionForAction gana `editCount`)
```
