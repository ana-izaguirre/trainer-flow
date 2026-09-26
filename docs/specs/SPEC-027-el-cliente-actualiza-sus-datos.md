# SPEC-027 — El cliente actualiza sus datos

| Campo | Valor |
|---|---|
| **Estado** | **BORRADOR — pendiente de aprobación** |
| **Depende de** | SPEC-001, SPEC-009, SPEC-010, SPEC-015, SPEC-023 |
| **Sesiones** | Por asignar |
| **Origen** | Pedido de Ana (septiembre 2026): un cliente que cambia de objetivo, de días, de tiempo o de cualquier dato del formulario |

## 1. Objetivo

Que un cliente ya registrado pueda **corregir o actualizar cualquier dato de su
evaluación** sin que el sistema lo trate como un cliente nuevo, y que el
entrenador **se entere de qué cambió** y decida si hace falta una rutina nueva.

## 2. El problema

Hoy no hay forma de actualizar nada. Si el cliente vuelve a llenar el
formulario de Tally, SPEC-001 lo trata como **un cliente nuevo**:

```
Carlos llena el formulario otra vez (ahora 2 días, no 3)
   ↓
Se crea un SEGUNDO «Carlos Pérez», sin vincular, con su propio plan
   ↓
/cliente Carlos → «Hay varios que encajan»
El Carlos real sigue con 3 días, y su rutina sigue en SENT
```

SPEC-001 lo decidió así a propósito: resolver la identidad **por nombre**
fusionaría a dos personas distintas sin que nadie se enterara, y un duplicado
visible es el mal menor. Esa decisión sigue siendo correcta **para alguien que
llega por primera vez**. Lo que falta es un camino para quien **ya está
registrado**: ahí sí se sabe quién es, porque habla con el bot.

## 3. Decisiones que Ana tiene que tomar

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | ¿Cómo cambia sus datos el cliente? | **El formulario completo, con un enlace personal** (§4). La alternativa está en §4.bis |
| **D2** | ¿El plan pasa a usar la evaluación nueva? | **Sí**, y las anteriores se guardan (regla 6) |
| **D3** | ¿Puede el entrenador pedirle la actualización? | **Sí**, con un botón en la ficha (regla 3) |
| **D4** | ¿Cuánto dura el enlace? | **7 días, un solo uso** (regla 4) |

**No se decide aquí, porque ya está decidido:** la rutina vigente **no
cambia sola**. Datos nuevos no generan una rutina nueva automáticamente: el
entrenador decide si hace falta una v2 y cómo prepararla (principio 1).

## 4. La propuesta: el formulario, con un enlace personal

```
Cliente: /actualizar
   ↓
Bot: «Llena de nuevo tu evaluación con este enlace. Es solo tuyo
      y vence en 7 días. Tu rutina actual no cambia hasta que tu
      entrenador la revise.»
      [📝 Actualizar mis datos]  → https://tally.so/r/<form>?update=<token>
   ↓
Cliente llena el formulario completo
   ↓
Tally → webhook → la ingesta ve el campo oculto `update`
   ↓
Evaluación NUEVA para el MISMO cliente, no un cliente nuevo
   ↓
Entrenador:                                   Cliente:
📝 Carlos Pérez actualizó sus datos            ✅ Recibido. Tu entrenador ya
Cambió: días (3 → 2) · minutos (60 → 45)          tiene tus datos nuevos.
        · limitaciones
[📄 Ver evaluación]  [✏️ Crear v2]
```

**Por qué el formulario completo y no editar campo por campo.**

- **Reutiliza todo lo que ya funciona:** la firma de Tally, la validación de
  SPEC-001 y SPEC-016, la ficha de SPEC-015. Solo cambia a quién se asigna la
  evaluación.
- **Los datos de salud no pasan por el chat.** Una lesión nueva se escribe en
  el formulario, como la primera vez, y no en un mensaje de Telegram que queda
  en el historial.
- **Cubre cualquier campo**, que es lo que se pidió. Editar por botones
  cubriría tres o cuatro campos y dejaría fuera justo los difíciles.

