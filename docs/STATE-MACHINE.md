# TrainerFlow — Máquina de estados

> Documentada antes de implementarse, como exige el punto §10 de las decisiones
> de arquitectura. La implementación vive en `_core/domain/state-machine.ts`
> y es una función pura sin dependencias.

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
```

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
