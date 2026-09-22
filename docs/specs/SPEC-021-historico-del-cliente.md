# SPEC-021 — Histórico del cliente

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR — pendiente de que Ana la apruebe |
| **Depende de** | SPEC-006, SPEC-007, SPEC-010 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que el entrenador vea **la película, no la foto**: cómo le ha ido a un cliente
semana a semana, qué pidió cambiar, y qué de todo eso merece su atención hoy.

## 2. El problema

`/cliente Carlos` muestra el último check-in:

```
👤 Carlos Pérez
📋 Rutina v2 — enviada hace 12 días
📊 Último check-in: semana 2 — 3/4 sesiones · 💪 Bien
```

Con eso no se decide nada. «3/4 y Bien» significa una cosa si viene de 4/4 y
otra muy distinta si viene de 2/4. **La tendencia es el dato, y no se ve.**

Y la información está toda guardada desde el primer día:

| Tabla | Qué guarda | Quién la llena |
|---|---|---|
| `checkins` | Semana, sesiones, sensación, molestias | El cron, cada lunes |
| `change_requests` | Motivo del cambio y comentario | El botón del cliente |
| `workout_versions` | Cada versión, su estado, cuándo se envió | El sistema |
| `plan_events` | Toda transición, con actor y hora | Las propias funciones SQL |

No falta ningún dato. Falta la vista.

## 3. La decisión de diseño

### 3.1 Las señales no hacen nada

El histórico calcula cosas como «dos semanas seguidas en Fácil». Es tentador
que eso dispare algo: un aviso, una versión nueva, un mensaje al cliente.

**No dispara nada.** Se muestran cuando el entrenador pide el histórico, y ahí
se acaban. Son una lectura, no una acción.

La razón es la primera regla del proyecto: la IA —y el sistema— proponen, el
entrenador decide. Una señal que manda un mensaje sola es el sistema decidiendo
que algo merece interrumpir a alguien.

> La única excepción ya existe y es deliberada: una molestia reportada avisa al
> entrenador de inmediato (SPEC-006, regla 7). Eso es seguridad, no
> planificación.

### 3.2 El cálculo vive en `_core`, no en SQL

La consulta trae filas. **Quién decide que tres semanas son «un bloque largo»
es lógica de negocio**, y va en `_core` como función pura, con sus tests.

Metida en SQL sería invisible, intestable desde Node y estaría a un `CASE WHEN`
de convertirse en la regla que nadie encuentra cuando hay que cambiarla.

### 3.3 Los umbrales son provisionales, y lo dicen

¿Dos semanas en «Fácil» o tres? Hoy no se sabe: no hay ni un cliente real. Los
umbrales viven en **una constante, en un solo sitio, con su razón escrita al
lado**, para moverlos sin cazarlos por el código.

## 4. Alcance

**Incluye:**
- `/historial <nombre>`, solo para el entrenador y solo sobre **sus** clientes
- Las semanas con sus respuestas, en orden
- Las solicitudes de cambio, con motivo y en qué versión cayeron
- Las señales calculadas (§6)
- Paginación: las últimas 8 semanas, diciendo cuántas hay en total

**No incluye:**
- Gráficas, PNG o exportación. Es texto en Telegram
- El peso que el cliente levantó — descartado en SPEC-020 §3.2
- Que las señales manden nada por su cuenta (§3.1)
- Cambiar algo desde el histórico. **Es solo lectura**
- Histórico para el cliente. Él ve su rutina, no su expediente

## 5. Contratos

### Entrada

```
/historial Carlos
```

Búsqueda por nombre igual que `/cliente`: coincidencia parcial, sin distinguir
mayúsculas ni acentos. Reutiliza `matchClientName` de SPEC-007 — mismo
comportamiento ante ambigüedad, sin una segunda forma de buscar.

### Salida

```
📈 Carlos Pérez — historial

Rutina v2 · enviada hace 26 días · va por la semana 4

Semana 1   4/4   💪 Bien
Semana 2   3/4   💪 Bien
Semana 3   4/4   😌 Fácil
Semana 4   4/4   😌 Fácil

✏️ Semana 2 — pidió cambio: «Muy larga»
   → v2 generada y enviada el 14/09

⚡ 2 semanas seguidas en «Fácil» — puede tocar subir
⚡ 4 semanas con la misma rutina
```

Una semana sin responder sale como tal, nunca se inventa ni se salta:

