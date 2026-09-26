# SPEC-004 — Aprobar, editar y rechazar

| Campo | Valor |
|---|---|
| **Estado** | **PARCIAL** — aprobar y rechazar, cableados. Falta el flujo de edición |
| **Depende de** | SPEC-003, SPEC-009 |
| **Sesiones** | S-10, S-11 |

## Resultado parcial

| Pieza | Estado |
|---|---|
| `answerCallbackQuery` siempre, y lo primero (regla 2, CA-5) | ✅ |
| Solo el entrenador dueño (regla 3, CA-4) | ✅ |
| Aprobar `DRAFT → APPROVED` (regla 4, CA-1) | ✅ |
| Rechazar `DRAFT → REJECTED` (regla 5) | ✅ |
| La máquina de estados decide qué es legal (regla 1, CA-7, CA-8) | ✅ |
| Doble pulsación (CA-2) | ✅ Vía la guarda de la transición |
| Enrutado del `callback_query` en el webhook | ✅ |
| El botón «✏️ Editar» redirige al editor real, no finge (S-49) | ✅ |
| Flujo conversacional de edición (regla 6, CA-3) | ⏳ |
| Máximo 5 ediciones (regla 9, CA-6) | ⏳ |
| Retirar los botones tras actuar (regla 8) | ⏳ Ver nota |

> **Sobre la regla 8.** Retirar los botones necesita `editMessageReplyMarkup`,
> que el puerto no tiene. Mientras tanto la doble pulsación la para la guarda
> de la transición, que es **más robusta**: retirar botones es cosmético y dos
> pulsaciones simultáneas lo esquivarían igual.

> **Sobre «✏️ Editar» (S-49).** El botón vive desde S-10, pero
> `handleAction` no lo tenía mapeado: cualquier pulsación caía en «Eso
> todavía no está listo», sin decir por dónde seguir. Encontrado auditando
> la máquina de estados (`docs/STATE-MACHINE.md`). No se implementó el
> flujo conversacional de la regla 6 —eso sigue siendo un cambio grande,
> con IA y consumo de cuota de por medio—: se corrigió el mensaje para que
> mande al editor que **ya existe y ya funciona** (`/ver`, SPEC-008/022) en
> vez de fingir que no hay nada que hacer.

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

> **Propuesta pendiente (SPEC-022 §12.ter, M3).** El mensaje de rechazo
> decía «Puedes empezar otra» sin decir cómo. Pasa a llevar el botón
> **✏️ Crear v2** (`revise` → `startRevision`), el mismo que la ficha ofrece
> sobre una versión `REJECTED`. Sin estados ni transiciones nuevas.

## 6. Errores

| Situación | Efecto |
|---|---|
| Botón pulsado dos veces | Segunda pulsación: "Esta rutina ya fue procesada" |
| Acción sobre plan en estado inválido | Mensaje explicando el estado actual |
| Instrucción de edición vacía | Se vuelve a preguntar |
| Gemini falla durante la edición | Se conserva la versión anterior; se avisa |
| Sexta edición | Se sugiere rechazar y regenerar |
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

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | Máquina de estados: **las 10 transiciones válidas y todas las inválidas** |
| Unit | `REJECTED` y `SENT` son terminales |
| Unit | `parseCallbackData` con datos válidos y malformados |
| Unit | `canEdit` devuelve false en la sexta edición |
| Integration | CA-1 a CA-4, CA-6, CA-8 |
| E2E | Pasos 5–6 del camino crítico |

## 10. Archivos que toca

```
supabase/functions/_core/state-machine.ts
supabase/functions/_core/state-machine.test.ts
supabase/functions/_core/callback-data.ts
supabase/functions/telegram-webhook/index.ts
supabase/functions/telegram-webhook/handlers/actions.ts
```
