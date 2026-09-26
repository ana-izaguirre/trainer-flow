# SPEC-022 — Un editor que se entienda

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |
| **Depende de** | SPEC-008 |
| **Sesiones** | S-43 |

## 1. Objetivo

Que escribir una rutina a mano desde Telegram sea algo que el entrenador
**quiera** hacer.

## 2. El problema, en sus palabras

> *«Mi esposo quiso hacer a mano y salía bien raro y no se entendía.»*

Esto es todo lo que recibía al pulsar ✍️:

```
✍️ Borrador vacío creado. Ve añadiendo:

/dia 1 Empuje — nombra un día
/add 1 Press banca 4x8 90 — añade un ejercicio
/quitar 1 2 — quita el ejercicio 2 del día 1
/nota 1 1 baja controlado — pone una nota
/ver — enseña cómo va
```

Tres problemas, y los tres pesan:

| | |
|---|---|
| **Volumen** | Tres días de cinco ejercicios son **18 mensajes** sin equivocarse en ninguno |
| **A ciegas** | Cada comando respondía «✏️ Rutina actualizada». Para saber qué pasó había que pedir `/ver` |
| **Desde cero** | El botón ✍️ empieza con una rutina vacía, y ahí ya no se ve que 📋 existe |

## 3. La decisión de diseño

### 3.1 Dictarla, no construirla

El entrenador tiene la rutina en la cabeza entera. La interfaz le pedía
desmontarla en dieciocho piezas y volver a montarla de una en una.

```
/crear_rutina
Día 1: Empuje
Press banca 4x8 90
Press militar 3x10

Día 2: Tirón
Dominadas 4x6 120
```

Un mensaje. Y es **el mismo texto que escribiría en una libreta**, que es la
prueba de que el formato es el correcto.

### 3.2 Tolerar cómo escribe una persona, no cómo escribe un programa

Desde el móvil nadie se acuerda de si eran dos puntos o un guion. Se aceptan
`Día 1: Empuje`, `Dia 1 - Empuje`, `DÍA 1. Empuje` y `Día 1 Empuje`. También
la `X` mayúscula, la `s` de segundos, los espacios de más y los renglones en
blanco.

**Lo que no se tolera es un renglón que no se entiende** — y ahí el mensaje
dice **cuál**:

```
Renglón 2 («Press banca»): falta las series y repeticiones.
Ejemplo: Press banca 4x8 90
```

Los renglones en blanco **cuentan** para ese número. Si no contaran, el
entrenador buscaría el error en otro sitio.

### 3.3 Devolver la rutina, no un acuse

Después de cada cambio —`/crear_rutina`, `/add`, `/quitar`, `/nota`, `/dia`— se
devuelve la rutina completa. Editar a ciegas y comprobar después con `/ver`
era la otra mitad de «no se entendía».

`/ver` se queda: sirve para mirar sin tocar.

### 3.4 Recordar que existe la plantilla

El mensaje del modo manual termina ofreciendo 📋. Partir de algo y retocarlo
casi siempre gana a escribir desde cero, y desde el botón de ✍️ esa opción ya
no está a la vista.

## 4. Alcance

**Incluye:**
- `/crear_rutina`, que reemplaza **todos** los días de una vez
- Errores que nombran el renglón
- La rutina completa como respuesta a cada edición
- El mensaje de ayuda reescrito, empezando por lo rápido

**No incluye:**
- Botones para editar. Telegram los limita a 64 bytes de `callback_data`: no
  caben ni un nombre de ejercicio ni unas series
- Reordenar o duplicar días. Sigue siendo la limitación reconocida de SPEC-008
- Editar desde el cliente. Nunca (SPEC-010 §8)
- Un editor web. Fuera de V1

## 5. Contratos

### El formato

```
<cabecera de día>
<ejercicio>
<ejercicio>
...
```

| Parte | Forma | Ejemplos |
|---|---|---|
| Cabecera | `Día <n>[separador] [foco]` | `Día 1: Empuje` · `Dia 2 - Tirón` · `DÍA 3` |
| Ejercicio | `<nombre> <series>x<reps> [descanso]` | `Press banca 4x8 90` · `Dominadas 4X6-8` · `Plancha 3x30 s` |

