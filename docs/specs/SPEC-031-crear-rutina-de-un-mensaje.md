# SPEC-031 — `/crear_rutina <cliente>`, de un solo mensaje

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-007, SPEC-008, SPEC-010, SPEC-022 |
| **Sesiones** | S-XX |

## 1. Objetivo

Que el entrenador pueda crear la rutina de un cliente **sin pasar antes por
su ficha**: nombrarlo y dictarla en el mismo mensaje.

## 2. El problema, en sus palabras

> *«Como cliente Carlos debería poder crear\_rutina por cliente de un solo.»*

Hoy son tres pasos, cada uno un mensaje distinto:

```
/cliente Carlos          → abre la ficha
(pulsar ✍️ o 📋)          → nace el borrador vacío
/crear_rutina             → recién aquí se dicta
Día 1: Empuje
...
```

Para el caso más común —un cliente ya identificado, rutina dictada de
corrido— eso es fricción sin ninguna decisión real de por medio: no hay nada
que el botón ✍️ pregunte que el propio mensaje no diga ya.

## 3. La decisión de diseño

### 3.1 El nombre va en la primera línea, la rutina debajo

```
/crear_rutina Carlos
Día 1: Empuje
Press banca 4x8 90

Día 2: Tirón
Dominadas 4x6 120
```

Mismo formato de SPEC-022 (§5), con **una línea más encima**: el nombre del
cliente, tal como se escribe en `/cliente <nombre>`.

### 3.2 Es el mismo comando, no uno nuevo

`/crear_rutina` ya existe y ya está en el menú del entrenador. Añadir
`/crear_rutina_para` u otro nombre sería un segundo comando que aprender para
el mismo verbo. En su lugar, **`/crear_rutina` reconoce el patrón**:

> Primera línea que **no** es una cabecera de día (`Día N…`) **y** coincide
> con exactamente un cliente de la cartera **y** hay algo más debajo.

Si el patrón no se da, el comando sigue exactamente como hoy: la primera
línea (y todo lo demás) se trata como cuerpo de la rutina, sobre el borrador
en curso (`currentDraft`). **Nada de lo que ya funciona cambia.**

### 3.3 Por qué es seguro caer al comportamiento de hoy cuando el nombre no matchea

Si la primera línea no coincide con ningún cliente, el mensaje **completo**
—incluida esa línea— se manda al parser de siempre (`parseWorkoutText`). Una
línea que no es "Día N…" y aparece antes de cualquier día ya tiene su propio
error (SPEC-022 §8: *"antes del primer ejercicio hace falta un día"*). No hay
forma de que un nombre mal escrito se cuele en el borrador de OTRO cliente:
o hace matching, o el parser lo rechaza con el error de siempre.

### 3.4 Qué pasa según el estado de la rutina vigente del cliente

Este es el punto que hace falta cubrir entero, porque `/crear_rutina` sin
nombre siempre actuaba sobre un borrador que YA existía. Con el nombre, el
comando tiene que decidir sobre una versión que puede estar en cualquiera de
los 6 estados:

| Estado vigente | Qué hace el comando |
|---|---|
| **Sin versión** (cliente sin evaluación todavía) | Rechaza: no hay nada que llenar. |
| `NEW` | Llena esa versión con lo dictado. Pasa a `DRAFT`. Igual que ✍️ + dictar, en un paso. |
| `DRAFT` | **Reemplaza** su contenido con lo dictado — mismo `setDays` de SPEC-022: quien dicta de nuevo quiere empezar de cero, no acumular. |
| `GENERATING` | Rechaza: la IA está trabajando. Mismo mensaje que ya existe (`creation/flows.ts`). |
| `APPROVED` | Rechaza: ya está lista para enviarse, editarla a ciegas invalidaría la aprobación. Mismo mensaje que ya existe. |
| `SENT` o `REJECTED` | **Crea la v2 automáticamente** (equivalente a pulsar ✏️ Crear v2) y la llena con lo dictado, en el mismo paso. |

