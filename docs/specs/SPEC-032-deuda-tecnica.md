# SPEC-032 — Registro de deuda técnica

| Campo | Valor |
|---|---|
| **Estado** | **ABIERTA** — vive mientras el proyecto tenga deuda pendiente, no se "implementa" de una vez |
| **Depende de** | — |
| **Sesiones** | S-51 (auditoría que originó la primera tanda), S-52 (cerró §3.1-3.5 de la primera tanda) |

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

### 3.1 Dos specs con el mismo número — alcance real, mayor de lo que parecía

| | |
|---|---|
| **Severidad** | Baja funcionalmente (es documentación, nada de esto cambia comportamiento), pero el VOLUMEN la saca de "arreglo de 10 minutos" |
| **Dónde** | `docs/specs/SPEC-031-navegacion-de-la-rutina.md` y `docs/specs/SPEC-031-crear-rutina-de-un-mensaje.md` |
| **Qué pasa** | Un primer repaso (S-51) encontró 4 referencias cruzadas en docs. Un `grep` real sobre todo el repo (S-52) encontró **más de 40**: comentarios de cabecera y en línea, repartidos en `webhook.ts`, `navigation.ts`, `callback-data.ts`, `client-format.ts`, `delivery.ts`, `format.ts`, `keyboard.ts`, `editor/bulk.ts`, `editor/commands.ts`, `creation/quick-create.ts`, `creation/flows.ts`, `commands/router.ts`, `commands/format.ts`, `_shared/db.ts`, `ports/action-ports.ts`, dos migraciones SQL, y una docena de archivos de test — **las DOS specs se citan por igual en el mismo archivo**, a veces a pocas líneas de distancia (`webhook.ts` las mezcla cinco veces). |
| **Por qué queda pendiente, y no se resuelve en S-52** | Desambiguar 40+ comentarios exige leer cada uno en su contexto — no hay atajo de texto que distinga "SPEC-031 de navegación" de "SPEC-031 de crear_rutina" sin juicio humano caso por caso. Un error de clasificación en un comentario de código de producción no lo detecta ningún test: queda ahí, silenciosamente mal, hasta que alguien lo lea confundido. El volumen real cambia la decisión frente a lo que se pensaba en S-51: no es un arreglo de 10 minutos, es su propio trabajo. |
| **Propuesta** | Cuando se aborde: renumerar `crear-rutina-de-un-mensaje` (la que tiene menos referencias EXTERNAS claras — dentro de su propio código, da igual el número que lleve) a un número libre, revisando cada una de las 40+ referencias una por una, archivo por archivo, no con un buscar-y-reemplazar. |

## 4. Resuelto en S-52

Por constancia, no para que se vuelva a leer con atención (eso vive en el
commit `docs(spec-032): deduplica...` y en SPEC-032 tal como quedó antes de
este corte): la duplicación del mapeo SQL→`AIRequest` en `_shared/db.ts`
(con su comentario falso sobre `chronicConditions`), `REINTENTABLES`
duplicado entre `provider-call.ts` y `notify.ts`, las tablas `NIVEL`/
`SENSACION` copiadas en hasta cuatro archivos, el parseo de `callback_data`
que crecía con cada prefijo nuevo, el prompt de Gemini sin orientación de
nomenclatura reconocible (esa última no era deuda técnica estricta — ver
§5 — pero se resolvió de paso, al tocar `_core/ai/` por lo mismo), y la
sección de `ROADMAP.md` que describía la versión vieja de SPEC-019
(workout-guide/302 en vez de RepDB/601, ya corregida ahí).

## 5. Lo que NO es deuda técnica, aunque salga de una auditoría

- **Guiar al entrenador con una referencia de ejercicios al editar a mano**:
  es una mejora de producto, no una corrección. Si se decide construir, es
  spec propia.
- **Alta de un entrenador sin SQL manual**: tampoco es deuda — es una
  funcionalidad que falta, no algo roto. Propuesta en SPEC-035.