Sin foco, el día se llama `Día <n>`. Sin descanso, 90 segundos.

### Tipos

```typescript
export type BulkResult =
  | { readonly ok: true; readonly days: readonly WorkoutDay[] }
  /** Va directo al entrenador: en español, y diciendo qué renglón falló. */
  | { readonly ok: false; readonly error: string };

export function parseWorkoutText(text: string): BulkResult;

// Y un comando nuevo del editor:
| { readonly kind: 'setDays'; readonly days: readonly WorkoutDay[] }
```

### El separador del comando

`parseUpdate` buscaba el primer **espacio** para separar el comando de sus
argumentos. `/crear_rutina` se escribe con la rutina **debajo**, así que ahora busca
el primer **espacio en blanco** de cualquier tipo. Sin esto, el comando se
habría comido el mensaje entero.

## 6. Reglas de negocio

1. `/crear_rutina` reemplaza **todos** los días. No añade.
2. **`summary` y `warnings` se conservan.** El aviso de limitaciones del
   cliente no es algo que el entrenador esté reescribiendo al dictar los días,
   y perderlo haría fallar `validateDraft` al aprobar.
3. Un renglón que no se entiende **aborta el mensaje entero**: no se guarda
   media rutina. O entra toda, o no entra nada.
4. El error nombra el renglón, contando los blancos.
5. Un día puede quedarse **sin ejercicios**: dictar a medias tiene que
   poderse. La puerta de `validateDraft` sigue en aprobar (SPEC-008 regla 11).
6. El mismo día dos veces es un error, no un reemplazo silencioso.
7. Los días salen **ordenados por número**, se dicten en el orden que se
   dicten.
8. Los textos largos se **recortan**, no se rechazan: el entrenador ve el
   resultado y lo corrige si le molesta.
9. Cada edición devuelve la rutina completa, con el nombre del cliente en la
   cabecera. **El contexto implícito sigue siendo explícito en la respuesta.**

## 7. Estados

**Ninguno.** `/crear_rutina` es una edición más: sobre `DRAFT`, in-place, sin cambiar
estado (SPEC-008 reglas 5 y 6).

## 8. Errores

| Situación | Respuesta |
|---|---|
| Un ejercicio antes del primer día | `Renglón N: antes del primer ejercicio hace falta un día` |
| Sin series ni repeticiones | `Renglón N: falta las series y repeticiones. Ejemplo: …` |
| Sin nombre | `Renglón N: falta el nombre del ejercicio` |
| Series fuera de 1–10 | `Renglón N: las series deben estar entre 1 y 10` |
| Descanso que no es número | `Renglón N: el descanso tiene que ser un número de segundos` |
| Día fuera de 1–7 | `Renglón N: el día debe estar entre 1 y 7` |
| Día repetido | `Renglón N: el día 1 ya estaba` |
| Más de 15 ejercicios en un día | `Renglón N: … que es el máximo` |
| Ningún día | `No encontré ningún día. Empieza por uno. Ejemplo: Día 1: Empuje` |
| Se aprobó mientras escribía | `Esa rutina ya no es un borrador. Tu cambio no se aplicó` |

## 9. Seguridad

- Sin cambios: `/crear_rutina` pasa por el mismo `currentDraft` que el resto, que ya
  resuelve el borrador **del entrenador que escribe**.
- Los textos se acotan a los límites del dominio antes de guardarse.
- `validateDraft` sigue siendo la puerta al aprobar. **Nada de esto crea un
  camino nuevo hacia `SENT`.**

## 10. Criterios de aceptación

- **CA-1** — DADO `/crear_rutina` con dos días y sus ejercicios, CUANDO se envía,
  ENTONCES el borrador queda con esos dos días.
- **CA-2** — DADO un borrador con un aviso de limitaciones, CUANDO se envía
  `/crear_rutina`, ENTONCES el aviso **sigue ahí**.
- **CA-3** — DADO `/crear_rutina` con un renglón ilegible, CUANDO se envía, ENTONCES
  **no se guarda nada** y el mensaje nombra ese renglón.
- **CA-4** — DADO cualquier edición correcta, CUANDO se aplica, ENTONCES la
  respuesta es la **rutina completa**, con el nombre del cliente.