La fila que decide todo lo demás es la última. Ya está establecido (y
confirmado con Ana) que **el entrenador no depende de que el cliente pida un
cambio para crear una v2**: el botón ✏️ está disponible en la ficha de
cualquier rutina `SENT`/`REJECTED` en todo momento. Si el entrenador escribe
`/crear_rutina Carlos` con una rutina nueva completa, eso ES la decisión
explícita de revisar — no hace falta pedírsela dos veces.

La solicitud de cambio abierta, si la hay, **sigue abierta** hasta que la v2
se envíe (regla ya vigente de SPEC-030 regla 12): crear la v2 no la cierra.

### 3.5 Nombre encontrado, pero sin nada debajo

`/crear_rutina Carlos` solo, sin días. En vez del error genérico de
"renglón 1 no es un día", se confirma a quién encontró y se pide la rutina:

```
Encontré a Carlos. Escribe los días DEBAJO, en el mismo mensaje:

Día 1: Empuje
Press banca 4x8 90
```

No se toca nada (ni se crea, ni se llena): es el mismo principio de SPEC-008
regla 8, "nada se carga hasta que hay algo con qué".

### 3.6 Nombre ambiguo

Varios clientes contienen lo escrito y ninguno coincide exacto (mismo
`matchClientName` de SPEC-007). Sin botones esta vez: un botón `cli:` solo
abre la ficha, y lo dictado se perdería. Se listan los nombres y se pide
repetir el comando entero con uno más específico:

```
Hay varios clientes que empiezan por "Ana": Ana Pérez, Ana Gómez.
Repite el comando con el nombre completo, por ejemplo:
/crear_rutina Ana Pérez
```

## 4. Alcance

**Incluye:**
- `/crear_rutina <cliente>` seguido de la rutina, en un mensaje
- Los 6 estados de la versión vigente, cada uno con su respuesta
- Creación automática de v2 sobre `SENT`/`REJECTED`
- Ambigüedad de nombre sin perder ni corromper lo dictado

**No incluye:**
- Tocar `/crear_rutina` sin nombre: sigue exactamente igual (SPEC-022)
- Persistir texto dictado en un mensaje anterior para aplicarlo después de
  desambiguar por botón — se pide repetir el comando (§3.6)
- Elegir plantilla o IA desde este atajo: sigue siendo dictado a mano. Para
  plantilla o IA, la ficha (`/cliente <nombre>`) sigue siendo el camino
- Ninguna migración ni cambio de esquema: todos los métodos de los puertos
  que hacen falta ya existen

## 5. Contratos

### Tipos

```typescript
export type QuickCreateOutcome =
  /** La primera línea no es un intento de nombrar a alguien: sigue el flujo de siempre. */
  | { readonly kind: 'not_applicable' }
  | { readonly kind: 'filled'; readonly versionId: string }
  | { readonly kind: 'revised'; readonly versionId: string }
  | { readonly kind: 'named_only' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'rejected'; readonly reason: string };

export function handleQuickCreate(
  args: string,
  trainerId: string,
  chatId: number,
  deps: QuickCreateDeps,
): Promise<QuickCreateOutcome>;
```

### Dónde se engancha

En `telegram/webhook.ts`, un paso nuevo (`intentarCrearRutinaRapida`) corre
ANTES que `editarSiEsEntrenador`: si el comando es `crear_rutina`, prueba
`handleQuickCreate` primero. Si devuelve `not_applicable`, `editor` sigue
exactamente el camino de hoy (`handleEditorCommand`). Ningún otro comando del
editor (`/dia`, `/add`, `/quitar`, `/nota`, `/ver`) pasa por aquí: no tienen
"a quién", son sobre el borrador en curso.

## 6. Reglas de negocio

1. La primera línea es el intento de nombre solo si **no** matchea la
   cabecera de día (`Día N…`). Si la matchea, todo el mensaje sigue el camino
   de siempre.
2. El nombre se resuelve con el mismo `matchClientName` de SPEC-007
   (contiene, sin tildes, exacto gana ambigüedad).
