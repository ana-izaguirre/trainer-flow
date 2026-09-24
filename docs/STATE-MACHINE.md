# TrainerFlow — Máquina de estados

> Documentada antes de implementarse, como exige el punto §10 de las decisiones
> de arquitectura.
>
> **Estado: implementada** (S-06). `_core/domain/state-machine.ts`, sin
> dependencias, con **cobertura del 100%** y 70 tests: las 11 transiciones
> válidas y **las 43 inválidas**, una por una.
>
> `state-machine.test.ts` copia la tabla de este documento literalmente. Si
> discrepan, **este documento manda**.

## Principio que hace cumplir

**Ninguna rutina llega al cliente sin aprobación explícita del entrenador.**

Esto no es una convención: **la transición `DRAFT → SENT` no existe**. El único
camino a `SENT` sale de `APPROVED`, y a `APPROVED` solo se llega con una acción
del entrenador.

---

## Los 6 estados

El estado pertenece a la **versión** (`workout_versions.state`), no al plan.
Versión y estado son conceptos distintos: `version_number` identifica *cuál*
revisión, `state` dice *en qué etapa* está esa revisión.

| Estado | Significado | ¿Tiene contenido? | Terminal |
|---|---|---|---|
| `NEW` | Creada, sin contenido. Esperando origen | No | No |
| `GENERATING` | La IA está trabajando | No | No |
| `DRAFT` | Contenido listo, en manos del entrenador | Sí | No |
| `APPROVED` | Aprobada, pendiente de entrega | Sí | No |
| `SENT` | Entregada al cliente | Sí | **Sí** |
| `REJECTED` | Descartada | Opcional | **Sí** |

### Qué NO es un estado

| Concepto | Dónde vive |
|---|---|
| "La IA falló" | `ai_generations.status = 'FAILED'` |
| "La IA está generando" (detalle, tokens, latencia) | `ai_generations` |
| "El cliente pidió un cambio" | `change_requests.state = 'OPEN'` |
| "El entrenador está editando" | Transitorio. Editar un `DRAFT` no cambia su estado |
| "Esta es la versión vigente" | `workout_plans.current_version_id` |

Esa separación es el punto §1: **la IA es una capacidad, no la dueña del
dominio.** Su estado no contamina el enum del dominio.

---

## Diagrama

```
                    ┌───────┐
                    │  NEW  │
                    └───┬───┘
          ┌─────────────┼─────────────┐
     GENERATE    LOAD_TEMPLATE   CREATE_MANUAL
          │             │             │
          ▼             └──────┬──────┘
   ┌────────────┐              │
   │ GENERATING │              │
   └──────┬─────┘              │
          │                    │
   ┌──────┴───────┐            │
 OK│              │FAILED      │
   ▼              ▼            ▼
   └──────────► NEW      ┌───────┐
                         │ DRAFT │◄─── EDIT (no cambia estado)
                         └───┬───┘
                   ┌─────────┴─────────┐
                APPROVE             REJECT
                   │                   │
                   ▼                   ▼
            ┌──────────┐         ┌──────────┐
            │ APPROVED │────────►│ REJECTED │
            └─────┬────┘ REJECT  └──────────┘
                  │                terminal
                SEND
            (solo si el cliente
             está vinculado)
                  │
                  ▼
             ┌────────┐
             │  SENT  │  terminal
             └────────┘
```

---

## Tabla de transiciones

**`estado + evento → estado siguiente`.** Esta tabla es la especificación:
la implementación la copia literalmente.