```
Semana 5   —     sin responder
```

### Tipos

```typescript
/** Una semana, ya resuelta a lo que se muestra. */
export interface HistoryWeek {
  readonly weekNumber: number;
  readonly sessions: number | null;
  readonly feeling: Feeling | null;
  readonly discomfort: string | null;
  readonly answered: boolean;
}

export interface HistoryChange {
  readonly weekNumber: number | null;
  readonly reason: string;
  readonly resultingVersion: number | null;
  readonly createdAt: string;
}

export interface ClientHistory {
  readonly clientName: string;
  readonly currentVersion: number;
  readonly sentAt: string | null;
  readonly currentWeek: number | null;
  readonly weeks: readonly HistoryWeek[];
  readonly totalWeeks: number;
  readonly changes: readonly HistoryChange[];
}

export type SignalKind =
  | 'TOO_EASY'
  | 'TOO_HARD'
  | 'ADHERENCE_FALLING'
  | 'LONG_BLOCK'
  | 'NOT_ANSWERING';

export interface Signal {
  readonly kind: SignalKind;
  /** Con qué dato se disparó. El entrenador lee esto, no el `kind`. */
  readonly detail: string;
}

/** Función PURA. Sin I/O, sin fechas de sistema: todo entra por parámetro. */
export function detectSignals(history: ClientHistory): readonly Signal[];
```

### La consulta

Una función SQL nueva, `client_history(p_client_id uuid)`, en
`0022_client_history.sql`. Devuelve filas; **no calcula ninguna señal.**

## 6. Las señales

| Señal | Se dispara cuando | Umbral |
|---|---|---|
| `TOO_EASY` | Las últimas semanas **respondidas** dicen «Fácil» | 2 |
| `TOO_HARD` | Las últimas semanas respondidas dicen «Muy duro» | 2 |
| `ADHERENCE_FALLING` | Las sesiones bajan en semanas consecutivas | 2 bajadas |
| `LONG_BLOCK` | Semanas sobre la misma versión | 6 |
| `NOT_ANSWERING` | Check-ins seguidos sin contestar | 2 |

```typescript
/**
 * Los umbrales, en un solo sitio.
 *
 * PROVISIONALES: salieron de una conversación, no de datos. Se revisan
 * cuando haya dos meses de uso real, y por eso están aquí y no repartidos
 * por el código.
 */
export const SIGNAL_THRESHOLDS = {
  sameFeelingWeeks: 2,
  adherenceDrops: 2,
  longBlockWeeks: 6,
  unansweredCheckins: 2,
} as const;
```

**`ADHERENCE_FALLING` es la que más vale.** Cuando alguien pasa de 4 sesiones a
2 todavía se puede hacer algo; cuando deja de contestar, ya se fue.

## 7. Reglas de negocio

1. **Solo el entrenador**, y **solo sobre sus propios clientes.** Un
   `client_id` ajeno responde como si no existiera (SPEC-013).
2. Un cliente sin check-ins no es un error: sale su rutina y «sin check-ins
   todavía».
3. Las semanas salen **en orden ascendente**, incluidas las no contestadas.
4. Se muestran las **últimas 8**. Si hay más, una línea lo dice.
5. Las señales se calculan **solo sobre semanas contestadas**. Una sin
   responder no cuenta como «Fácil» ni rompe una racha — solo alimenta
   `NOT_ANSWERING`.
6. Sin señales, no se escribe nada. **Ni «todo en orden»**: una sección vacía
   enseña a ignorar la sección.
7. Las señales **no disparan nada** (§3.1).
8. El cálculo es una función pura en `_core`. La consulta no decide nada.
9. `/historial` sin nombre responde con el uso, no con la lista entera.
10. Es **solo lectura**: ningún botón de acción en este mensaje.

## 8. Estados

**Ninguno.** No toca `version_state` ni `checkins.state`. No escribe nada.

## 9. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| Nombre que no existe | «No encuentro a nadie con ese nombre» | Nada |
| Nombre ambiguo | La lista de coincidencias, igual que `/cliente` | Nada |
| Cliente de otro entrenador | **Igual que si no existiera** | Nada, y se registra |
| Cliente sin rutina enviada | Su ficha y «todavía no tiene rutina enviada» | Nada |
| Cliente sin check-ins | Su rutina y «sin check-ins todavía» | Nada |
| Lo envía un cliente | `/ayuda`, **sin tocar la base** (SPEC-007 regla 1) | Nada |

