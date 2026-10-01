# SPEC-032 — Registro de deuda técnica

| Campo | Valor |
|---|---|
| **Estado** | **ABIERTA** — vive mientras el proyecto tenga deuda pendiente, no se "implementa" de una vez |
| **Depende de** | — |
| **Sesiones** | S-51 (auditoría que originó la primera tanda) |

## 1. Objetivo

Que un hallazgo de deuda técnica tenga un sitio fijo donde vivir —con su
severidad, su archivo y su arreglo propuesto— en vez de quedar suelto en el
historial de una conversación o en un comentario que nadie vuelve a leer.

Esta spec no sigue el ciclo normal de SDD (BORRADOR → APROBADA →
IMPLEMENTADA): no hay un "listo" único. Cada fila es su propia unidad: se
agrega cuando se encuentra algo, se borra cuando se arregla. El `ROADMAP.md`
ya usaba este patrón de forma puntual (ver su sección "Deuda técnica
encontrada auditando el estado (S-49)"); esta spec lo recoge como práctica
fija para que no vuelva a dispersarse.

## 2. Regla de uso

1. **Se agrega una fila cuando se encuentra algo real**, no cualquier gusto
   estético. El criterio: ¿puede hacer que alguien rompa algo sin darse
   cuenta, o cambie una cosa y olvide la otra?
2. **Cada fila lleva dónde está (archivo:línea), qué pasa y qué se propone.**
   Sin eso, la fila no sirve para actuar, solo para recordar que algo
   incomoda.
3. **Se borra al arreglarse**, en el mismo commit que lo arregla. Esta tabla
   describe SOLO lo pendiente — lo resuelto vive en el historial de git y,
   si fue significativo, en el PR que lo cerró.
4. No es una lista de ideas ni de features nuevas. Una sugerencia de producto
   (como "guiar al entrenador con una lista de ejercicios") es una spec
   propia si se decide construir, no una fila aquí.

## 3. Hallazgos abiertos

### 3.1 Duplicación del mapeo SQL→`AIRequest` en `_shared/db.ts`

| | |
|---|---|
| **Severidad** | Alta — hay datos de salud de por medio |
| **Dónde** | `findVersionForGeneration` (líneas ~500-523) y `createEditRepo().findAwaitingEdit` (líneas ~829-851) |
| **Qué pasa** | Los mismos 19 campos, con las mismas conversiones `?? null` / `Number(...)`, escritos dos veces. `AIRequest` ya creció una vez (SPEC-016); un campo nuevo que se agregue en un lado y se olvide en el otro deja el flujo de edición operando con datos de salud incompletos, sin que nada lo marque. |
| **Propuesta** | Extraer `filaToAIRequest(fila, limitations)` en `_shared/db.ts` y llamarla desde ambos sitios. |

### 3.2 Comentario falso en `_shared/db.ts`

| | |
|---|---|
| **Severidad** | Media — no rompe nada, pero engaña a quien lea el código |
| **Dónde** | `_shared/db.ts:509-510` |
| **Qué pasa** | Dice que `chronicConditions` no está cableado porque `AIRequest` no lo tiene; ocho líneas más abajo, el mismo objeto sí lo asigna, y `AIRequest` (`_core/ports/ai-provider.ts:59`) sí lo declara. Resto de un refactor anterior a SPEC-016 que nadie borró. |
| **Propuesta** | Eliminar el comentario. |

### 3.3 `REINTENTABLES` duplicado

| | |
|---|---|
| **Severidad** | Media |
| **Dónde** | `_core/ai/provider-call.ts:16` y `_core/telegram/notify.ts:64` |
| **Qué pasa** | Mismo array (`['API_ERROR', 'TIMEOUT']`), mismo propósito — qué fallo merece el botón "Reintentar". El comentario en `notify.ts` ya reconoce "es la misma lista" pero no la importa. Si la política de reintento cambia en un lugar y no en el otro, el botón deja de corresponder con lo que el sistema realmente reintenta. |
| **Propuesta** | Exportar `REINTENTABLES` desde `provider-call.ts` e importarla en `notify.ts`. |

### 3.4 Tablas de traducción copiadas

| | |
|---|---|
| **Severidad** | Baja-media |
| **Dónde** | `NIVEL` (Level→español) idéntica en `telegram/notify.ts:51-55`, `commands/format.ts:42-46`, `assessment/intake.ts:32-36` y `assessment/changes.ts:31-35`. `SENSACION` (Feeling→emoji) idéntica en `checkin/format.ts:29-33` y `commands/format.ts:48-52`. |
| **Qué pasa** | Es lógica de traducción, no solo texto repetido: corregir una etiqueta exige acordarse de los 4 (o 2) sitios. |
| **Propuesta** | Exportar `LEVEL_LABELS` desde `domain/assessment.ts` y `FEELING_LABELS` desde `checkin/answers.ts` — donde ya viven los tipos `Level`/`Feeling` — e importarlas en los demás. |

### 3.5 El parseo de `callback_data` crece linealmente

| | |
|---|---|
| **Severidad** | Baja hoy, crece con cada prefijo nuevo |
| **Dónde** | `_core/telegram/webhook.ts:325-344` |
| **Qué pasa** | Cada prefijo nuevo (`chk:`, `tpl:`, `chg:`, `cli:`, `nav:`, `act:`) agrega una condición `=== null &&` a la comprobación siguiente; la de `payload` ya encadena cinco. No es incorrecto, pero un séptimo prefijo que no replique el patrón exacto no falla en compilación — falla en runtime, con dos parsers corriendo cuando no debieran. |
| **Propuesta** | Reemplazar por un array de parsers recorrido con `for...of` que se detiene en el primer resultado no nulo. |

### 3.6 Dos specs con el mismo número

| | |
|---|---|
| **Severidad** | Baja — es documentación, no código, pero confunde al buscar |
| **Dónde** | `docs/specs/SPEC-031-navegacion-de-la-rutina.md` y `docs/specs/SPEC-031-crear-rutina-de-un-mensaje.md` |
| **Qué pasa** | Ambas implementadas, ambas con el número 031. Hay referencias cruzadas a "SPEC-031" desde `SPEC-030`, `SPEC-019`, `SPEC-022` y `docs/TESTING.md` que no se revisaron todavía para saber cuál de las dos nombran. |
| **Propuesta** | Renumerar una (la de "crear_rutina de un mensaje" es la candidata, por ser la más reciente de las dos) a un número libre, y actualizar cada referencia cruzada confirmando a cuál apunta antes de cambiarla. |

### 3.7 `ROADMAP.md` describe una versión vieja de SPEC-019

| | |
|---|---|
| **Severidad** | Media — es la única fuente de progreso del proyecto (su propia regla) y hoy desinforma |
| **Dónde** | `docs/ROADMAP.md`, sección "SPEC-019 — la decisión que ya está tomada" (líneas ~189-228) y la fila de SPEC-019 en la tabla "Después del MVP" (línea ~171) |
| **Qué pasa** | Describe la librería `workout-guide` (302 ejercicios) y el diseño de "la IA elige un slug de una lista o `null`". La decisión real, ya implementada, usa RepDB (601 ejercicios) con diccionario ampliado y fallback a búsqueda — sin que la IA elija de una lista cerrada. La spec SPEC-019 en `docs/specs/` ya está actualizada; es solo el ROADMAP el que quedó atrás. |
| **Propuesta** | Reescribir esa sección con la decisión de RepDB, y mover la fila de SPEC-019 de "Después del MVP" (pendiente) a donde corresponda algo ya implementado. |

## 4. Lo que NO es deuda técnica, aunque salió de la misma auditoría

- **Guiar al entrenador con una referencia de ejercicios al editar a mano**:
  es una mejora de producto, no una corrección. Si se decide construir, es
  spec propia.
- El prompt a Gemini no orienta hacia nombres de ejercicio reconocibles por
  el diccionario de RepDB, así que cae al fallback de búsqueda más seguido
  que las plantillas. Tampoco es un bug — el fallback ya es un resultado
  aceptable (SPEC-019 §lo dice explícitamente: "ningún cliente se queda sin
  referencia") — pero es una mejora barata: agregar 3-4 nombres de ejemplo al
  prompt, en el estilo que el diccionario reconoce. Queda anotado aquí para
  no perderlo, pero es una mejora, no deuda.