| # | Desde | Evento | Hasta | Actor | Nota |
|---|---|---|---|---|---|
| 1 | `NEW` | `GENERATE` | `GENERATING` | trainer | Solicita generación con IA |
| 2 | `NEW` | `LOAD_TEMPLATE` | `DRAFT` | trainer | Carga una plantilla de `_core/templates.ts` |
| 3 | `NEW` | `CREATE_MANUAL` | `DRAFT` | trainer | Escribe la rutina desde cero |
| 4 | `NEW` | `REJECT` | `REJECTED` | trainer | Descarta antes de empezar |
| 5 | `GENERATING` | `GENERATION_SUCCEEDED` | `DRAFT` | system | El draft pasó la validación |
| 6 | `GENERATING` | `GENERATION_FAILED` | `NEW` | system | Vuelve a `NEW`: el entrenador elige plantilla o manual |
| 7 | `DRAFT` | `EDIT` | `DRAFT` | trainer | **No cambia de estado.** Modifica in-place |
| 8 | `DRAFT` | `APPROVE` | `APPROVED` | trainer | La decisión humana |
| 9 | `DRAFT` | `REJECT` | `REJECTED` | trainer | |
| 10 | `APPROVED` | `SEND` | `SENT` | system | Solo si el cliente está vinculado |
| 11 | `APPROVED` | `REJECT` | `REJECTED` | trainer | Se arrepiente antes de la entrega |

**11 transiciones. Todo lo demás es inválido.**

### La transición 6, explicada

Cuando la IA falla, la versión **vuelve a `NEW`** en vez de morir. El entrenador
recibe el aviso y sigue por plantilla o manual sobre la misma versión.

El motivo del fallo (rate limit, timeout, JSON inválido, días incorrectos) queda
en `ai_generations`, no en el enum del dominio. Así el dominio no sabe nada de
Gemini, que es el punto §1 y §2.

### La transición 7, explicada

Editar un `DRAFT` lo **modifica in-place**. No crea versión ni cambia estado.

Editar algo que ya fue enviado es distinto: **`SENT` es terminal**, así que se
crea una versión nueva. Eso hace cumplir el §7 — *no sobrescribir una rutina ya
publicada*.

---

## Transiciones inválidas obligatorias en los tests

`TESTING.md` exige cobertura del 100%: las 11 válidas **y todas las inválidas**.
Con 6 estados y 8 eventos son 48 combinaciones. Estas son las que importan:

| Transición | Por qué debe fallar |
|---|---|
| **`DRAFT → SENT`** | 🔴 **La crítica.** Saltarse la aprobación humana |
| `NEW → SENT` | Enviar algo sin contenido |
| `NEW → APPROVED` | Aprobar algo que no existe |
| `GENERATING → APPROVED` | Aprobar lo que la IA aún no terminó |
| `GENERATING → SENT` | La IA entregando directo al cliente |
| `SENT → *` | Terminal. Modificar una rutina ya entregada |
| `REJECTED → *` | Terminal |
| `APPROVED → DRAFT` | Volver atrás sin dejar rastro |

---

## El ciclo de solicitud de cambio, sin estados extra

Del punto §8. La versión anterior **permanece intacta**:

```
v1 en SENT
  │
  │  el cliente pide un cambio
  ▼
INSERT en change_requests (state = 'OPEN')
  │  v1 sigue en SENT. No se toca. ✅
  │
  │  el entrenador empieza la revisión   ← la versión se crea AQUÍ, no antes
  ▼
INSERT workout_versions v2 (state = 'NEW')
  │
  ├─ con IA       → GENERATING → DRAFT
  └─ plantilla/manual →           DRAFT
  │
  ▼
v2: DRAFT → APPROVED → SENT
  │
  ├─ workout_plans.current_version_id → v2
  └─ change_requests.state → 'RESOLVED'

v1 queda en SENT, con su contenido original. El historial se conserva.
```

Esto cumple la regla del §8: *"La solicitud de cambio NO debe crear
inmediatamente una versión vacía. La versión nueva se crea cuando realmente
comienza la modificación."*

---

## Implementación

Una función pura, sin dependencias, en `_core/domain/state-machine.ts`:

```typescript
export type VersionState =
  | 'NEW' | 'GENERATING' | 'DRAFT' | 'APPROVED' | 'SENT' | 'REJECTED';

export type VersionEvent =
  | 'GENERATE' | 'LOAD_TEMPLATE' | 'CREATE_MANUAL' | 'EDIT'
  | 'GENERATION_SUCCEEDED' | 'GENERATION_FAILED'
  | 'APPROVE' | 'REJECT' | 'SEND';

const TRANSITIONS: Readonly<
  Record<VersionState, Partial<Record<VersionEvent, VersionState>>>
> = {
  NEW:        { GENERATE: 'GENERATING', LOAD_TEMPLATE: 'DRAFT',
                CREATE_MANUAL: 'DRAFT', REJECT: 'REJECTED' },
  GENERATING: { GENERATION_SUCCEEDED: 'DRAFT', GENERATION_FAILED: 'NEW' },
  DRAFT:      { EDIT: 'DRAFT', APPROVE: 'APPROVED', REJECT: 'REJECTED' },
  APPROVED:   { SEND: 'SENT', REJECT: 'REJECTED' },
  SENT:       {},
  REJECTED:   {},
};

export function nextState(
  from: VersionState,
  event: VersionEvent,
): VersionState | null {
  return TRANSITIONS[from][event] ?? null;
}

/** Un estado terminal no acepta ningún evento. */
export function isTerminal(state: VersionState): boolean;

/** Los eventos válidos desde un estado. Para construir los botones. */
export function allowedEvents(from: VersionState): readonly VersionEvent[];
```

### Tres tests que son el principio de producto, no comportamiento

```typescript
it('DRAFT → SENT NO EXISTE por ningún evento', ...);
it('el ÚNICO camino a SENT sale de APPROVED', ...);
it('la IA no puede llevar una versión más allá de DRAFT', ...);
```

El segundo no comprueba una transición concreta: recorre las 54 combinaciones
y asevera que **solo una** produce `SENT`. Si alguien añadiera un atajo, ese
test lo detecta aunque la transición nueva funcione perfectamente.

### Por qué no XState

| Criterio | Veredicto |
|---|---|
| Qué resuelve XState | Jerarquía, estados paralelos, guardas, actores, servicios |
| Qué tenemos | 6 estados, 11 transiciones, una tabla de consulta |
| Complejidad que añade | Una dependencia en `_core` — **contradice el punto §11** |
| ¿Necesario para el MVP? | No |
| Cuándo reconsiderarlo | Si superamos ~10 estados, o si aparecen guardas y estados paralelos |

El punto §11 dice que el core no debe depender de librerías. Meter XState en
`_core` rompería esa regla por 20 líneas de código que ya están escritas arriba.

---

## Quién la hace cumplir, y quién no

**Esta tabla vive solo en TypeScript.** La base de datos NO valida
transiciones: `apply_version_transition` lo dice en su propio comentario —
*«aplica una transición ya validada por `_core`»*— y lo único que comprueba es
que el estado esperado siga siendo el actual, para no pisar a quien se
adelantó.

Es un *compare-and-swap*, no una máquina de estados.

### Todo el que escriba un estado tiene que consultarla

| Quién escribe | Consulta `nextState` |
|---|---|
| `ai/generate-version.ts` | ✅ |
| `telegram/actions.ts` | ✅ |
| `telegram/delivery.ts` | ✅ |
| `creation/flows.ts` | ✅ **desde S-27** |

`fill_version` escribe `state = 'DRAFT'` sin mirar de dónde viene, y los tres
flujos de creación le pasaban el estado actual como esperado — que siempre
coincide, porque acababan de leerlo. El resultado: `LOAD_TEMPLATE` y
`CREATE_MANUAL`, que según esta tabla **solo salen de `NEW`**, funcionaban
desde cualquier estado.

> El botón vive en un mensaje de Telegram, y los mensajes no caducan. El
> entrenador sube por el chat, encuentra el aviso de hace tres semanas y pulsa
> ✍️: la rutina **ya enviada** se reescribía vacía y volvía a `DRAFT`.