- **CA-5** — DADO `/crear_rutina` sin ninguna cabecera de día, CUANDO se envía,
  ENTONCES se rechaza pidiendo un día.
- **CA-6** — DADO los días dictados del 2 al 1, CUANDO se parsean, ENTONCES
  salen del 1 al 2.
- **CA-7** — DADO un comando seguido de un salto de línea, CUANDO `parseUpdate`
  lo lee, ENTONCES el comando es solo la primera palabra.
- **CA-8** — DADO que no hay borrador abierto, CUANDO se envía `/crear_rutina`,
  ENTONCES se responde cómo abrir uno y no se guarda nada.

## 11. Tests

| Nivel | Caso |
|---|---|
| Unit | El formato completo: días, ejercicios, descanso por defecto |
| Unit | Tolerancia: tildes, mayúsculas, cuatro separadores, espacios, blancos |
| Unit | Cada error, comprobando que nombra el renglón correcto |
| Unit | Los blancos cuentan para el número de renglón |
| Unit | Límites: nombre y foco largos se recortan; día sin ejercicios vale |
| Unit | `setDays` conserva `summary` y `warnings`, y no muta el original |
| Unit | `/crear_rutina` por el handler: guarda, no guarda, y qué responde |
| Unit | `parseUpdate` con un comando seguido de renglones |

## 12. Archivos que toca

```
supabase/functions/_core/editor/bulk.ts              parseWorkoutText (nuevo)
supabase/functions/_core/editor/commands.ts          parseExerciseTokens, setDays
supabase/functions/_core/creation/editor-session.ts  /rutina y la respuesta
supabase/functions/_core/creation/flows.ts           el mensaje de ayuda
supabase/functions/_core/telegram/update.ts          el separador del comando
```

Sin migraciones. Sin cambios en el modelo.

---

## 12.bis El nombre cambió al verlo usar

Se llamaba `/rutina`. Duró un día: un cliente recién vinculado escribió
`/rutina` —lo natural para ver la suya— y se topó con un comando del
entrenador.

`/rutina` pasa a ser del CLIENTE. El del entrenador es `/crear_rutina`, con
guion bajo porque BotFather no admite guiones ni mayúsculas en los comandos
registrados, y sin registrar no aparecen en el menú del `/`.

## 12.ter Ampliación: mensajes que dicen el siguiente paso

| Campo | Valor |
|---|---|
| **Estado** | **PROPUESTA — pendiente de aprobación** |
| **Origen** | Uso real (septiembre 2026), tres mensajes seguidos sin salida |

**Lo que pasó.** Ana pulsó ✍️ A mano, y el bot le explicó `/crear_rutina`
con un ejemplo. Tocó `/crear_rutina` —en el menú de comandos de Telegram eso
lo **envía al instante, sin nada debajo**— y recibió *«No encontré ningún
día. Empieza por uno. Ejemplo: Día 1: Empuje»*, que se lee como si pidiera
una rutina de un día. Después rechazó la rutina (*«Puedes empezar otra»*,
sin decir cómo), volvió a mandar `/crear_rutina` y recibió *«Pulsa 📋 o ✍️
en el aviso de un cliente»*, un aviso que ya estaba enterrado en el chat.

Ninguno de los tres mensajes es incorrecto. Los tres dejan sin saber qué
hacer a continuación. La regla que sale de aquí:

> **Todo mensaje que corta un flujo dice el siguiente paso concreto, y si
> ese paso es un botón que ya existe, lleva el botón.**

### M1 — `/crear_rutina` sin días

Sustituye la fila «Ningún día» de §8:

```
Escribe los días en el MISMO mensaje, debajo de /crear_rutina.
Copia este ejemplo, cámbialo y envíalo:

/crear_rutina
Día 1: Cuerpo completo A
Sentadilla 3x10 120
Press banca 3x10 90

Día 2: Cuerpo completo B
Peso muerto rumano 3x10 120
Jalón al pecho 3x12 90
```

