# SPEC-004 — Aprobar, editar y rechazar

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-003 |
| **Sesiones** | S-11, S-12, S-13 |

## 1. Objetivo

El entrenador decide sobre cada borrador: lo aprueba, lo rechaza, o pide
cambios en lenguaje natural y recibe una versión nueva.

## 2. Alcance

**Incluye:** manejo de `callback_query`, las tres acciones, el flujo
conversacional de edición, versionado, audit trail.

**No incluye:** el envío al cliente (SPEC-005).

## 3. Contratos

### Entrada

`callback_query` con `callback_data = act:<approve|edit|reject>:<planId>`.

Para editar, el siguiente mensaje de texto del entrenador es la instrucción.

### Flujo de edición

```
[✏️ Editar]
   ↓
Bot: "¿Qué quieres cambiar en la rutina de Carlos?"
   ↓
Entrenador: "Quita sentadilla, tiene molestia de rodilla"
   ↓
Estado EDITING → Gemini → versión 2 → TRAINER_REVIEW
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
4. Aprobar: `TRAINER_REVIEW → APPROVED`. Dispara SPEC-005.
5. Rechazar: `TRAINER_REVIEW → REJECTED`. Terminal. Se pide el motivo, opcional.
6. Editar: `TRAINER_REVIEW → EDITING`. Al volver de Gemini, `version + 1` y
   vuelta a `TRAINER_REVIEW`.
7. **La edición también consume cuota** y pasa por el mismo chequeo de rate
   limit de SPEC-002.
8. Tras actuar, los botones del mensaje original se retiran para evitar
   dobles pulsaciones.
9. Máximo 5 ediciones por plan. Superado eso, se sugiere rechazar y empezar
   de nuevo.
10. Todo cambio de estado escribe en `plan_events` con `actor = 'trainer'`.

## 5. Estados

```
TRAINER_REVIEW ──┬──► APPROVED  ──► (SPEC-005)
                 ├──► REJECTED  (terminal)
                 └──► EDITING ──┬──► TRAINER_REVIEW  (versión +1)
                                ├──► FAILED
                                └──► MANUAL
```

**Prohibido por diseño:** cualquier camino a `SENT` que no pase por `APPROVED`.

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
- El `planId` del `callback_data` se valida como UUID y se comprueba que
  pertenece a un cliente del entrenador.

## 8. Criterios de aceptación

- **CA-1** — DADO un plan en `TRAINER_REVIEW`, CUANDO el entrenador aprueba,
  ENTONCES pasa a `APPROVED` y se registra en `plan_events`.
- **CA-2** — DADO un plan ya en `APPROVED`, CUANDO se vuelve a pulsar
  aprobar, ENTONCES se responde "ya fue procesada" y el estado no cambia.
- **CA-3** — DADO un plan en `TRAINER_REVIEW`, CUANDO se pide una edición,
  ENTONCES pasa por `EDITING` y vuelve con `version = 2`.
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