**El costo:** el cliente llena el formulario entero otra vez. Con Tally se
puede prellenar con las respuestas anteriores. Eso queda fuera de esta spec
(§11), porque depende de cómo esté armado el formulario.

**Por qué ahora sí sirve un campo oculto.** SPEC-014 lo descartó para el
**primer** envío: el token no existe hasta que llega la respuesta. Aquí el
cliente ya existe, así que el bot genera el enlace **antes** de que llene
nada.

### 4.bis Alternativa: cambios rápidos en Telegram

`/actualizar` ofrecería botones para los campos cerrados: días (1–7),
minutos, objetivo, nivel y equipamiento. El cliente toca y listo, sin
formulario.

| | Formulario (recomendada) | Botones en Telegram |
|---|---|---|
| Campos que cubre | Todos | Solo los de opciones cerradas |
| Lesiones y salud | En Tally, como la primera vez | Fuera: seguirían necesitando el formulario |
| Esfuerzo del cliente | Llena todo otra vez | Dos toques |
| Código nuevo | Enlace, token y ajuste de la ingesta | Un editor de evaluación con sus validaciones duplicadas |
| Depende de Ana | Añadir un campo oculto en Tally | Conocer las opciones exactas del formulario |

Se puede añadir más adelante **encima** de la recomendada, para los tres
campos que más cambian, si el uso real lo pide.

## 5. Alcance

**Incluye:**
- `/actualizar` para el cliente, y su línea en la ayuda del cliente
  (SPEC-023).
- **📝 Pedir actualización** en la ficha del entrenador (D3), que manda el
  mismo mensaje al cliente.
- El token de actualización: creación, un solo uso, vencimiento.
- La ingesta: con token válido, evaluación nueva para el cliente existente.
- El aviso al entrenador con **qué campos cambiaron**, y el acuse al cliente.

**No incluye:**
- Prellenar el formulario con las respuestas anteriores (§11).
- Los cambios rápidos por botones (§4.bis).
- Que el entrenador edite la evaluación directamente.
- Regenerar la rutina automáticamente. **Nunca** (principio 1).

## 6. Reglas de negocio

1. **Solo un cliente vinculado puede pedir su enlace.** `/actualizar` resuelve
   la identidad por Telegram (SPEC-009). Un cliente sin vincular no puede
   escribir el comando, así que no hay caso que atender.
2. **El enlace es personal.** Lleva un token atado a **ese** `client_id`. La
   evaluación que llegue con él se asigna a ese cliente, diga lo que diga el
   nombre escrito en el formulario.
3. **El entrenador puede pedirla** desde la ficha (`/cliente <nombre>`), con
   el botón **📝 Pedir actualización**. El bot le manda al cliente el mismo
   mensaje de `/actualizar`. Si el cliente no está vinculado, se le avisa al
   entrenador y no se manda nada (no hay a quién).
4. **Un solo uso, 7 días.** Al consumirse o vencer, el token deja de valer.
   Pedir otro enlace invalida el anterior: solo hay uno vivo por cliente.
5. **La rutina vigente no cambia.** Una versión en `SENT` sigue siendo la del
   cliente, con sus check-ins, hasta que el entrenador envíe otra.
6. **El plan pasa a apuntar a la evaluación nueva** (D2). Las anteriores
   **no se borran**: quedan en `assessments`, con su fecha. Las próximas
   versiones —IA, plantilla o a mano— se preparan y se validan contra los
   datos nuevos. «📄 Ver evaluación» muestra la vigente.
7. **Un borrador abierto se valida contra los datos nuevos al aprobar.** Si
   el cliente pasó de 3 a 2 días y hay un borrador de 3, aprobarlo falla con
   el error de siempre de `validateDraft`. Es lo correcto: no se debe enviar
   una rutina hecha para datos que ya no valen. El aviso al entrenador lo
   anticipa: *«Tienes un borrador para Carlos hecho con los datos
   anteriores.»*