## 10. Seguridad

- Comando exclusivo del entrenador, verificado **antes** de consultar nada.
- La consulta filtra por `trainer_id`: la autorización no depende de que el
  formateador se acuerde de mirar.
- El texto libre de una molestia se escapa como todo lo demás (MarkdownV2).
- **No se loguea el contenido**: ni molestias, ni comentarios de cambios. Son
  datos de salud (SECURITY.md).

## 11. Criterios de aceptación

- **CA-1** — DADO un cliente con 4 check-ins contestados, CUANDO el entrenador
  envía `/historial Carlos`, ENTONCES salen las 4 semanas en orden.
- **CA-2** — DADO un cliente con 12 semanas, CUANDO se pide el histórico,
  ENTONCES salen las últimas 8 y una línea dice que hay 12.
- **CA-3** — DADO que las semanas 3 y 4 son «Fácil», CUANDO se calculan las
  señales, ENTONCES aparece `TOO_EASY`.
- **CA-4** — DADO semanas «Fácil», **sin responder**, «Fácil», CUANDO se
  calculan, ENTONCES `TOO_EASY` **igual aparece**: la no contestada no rompe
  la racha (regla 5).
- **CA-5** — DADO sesiones 4 → 3 → 2, CUANDO se calculan, ENTONCES aparece
  `ADHERENCE_FALLING`.
- **CA-6** — DADO un cliente al día y cómodo, CUANDO se pide el histórico,
  ENTONCES **no hay sección de señales**, ni vacía ni con «todo bien».
- **CA-7** — DADO el `client_id` de un cliente de otro entrenador, CUANDO se
  pide su histórico, ENTONCES responde como si no existiera y **no se filtra
  ni el nombre**.
- **CA-8** — DADO un cliente que envía `/historial`, CUANDO llega, ENTONCES
  recibe `/ayuda` y **ninguna consulta toca la base**.
- **CA-9** — DADO un cliente sin check-ins, CUANDO se pide, ENTONCES sale su
  rutina y el aviso, no un mensaje vacío ni un error.
- **CA-10** — DADO dos check-ins seguidos sin contestar, CUANDO se calculan,
  ENTONCES aparece `NOT_ANSWERING`.

## 12. Tests

| Nivel | Caso |
|---|---|
| Unit | `detectSignals`: las cinco, cada una en su umbral y justo por debajo |
| Unit | `detectSignals` con semanas sin responder intercaladas (CA-4) |
| Unit | `detectSignals` sin nada que decir devuelve lista vacía |
| Unit | Formateo: con señales, sin señales, sin check-ins, con paginación |
| Unit | `parseCommand` reconoce `/historial` con y sin argumento |
| Unit | `/historial` de un cliente → `/ayuda`, sin tocar puertos |
| Integration | `client_history` devuelve las semanas en orden, huecos incluidos |
| Integration | `client_history` de un cliente ajeno devuelve cero filas (CA-7) |
| E2E | Check-in respondido → `/historial` lo muestra |

## 13. Archivos que toca

```
supabase/functions/_core/history/signals.ts        detectSignals, los umbrales
supabase/functions/_core/history/format.ts         el mensaje
supabase/functions/_core/commands/router.ts        + /historial
supabase/functions/_core/ports/query-ports.ts      + findClientHistory
supabase/functions/_shared/db.ts                   el adaptador
supabase/migrations/0022_client_history.sql        la consulta
docs/specs/SPEC-007-comandos-telegram.md           + el comando en su lista
```

## 14. Cómo encaja con SPEC-020

Son las dos mitades del mismo ciclo, y ninguna sustituye a la otra:

```
SPEC-020  →  le dice al CLIENTE cuándo subir el peso
              dentro de la misma rutina, semana a semana

SPEC-021  →  le dice al ENTRENADOR cuándo cambiar la rutina
              cuándo se agotó el bloque y toca otro
```

Sin la primera, el cliente repite el mismo peso hasta que el estímulo se apaga.
Sin la segunda, el entrenador decide a ciegas cuándo renovar — o no decide, y
el cliente sigue con una rutina que ya no le sirve.

**Se pueden implementar en cualquier orden.** No comparten código: SPEC-020
toca el modelo del `Workout`, SPEC-021 solo lee lo que ya existe.