3. Sin match → `not_applicable`: el mensaje entero cae al parser de siempre.
   **No se avisa "cliente no encontrado"**: no hay forma de distinguir un
   nombre mal escrito de una cabecera de día mal escrita, y adivinar sería
   peor que dejar que el error de siempre lo explique.
4. Un match y nada debajo → `named_only`: confirma el nombre, no toca nada.
5. Varios matches → `ambiguous`: lista los nombres, no toca nada, pide
   repetir el comando entero.
6. Un match y algo debajo, pero el algo no parsea → mismo error de SPEC-022
   §8, con el número de renglón contado **desde la línea de la rutina**, no
   desde el nombre.
7. Sin versión vigente para ese cliente → `rejected`, sin tocar nada.
8. `GENERATING` y `APPROVED` → `rejected`, mismo mensaje que ya existe en
   `creation/flows.ts` (`SIGUIENTE_PASO`).
9. `NEW` → se llena con `fillVersion` (fuente `manual`, sin plantilla).
10. `DRAFT` → se **reemplaza** el contenido con `saveDraft`, igual que
    redictar sobre el borrador en curso hoy.
11. `SENT`/`REJECTED` → se crea la v2 (`createRevision`) y se llena esa v2
    con `fillVersion`, en el mismo turno. La respuesta dice que se creó una
    versión nueva y cuál es su número.
12. Ninguna validación completa (`validateDraft`) corre aquí: la puerta
    sigue siendo `/aprobar`, igual que en toda edición (SPEC-008 regla 11).
13. La respuesta, en todos los casos que llenan o reemplazan contenido, es la
    rutina completa con el nombre del cliente — igual que cualquier edición
    (SPEC-022 regla 9).

## 7. Estados

`NEW → DRAFT` (llenar) y la creación de una versión en `NEW` sobre
`SENT`/`REJECTED` (revisión). Las dos transiciones **ya existen**: SPEC-008
para la primera, SPEC-010 para la segunda. Esta spec no añade ningún camino
nuevo hacia ningún estado — solo dos lo alcanzan desde un único mensaje en
vez de una ficha más un botón.

## 8. Errores

| Situación | Respuesta |
|---|---|
| Cliente sin versión todavía | `Carlos todavía no tiene evaluación. Cuando la complete, puedes crear su rutina.` |
| `GENERATING` | El mensaje ya existente de `SIGUIENTE_PASO.GENERATING` |
| `APPROVED` | El mensaje ya existente de `SIGUIENTE_PASO.APPROVED` |
| Nombre ambiguo | Lista de nombres + pedir repetir con uno completo (§3.6) |
| Nombre encontrado, sin días | Confirmación + ejemplo (§3.5) |
| Renglón ilegible | El error de SPEC-022 §8, tal cual |
| Se aprobó/envió entre medias (carrera) | `Esa rutina ya no es un borrador. Tu cambio no se aplicó.` |

## 9. Seguridad

- La lista de clientes contra la que se matchea sale de `clients(trainerId)`,
  ya filtrada por dueño (igual que `/cliente <nombre>`): no hay forma de
  nombrar a un cliente ajeno.
- `createRevision` ya comprobaba pertenencia (SPEC-010): se reutiliza tal
  cual, sin debilitar esa comprobación.
- Solo lo atiende el entrenador — mismo guardián que el resto del editor
  (`editarSiEsEntrenador`, SPEC-007 regla 1).

## 10. Criterios de aceptación

- **CA-1** — DADO un cliente con versión `NEW`, CUANDO se manda
  `/crear_rutina <nombre>` con días válidos, ENTONCES la versión queda
  `DRAFT` con esos días y se devuelve la rutina completa.
- **CA-2** — DADO un cliente con un `DRAFT` ya empezado, CUANDO se manda
  `/crear_rutina <nombre>` con días nuevos, ENTONCES el contenido se
  **reemplaza**, no se acumula.