8. **El aviso dice qué campos cambiaron, no su contenido sensible.** Para
   días, minutos, objetivo, nivel y equipamiento muestra antes → después.
   Para salud (limitaciones, medicamentos, lesiones) solo nombra el campo:
   *«limitaciones»*. El detalle está en «📄 Ver evaluación», igual que el
   aviso de evaluación nueva, que es un resumen a propósito (SPEC-015 §1). Esto **no** es el
   «diffing entre versiones» que CLAUDE.md excluye: no compara rutinas, sino
   dos envíos de un formulario, campo por campo.
9. **Sin cambios, se dice.** Si el cliente envía el formulario con las mismas
   respuestas, el aviso dice *«no cambió ningún dato»* y no ofrece «Crear
   v2».
10. **Sin token, todo sigue como hoy** (SPEC-001). Un envío normal crea un
    cliente nuevo.

## 7. Estados

**Ninguno nuevo, y ninguna transición nueva.** La evaluación no tiene
estados. «✏️ Crear v2» es la acción `revise` que ya existe (SPEC-010), con su
propia autorización. `DRAFT → SENT` sigue sin existir.

## 8. Errores

| Situación | Efecto |
|---|---|
| Token vencido, usado o inventado | **Se procesa como un envío normal** (regla 10): cliente nuevo, y el aviso al entrenador lleva una línea *«⚠️ Llegó con un enlace de actualización que ya no vale. Puede ser un cliente que ya tienes.»* No se pierde el dato y no se fusiona nada a ciegas |
| El cliente pide `/actualizar` dos veces | El segundo enlace invalida el primero (regla 4) |
| 📝 Pedir actualización sobre un cliente sin vincular | Al entrenador: *«Carlos todavía no está vinculado al bot. Mándale primero su enlace (🔗).»* |
| El formulario llega sin el campo oculto configurado en Tally | Es un envío normal. Por eso el paso manual de Ana (§12) es parte del DoD |
| Falla guardar la evaluación nueva | Mismo manejo que SPEC-001: el evento queda guardado, se avisa al entrenador |

## 9. Seguridad

- **El token es una credencial:** permite reescribir la evaluación de un
  cliente, datos de salud incluidos. Nunca va a los logs, ni siquiera al
  rechazarlo (igual que el `link_token`, SPEC-009).
- **Se guarda su hash, no el token.** La base guarda `sha256(token)`. Si se
  filtra la tabla, los enlaces vivos no se pueden reconstruir.
- **Entropía:** 32 bytes aleatorios, en base64url.
- **La firma de Tally se verifica antes de mirar el token** (SPEC-001). Sin
  firma válida no se lee nada.
- **Un token de un cliente nunca escribe en otro:** el `client_id` sale del
  hash, no de ningún campo del formulario.
- **Los dos caminos de `/actualizar` pasan por `authorization.ts`:** el
  cliente solo pide el suyo, y el botón del entrenador comprueba que el
  cliente sea de su cartera (`canManageClient`).
- **El aviso no expone datos de salud** (regla 8).

## 10. Criterios de aceptación

- **CA-1** — DADO un cliente vinculado, CUANDO escribe `/actualizar`,
  ENTONCES recibe un enlace de Tally con `?update=<token>`, y en la base queda
  el hash de ese token con vencimiento a 7 días.
- **CA-2** — DADO un envío de Tally con un token válido, CUANDO llega,
  ENTONCES se crea una evaluación para **ese** cliente, **no** se crea ningún
  cliente, el plan apunta a la evaluación nueva y el token queda consumido.
- **CA-3** — DADO ese mismo envío, CUANDO se procesa, ENTONCES la versión en
  `SENT` no cambia (ni estado ni contenido).
- **CA-4** — DADO un cliente que pasó de 3 a 2 días y de 60 a 45 minutos,
  CUANDO llega su actualización, ENTONCES el entrenador recibe
  *«días (3 → 2) · minutos (60 → 45)»* con los botones 📄 y ✏️ Crear v2.
