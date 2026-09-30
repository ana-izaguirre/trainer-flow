# SPEC-019 — Una referencia visual por ejercicio

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** — diccionario ampliado a los 601 ejercicios de RepDB (§6, revisada) |
| **Depende de** | SPEC-005 |
| **Sesiones** | S-50 |

## Resultado

| Pieza | Dónde | Estado |
|---|---|---|
| Diccionario nombre de plantilla → slug, verificado contra los 601 reales | `_core/exercise-library.ts` (`TEMPLATE_EXERCISE_SLUGS`) | ✅ CA-1, CA-3, 100% mutation |
| Diccionario ampliado: los 601 `name_es → slug` reales de RepDB, como respaldo | `_core/repdb-exercises.ts` (`REPDB_EXERCISE_SLUGS`) | ✅ CA-1, CA-3 — cubre también lo que nombra la IA, sin tocar el dominio ni el prompt |
| Búsqueda armada con el nombre, sin inventar nada | `exercise-library.ts` (`searchUrl`) | ✅ CA-2 |
| El nombre del ejercicio se vuelve el enlace, en las dos vistas | `telegram/format.ts` (`formatExerciseBlock`) | ✅ CA-1, CA-2 |
| Variante sin match no cae a su base | `exercise-library.ts` (slugs distintos para «Remo con mancuerna» vs «Remo inclinado con dos mancuernas») | ✅ CA-5 |
| La longitud sigue cabiendo en 1 mensaje | medido sobre las 10 plantillas reales | ✅ CA-4 — la más larga (`strength-recovery-7d`, 27 ejercicios) da 3868/4096 |

**§6 quedó revisada** (ver abajo): la cobertura de lo que genera la IA no
sale de un `enum` ni de una llamada nueva a Gemini, sino de ampliar el mismo
diccionario a los 601 nombres reales de RepDB. Sigue siendo coincidencia
EXACTA (regla 1) — la decisión completa, con lo que se evaluó y se
descartó, queda en §6.

## 1. Objetivo

Que un cliente que no sabe qué es un «remo en punta» pueda verlo, sin sacarlo
de su chat ni inflarle la rutina.

## 2. La decisión de fondo: son ENLACES, no imágenes

Una rutina tiene ~12 ejercicios y la librería trae 3 fotogramas de cada uno.
Mandarlos serían **36 imágenes**.

Y la rutina es **un mensaje que el cliente relee toda la semana**. Con 36
fotos deja de servir para lo que sirve.

Por eso el nombre del ejercicio se vuelve **tocable** y lleva a su página,
que ya muestra los tres fotogramas:

```
• Peso muerto rumano — 3x8-10 · descanso 120s
  ↑ tocable → exercise-dataset.com/exercise/romanian-deadlift/
```

Cero imágenes enviadas, cero alojamiento, y **la longitud del mensaje no
cambia**: en MarkdownV2 el nombre *es* el enlace.

## 3. Dos capas, para que nadie se quede sin nada

```
¿El ejercicio está en la librería?
   SÍ  → su página: 3 fotogramas, exacta
   NO  → búsqueda en YouTube, ARMADA con el nombre
```

La búsqueda no la genera la IA: se construye con el nombre del ejercicio, así
que no hay nada que inventar y siempre devuelve algo relevante.

### Por qué la IA no genera enlaces de vídeo

El coste en tokens es irrelevante (~180 por rutina). El problema es que el
modelo **se inventa los identificadores**: produce URLs con buena pinta que
son 404 o, peor, un vídeo real que no corresponde.

**Y verificarlos no lo resuelve.** `youtube.com/oembed` dice si un vídeo
existe, pero un identificador válido que apunta a un vídeo de cocina pasa la
comprobación perfectamente. Verificar convierte «doce enlaces rotos» en «ocho
que abren y cuatro que faltan», y entre esos ocho algunos apuntan a lo que no
es. Ningún check automático lo detecta.

El problema no es que verificar sea caro: es que **desaparece** si el modelo
no genera identificadores.

## 4. La librería

[RepDB](https://github.com/RepDB/exercise-dataset) (edición pública gratuita,
vía `repdb.co` / `exercise-dataset.com`) — **601 ejercicios**, ilustraciones
WebP (inicio y pico del movimiento), metadatos con slug, equipo, músculos e
**instrucciones en español nativo** (`name_es`, no una traducción nuestra).

Reemplaza a workout-guide (302 ejercicios, decidido originalmente): más
cobertura, y el nombre en español nativo hace el mapeo contra las plantillas
mucho más confiable que traducir desde el inglés a mano.

**Licencia:** propia, con atribución obligatoria («Exercise data by RepDB
(repdb.co)» visible en `/ayuda` o créditos), gratis para uso comercial dentro
de una app. **No es CC BY-SA:** prohíbe explícitamente re-publicar,
revender o reempaquetar el dataset como repositorio o API independiente. Esto
cambia la mitigación de §8 — ver ahí.

### La cobertura, medida y no supuesta

Probando los ~60 nombres de ejercicio únicos de las plantillas actuales
contra los 601 de RepDB: la mayoría con coincidencia exacta o muy cercana
(mismo movimiento, equipo implícito). Los que no matchean son sobre todo
variantes con banda elástica poco comunes («face pull con banda», «aperturas
con banda») y términos genéricos sin un ejercicio único al que apuntar
(«movilidad de cadera», «estiramientos generales») — esos caen a búsqueda,
por regla 2.