Sin atacante y sin concurrencia. Corregido en S-27.

### Lo que sigue pendiente

Que la regla viva en un solo sitio sigue siendo una garantía de disciplina, no
de construcción: nada impide que un quinto camino vuelva a saltársela.

**Propuesta para una sesión futura:** un trigger en `workout_versions` que
valide `OLD.state → NEW.state` contra estas mismas 11 transiciones, más un test
que recorra los 36 pares de estados y exija que el trigger y `TRANSITIONS`
digan lo mismo. Así `DRAFT → SENT` deja de ser imposible *porque el código no
lo hace* y pasa a ser imposible *porque la base lo rechaza*.

No es gratis: hay un test de esquema que hoy hace `UPDATE … SET state = 'SENT'`
a mano y habría que reescribirlo, y las dos copias de la tabla pueden
desincronizarse si nadie mira el test de acuerdo. Por eso va aparte, con su
spec, y no colado en un arreglo.

---

## Cobertura de salida: qué botón tiene cada estado

**El principio de arriba sigue intacto: la tabla es correcta y tiene
cobertura del 100%, transiciones válidas e inválidas.** Los errores de
septiembre de 2025 —aprobar/rechazar/generar en silencio, un rechazo sin
salida— no salieron de la máquina de estados. Salieron de que **no todo
estado tenía, en producción, alguien capaz de dispararla.**

Son dos problemas distintos, y confundirlos es lo que hacía parecer que
«100% de cobertura y aun así fallan cosas» era una contradicción. No lo es:

| | La máquina de estados | Quién la usa |
|---|---|---|
| Qué es | `_core/domain/state-machine.ts` | Cada botón, cada comando, cada job |
| Cobertura | 100%, las 11 válidas y las 43 inválidas, con test | Ninguna cifra la medía |
| Qué falló | Nada. Nunca falló | Dos huecos distintos, los dos silenciosos |

### Hueco 1 — el mensaje de confirmación se perdía (ya arreglado)

`actions.ts`, `delivery.ts`, `tally/webhook.ts` y `telegram/webhook.ts`
interpolaban `${clientName}` sin `escapeMarkdownV2`. Con un nombre como
«Ana-María» o cualquier signo de puntuación, Telegram rechaza el mensaje
**entero** — no solo el caracter. La transición SÍ ocurría en la base; lo
único que fallaba era avisarlo, así que aprobar, rechazar y generar parecían
no hacer nada.

**Por qué el 100% de cobertura no lo atrapó.** Cada fixture de test usaba
`'Carlos'` como nombre: cero caracteres especiales. La línea con la
interpolación se ejecutaba entera bajo cobertura — lo que faltaba no era
ejecutarla, era que escapara lo que llevaba dentro. **Cobertura mide que una
línea CORRIÓ, no que sea correcta para cualquier entrada real.**

**Arreglo:** PR #57 y #58 (`escapeMarkdownV2` en los cuatro archivos) + los
fixtures de nombre en todos los tests que tocan Telegram pasaron a
`'Ana-María Ruiz'`, para que un caracter sin escapar vuelva a hacer fallar un
test si reaparece en un mensaje nuevo.

### Hueco 2 — cuatro estados no tenían ningún botón de vuelta

La tarjeta original (con sus tres o cuatro botones) es un mensaje de
Telegram, y los mensajes se pierden en el scroll. Si esa tarjeta ya no está
a la vista: `/cliente <nombre>` mostraba el estado **como texto**, sin
ningún botón —ni uno, en ningún estado, hasta este cambio— y `/pendientes`
**solo lista `DRAFT`** (`trainer_pending_versions`, migración 0011). Estos
cuatro estados se quedaban sin ningún camino de vuelta:

| Estado | Cómo se quedaba atascado | Único rastro que quedaba |
|---|---|---|
| `NEW` | La tarjeta original se perdió en el chat | Nada: ni `/pendientes` ni `/cliente` ofrecían un botón |
| `GENERATING` | La función murió antes de que su propio manejo de errores pudiera devolver el estado a `NEW` (`_core/ai/generate-version.ts`: si algo revienta antes de llegar a `aplicar(…, 'GENERATION_FAILED')`, esa línea nunca corre) | El RUNBOOK ya lo nombraba: «se murió a medias» |
| `SENT` | `startRevision` (crear v2) solo es alcanzable desde el botón que acompaña a una solicitud de cambio DEL CLIENTE. Si el entrenador quiere adelantarse, no había botón | El mensaje de «pedir un cambio» — y solo si el cliente lo manda |
| `REJECTED` | El propio mensaje de rechazo dice *«Puedes empezar otra»* — y hasta este cambio, **era falso**: cero código lo permitía | Ninguno |

**Por qué el 100% de cobertura tampoco atrapó esto.** No hay ninguna línea
incorrecta que cubrir: `nextState('REJECTED', cualquier_evento)` devuelve
`null`, correctamente, con test. El hueco no está en una función — está en
que **ninguna función llama** a la que arreglaría esto. Cobertura mide las
líneas que el código tiene, no las que le faltan.

**Arreglo (S-49):** `/cliente <nombre>` pasa a llevar teclado, condicionado
al estado de la versión vigente (`_core/commands/format.ts`,
`keyboardForDetail`):

| Estado | Botones en la ficha |
|---|---|
| `NEW` | Los mismos cuatro orígenes de la tarjeta original: Ver evaluación, IA, Plantilla, A mano |
| `GENERATING` | Solo Ver evaluación — no hay nada más que hacer mientras trabaja |
| `DRAFT` | Aprobar, Rechazar, Ver evaluación *(no «Editar»: ver nota abajo)* |
| `APPROVED` | Rechazar, Ver evaluación *(no «crear v2»: ver nota abajo)* |
| `SENT` | **Crear v2**, Ver evaluación |
| `REJECTED` | **Crear v2**, Ver evaluación |

**Por qué `APPROVED` no ofrece «crear v2».** `startRevision` no comprueba el
estado de la versión: mueve `current_version_id` a la v2 sin condición
(SPEC-010). Desde `SENT` o `REJECTED` eso es exactamente lo que ya hace hoy,
en producción, el flujo de «pedir un cambio». Desde `APPROVED` sería un
camino nuevo, nunca ejercitado: la v1 sigue esperando que el cliente se
vincule para recibirla, y la v2 vacía se volvería la vigente antes de que la
v1 le llegara a nadie. Es exactamente el tipo de atajo que este documento
existe para prohibir, así que no se ofrece hasta que alguien lo decida con
su propia spec.

**Por qué ningún estado ofrece «Editar».** No es un descuido: ese botón ya
existe en `/pendientes` desde SPEC-004 y hoy no hace nada — cae en «Eso
todavía no está listo», porque el flujo conversacional de edición sigue sin
construirse (SPEC-004 sigue **PARCIAL**). Repetirlo en la ficha nueva sería
fabricar un segundo botón muerto en vez de arreglar el primero. Queda
anotado en `ROADMAP.md` como su propio arreglo.

### Lo que sigue sin botón: `GENERATING` atascada de verdad

El arreglo de arriba ofrece «Ver evaluación» sobre una `GENERATING`, pero no
un botón para forzarla de vuelta a `NEW`. Hacerlo bien exige una ventana de
tiempo (¿cuánto es «atascada» contra «todavía trabajando»?) y una guarda
contra la carrera con una generación que sí estuviera a punto de terminar:
forzar el estado a `NEW` un segundo antes de que la generación real llegara
a `aplicar(…, 'GENERATION_SUCCEEDED')` pisaría un `DRAFT` bueno con un `NEW`
vacío. Es un arreglo real, no cosmético, y por eso tiene su propia entrada
en `ROADMAP.md` en vez de colarse aquí. Mientras tanto, el desatasco manual
está en `RUNBOOK.md`.