- **CA-5** — DADO un cambio en limitaciones, CUANDO se avisa al entrenador,
  ENTONCES el aviso dice *«limitaciones»* y **no** incluye su texto.
- **CA-6** — DADO un token vencido, usado o inventado, CUANDO llega el envío,
  ENTONCES se procesa como un cliente nuevo y el aviso lleva la línea de ⚠️.
- **CA-7** — DADO dos `/actualizar` seguidos, CUANDO llega un envío con el
  primer token, ENTONCES se trata como vencido (CA-6).
- **CA-8** — DADO un borrador de 3 días abierto, CUANDO llega una
  actualización a 2 días, ENTONCES el aviso lo menciona, y aprobar ese
  borrador falla en `validateDraft`.
- **CA-9** — DADO el entrenador que pulsa 📝 Pedir actualización sobre un
  cliente de **otro** entrenador (callback fabricado), CUANDO llega, ENTONCES
  no se crea ningún token ni se manda nada.
- **CA-10** — DADO un envío sin cambios, CUANDO llega, ENTONCES el aviso dice
  que no cambió nada y no ofrece ✏️ Crear v2.
- **CA-11** — DADO cualquiera de estos flujos, CUANDO se revisan los logs,
  ENTONCES el token no aparece en ninguno.

## 11. Fuera de alcance, para después

- **Prellenar el formulario** con las respuestas anteriores. Tally puede
  recibir valores por la URL, pero depende de cómo esté armado cada campo y
  pondría datos de salud en una URL. Merece su propia decisión.
- **Cambios rápidos por botones** (§4.bis).
- **Historial de evaluaciones** visible en Telegram. Los datos quedan
  guardados (regla 6); mostrarlos es de SPEC-021.

## 12. Lo que Ana tiene que hacer en Tally

1. Añadir al formulario un **campo oculto** llamado `update`.
2. Pasar el enlace público del formulario (`https://tally.so/r/...`). Hoy el
   bot no lo conoce: nunca lo necesitó, porque el primer enlace lo manda el
   entrenador por WhatsApp. Va como variable de entorno `TALLY_FORM_URL`,
   **no** como secreto: es público y no da acceso a nada.

Sin el paso 1, todo envío con enlace se procesaría como un cliente nuevo
(§8). Por eso está en la Definition of Done.

## 13. Tests

| Nivel | Caso |
|---|---|
| Unit | Generar el token: longitud, alfabeto base64url, dos seguidos distintos |
| Unit | Qué cambió: campos cerrados con antes → después, salud solo por nombre, sin cambios (CA-4, CA-5, CA-10) |
| Unit | `/actualizar` en el router del cliente, y su línea en la ayuda |
| Unit | 📝 Pedir actualización: dueño, ajeno (CA-9), sin vincular |
| Unit | La ingesta con token válido, vencido, usado e inventado (CA-2, CA-6, CA-7) |
| Integration | La función SQL que consume el token: un solo uso bajo concurrencia, vencimiento, hash |
| Integration | CA-2 y CA-3 contra la base real |
| Integration | CA-9 en `security.test.ts` |
| E2E | `/actualizar` → envío de Tally → aviso al entrenador → ✏️ Crear v2 → v2 validada con los días nuevos (CA-8) |

## 14. Archivos que toca

```
supabase/migrations/00XX_assessment_update_tokens.sql   tabla + funciones
supabase/functions/_core/assessment/update-token.ts     generar y validar forma
supabase/functions/_core/assessment/changes.ts          qué campos cambiaron
supabase/functions/_core/tally/webhook.ts               la rama con token
supabase/functions/_core/commands/router.ts             /actualizar
supabase/functions/_core/commands/format.ts             botón en la ficha, ayuda
supabase/functions/_core/telegram/callback-data.ts      acción nueva
supabase/functions/_core/telegram/webhook.ts            el enrutado
supabase/functions/_shared/db.ts                        el adaptador
docs/SECURITY.md                                        el token nuevo
docs/DEPLOY.md                                          TALLY_FORM_URL y el campo oculto
```