- **CA-3** — DADO un cliente con versión `SENT`, CUANDO se manda
  `/crear_rutina <nombre>` con días válidos, ENTONCES se crea una v2, queda
  `DRAFT` con esos días, y la solicitud de cambio abierta (si la había) sigue
  abierta.
- **CA-4** — DADO un cliente con versión `REJECTED`, CUANDO se manda
  `/crear_rutina <nombre>`, ENTONCES se comporta igual que CA-3.
- **CA-5** — DADO un cliente con versión `APPROVED` o `GENERATING`, CUANDO se
  manda `/crear_rutina <nombre>`, ENTONCES se rechaza sin tocar nada.
- **CA-6** — DADO un cliente sin ninguna versión, CUANDO se manda
  `/crear_rutina <nombre>`, ENTONCES se rechaza explicando que falta la
  evaluación.
- **CA-7** — DADO dos clientes cuyo nombre contiene lo escrito, sin ninguno
  exacto, CUANDO se manda el comando, ENTONCES no se toca nada y se listan
  los nombres.
- **CA-8** — DADO un nombre que matchea exacto a un solo cliente, aunque haya
  otros que lo contengan, CUANDO se manda el comando, ENTONCES se usa ese.
- **CA-9** — DADO un nombre que no matchea a ningún cliente, CUANDO se manda
  el comando, ENTONCES el mensaje entero sigue el camino de `/crear_rutina`
  de siempre (sobre `currentDraft`, con su propio error o resultado).
- **CA-10** — DADO un nombre que matchea a un solo cliente y nada debajo,
  CUANDO se manda el comando, ENTONCES se confirma el nombre y no se crea ni
  se llena nada.
- **CA-11** — DADO que la primera línea es una cabecera de día (`Día 1…`),
  CUANDO se manda el comando, ENTONCES no se intenta ningún matching de
  nombre, sea cual sea el texto del foco.
- **CA-12** — DADO un nombre válido con un renglón ilegible debajo, CUANDO se
  manda el comando, ENTONCES no se crea ni se llena nada y el error nombra el
  renglón contado desde la rutina, no desde el nombre.

## 11. Tests

| Nivel | Caso |
|---|---|
| Unit | Los 6 estados de la versión vigente, cada uno con su outcome |
| Unit | `not_applicable`: cabecera de día en la primera línea, nombre sin match |
| Unit | Ambiguo: no toca nada, lista los nombres |
| Unit | Exacto gana ambigüedad (reutiliza `matchClientName`, ya cubierto — aquí solo la integración) |
| Unit | Nombre + nada debajo: no toca nada, confirma |
| Unit | `DRAFT` existente: reemplaza, no acumula |
| Unit | `SENT`/`REJECTED`: crea v2 y la llena, en ese orden |
| Unit | Carrera: `fillVersion`/`saveDraft` devuelve `false` |
| Integration | El enganche en `webhook.ts`: `not_applicable` cae a `handleEditorCommand` |
| E2E | Cliente `SENT` → un mensaje → v2 en `DRAFT` con los días dictados |

## 12. Archivos que toca

```
supabase/functions/_core/creation/quick-create.ts       nuevo — handleQuickCreate
supabase/functions/_core/creation/quick-create.test.ts  nuevo
supabase/functions/_core/commands/format.ts              mensaje de ambigüedad sin botones
supabase/functions/_core/creation/flows.ts                exporta SIGUIENTE_PASO (reutilizado)
supabase/functions/_core/telegram/webhook.ts              engancha en editarSiEsEntrenador
supabase/functions/_core/telegram/webhook.test.ts
supabase/functions/_core/editor/bulk.ts                    isDayHeader (nuevo, exportado)
supabase/functions/_core/editor/commands.ts                 withDays (exportado)
docs/specs/SPEC-022-editor-usable.md                        §14, referencia al atajo
```

Sin migraciones. Sin cambios de esquema: `fillVersion`, `saveDraft`,
`createRevision`, `clients`, `clientDetail` y `changes.findVersion` ya
existen tal cual los necesita esta spec.