El ejemplo va en bloque de código (MarkdownV2 ```` ``` ````): en Telegram se
copia entero con un toque, y el `/crear_rutina` de dentro no se vuelve un
enlace que al pulsarse repita el error.

### M2 — Sin borrador abierto

```
No tienes ningún borrador abierto.
Escribe /cliente y el nombre (por ejemplo /cliente Ana), pulsa
📋 Plantilla o ✍️ A mano en su ficha, y después vuelve a /crear_rutina.
```

`/cliente <nombre>` ya lleva esos botones desde S-49 (SPEC-007 regla 7): el
mensaje nombra un camino que existe, en vez de uno que se perdió en el
scroll.

### M3 — Después de rechazar (SPEC-004)

El mensaje de rechazo pasa a llevar el botón **✏️ Crear v2**, la misma
acción (`revise`, `startRevision`) que la ficha ya ofrece sobre una versión
`REJECTED`:

```
❌ Rutina rechazada. Pulsa ✏️ Crear v2 para empezar otra
para Ana Izaguirre Matamoros.

[✏️ Crear v2]
```

**Sin estados ni transiciones nuevas.** Es un botón más sobre una acción que
ya existe y ya está autorizada (`startRevision` comprueba que el entrenador
sea el dueño). La v2 nace en `NEW` con los tres botones de siempre.

### M4 — Varios clientes con el mismo nombre (SPEC-007)

Hoy `/cliente Ana` con dos Anas responde *«🤔 Hay varios que encajan.
¿Cuál?»* y una lista de texto: hay que volver a escribir el comando con el
apellido. Cada nombre de la lista pasa a ser un **botón que abre su ficha**:

```
🤔 Hay varios que encajan. ¿Cuál?

[Ana Izaguirre Matamoros]
[Ana María López]
```

- Callback nuevo `cli:<clientId>`, con prefijo propio como `tpl:` y `chg:`:
  no es una acción sobre una versión, sino elegir a quién mirar. Ocupa 40
  de los 64 bytes.
- **Solo lectura.** Abre la misma ficha que `/cliente <nombre>`, con sus
  botones (SPEC-007 regla 7).
- **Misma autorización que el resto.** Se comprueba que el cliente sea del
  entrenador que pulsa (`canViewClient`). Un id ajeno y uno inexistente
  responden igual (SPEC-013 regla 2), así que probar ids no revela cuáles
  existen.
- La lista sigue partida en páginas de 20 (SPEC-007 regla 4).

### Criterios de aceptación

- **CA-M1** — DADO un borrador abierto, CUANDO llega `/crear_rutina` sin
  días, ENTONCES la respuesta dice «en el MISMO mensaje» y trae el ejemplo en
  bloque de código.
- **CA-M2** — DADO ningún borrador abierto, CUANDO llega un comando del
  editor, ENTONCES la respuesta nombra `/cliente`.
- **CA-M3** — DADO una versión rechazada, CUANDO se confirma el rechazo,
  ENTONCES el mensaje lleva el botón `revise` con el `versionId` rechazado,
  y pulsarlo crea la v2 en `NEW`.
- **CA-M4** — DADO dos clientes que contienen «Ana», CUANDO el entrenador
  escribe `/cliente Ana`, ENTONCES cada una sale como botón `cli:<clientId>`,
  y pulsarlo abre su ficha con los botones de su estado.
- **CA-M5** — DADO un `cli:` con el id de un cliente de OTRO entrenador, o
  uno que no existe, CUANDO se pulsa, ENTONCES los dos reciben la misma
  respuesta neutra y ninguna ficha.
- **CA-M6** — Los cuatro mensajes pasan el detector de MarkdownV2 sin
  escapar (`tests/helpers/markdown.ts`), con un nombre de cliente con guion.

**Tests** — `bulk.test.ts` (M1), `editor-session.test.ts` (M2),
`actions.test.ts` (M3), `router.test.ts` y `callback-data.test.ts` (M4), más
casos en `webhook.test.ts` que pulsan los botones de M3 y M4 de punta a
punta. CA-M5 va también a `tests/integration/security.test.ts`: es un caso
de autorización.

## 13. Lo que queda abierto

**Reordenar y duplicar días sigue siendo incómodo**, igual que reconocía
SPEC-008. Con `/crear_rutina` deja de doler tanto —se redicta entera— pero no es lo
mismo que moverlos.

Y el formato **no cubre las notas por ejercicio**: siguen siendo `/nota`. Meterlas
en el dictado pedía una segunda sintaxis dentro del renglón, y eso es
exactamente lo que esta spec vino a quitar.