### Por qué una variante NO cae a su ejercicio base

Tentador y equivocado. Enseñar `push-up` para «flexiones inclinadas» sería
engañoso: la inclinada es más fácil, y esa diferencia es justo el motivo de
haberla elegido. Una variante sin coincidencia exacta cae a la **búsqueda**,
no a su base.

## 5. Reglas

1. **Coincidencia exacta o nada.** El slug se valida contra la lista de 601.
   Uno inventado no llega jamás al cliente.
2. **Una variante sin coincidencia cae a la búsqueda**, nunca a su base (§4).
3. **Ningún ejercicio se queda sin referencia.** Si no hay slug, hay
   búsqueda; si el nombre está vacío, no hay enlace y se pinta como hoy.
4. **La longitud del mensaje no crece.** El nombre es el enlace.
5. **La atribución de RepDB se cumple** con una línea fija («Exercise data by
   RepDB (repdb.co)») en `/ayuda`. A diferencia de CC BY-SA, esta licencia no
   exige ShareAlike — exige la atribución y nada de re-publicar el dataset
   (§8), que es justo lo que esta spec no hace: solo enlaza.

## 6. El orden de implementación (revisada)

**Primero las plantillas.** Los ~48 nombres de ejercicio únicos de
`templates.ts`, tabla hecha a mano una vez, cobertura completa, riesgo cero.
Ya cubre toda rutina salida de plantilla (`TEMPLATE_EXERCISE_SLUGS`).

**La idea original para la IA** era darle los 601 slugs como `enum` en el
JSON Schema del prompt y obligarla a elegir uno o `null` — un campo
`exerciseSlug` nuevo en `Exercise`. Se evaluó y se descartó:

- **El dominio se ensucia.** `Exercise` aparece en ~45 sitios de 18
  archivos (medido con `grep` sobre `restSeconds:`, su campo hermano),
  incluyendo código de producción como `editor/commands.ts`. Un campo
  nuevo, aunque opcional, se propaga a todos.
- **Costo recurrente de tokens.** Un `enum` de 601 valores viaja en el
  schema de cada llamada a Gemini, para siempre — no es un costo de una
  vez.
- **La ganancia marginal es chica.** Un ejercicio generado por IA casi
  siempre nombra el movimiento en español de forma reconocible
  («sentadilla con barra», «peso muerto rumano») — el mismo terreno que ya
  cubre una coincidencia exacta contra un diccionario grande.

**Lo que se hizo en cambio:** ampliar el mismo diccionario estático, sin
tocar el dominio ni el prompt. `REPDB_EXERCISE_SLUGS` (`repdb-exercises.ts`)
trae los 601 pares `name_es → slug` reales de RepDB, no solo los ~48 de
plantillas. `exerciseUrl` consulta primero `TEMPLATE_EXERCISE_SLUGS` (los
matices verificados a mano, como unilateral/bilateral en «Remo con
mancuerna», que el `name_es` de RepDB no distingue) y, si no está ahí, cae
a `REPDB_EXERCISE_SLUGS`.

Sigue siendo coincidencia EXACTA (regla 1): el prompt no cambia, no hay
llamada nueva a Gemini, y el modelo no sabe que este diccionario existe. Es
comparación de strings, local y posterior a la generación — el mismo
mecanismo de la fase 1, con más cobertura.

## 7. Criterios de aceptación

- **CA-1** — DADO un ejercicio de la librería, CUANDO el cliente recibe la
  rutina, ENTONCES su nombre enlaza a la página con los tres fotogramas.
- **CA-2** — DADO uno que no está, ENTONCES enlaza a una búsqueda.
- **CA-3** — DADO un slug que no existe en la lista, ENTONCES **no** se usa,
  y se cae a la búsqueda.
- **CA-4** — DADO cualquier rutina, CUANDO se pinta, ENTONCES el mensaje cabe
  igual que hoy en el límite de Telegram.
- **CA-5** — DADO una variante sin coincidencia exacta, ENTONCES **no**
  enlaza a su ejercicio base.

## 8. La dependencia, dicha en voz alta

Los enlaces apuntan a `exercise-dataset.com`, de RepDB. Si lo bajan, mueren.

**A diferencia de la opción original (workout-guide, CC BY-SA), acá no hay
plan B de un día:** la licencia de RepDB prohíbe expresamente
re-publicar el dataset como sitio o API propia. Si el dominio cae, la
mitigación no es «se clona y se aloja en otro lado» — es migrar a otra
fuente de datos, con el mismo trabajo de mapeo que costó llegar a esta.

Se acepta el riesgo por la ganancia real: 601 ejercicios contra 302, y
nombres en español nativo en vez de una traducción nuestra desde el inglés.
Se anota aquí para que sea una decisión tomada con los ojos abiertos, no una
sorpresa si algún día pasa.

## 9. Lo que queda para después

Las imágenes **dentro** del chat, bajo demanda: un botón «📸 Ver un
ejercicio» que liste los de esa rutina y mande el álbum o un GIF del elegido.
Un ejercicio a la vez, cuando el cliente lo pide — que es la única forma de
no ahogar la rutina.
