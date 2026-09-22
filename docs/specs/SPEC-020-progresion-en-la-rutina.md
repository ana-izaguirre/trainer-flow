# SPEC-020 — Progresión en la rutina

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR — pendiente de que Ana y Carlos la aprueben |
| **Depende de** | SPEC-002, SPEC-008 |
| **Sesiones** | Por asignar |

## 1. Objetivo

Que una rutina diga **cómo avanzar**, no solo qué hacer — y que lo diga venga
de donde venga: de la IA, de una plantilla o de la mano del entrenador.

## 2. El problema

Este es el modelo completo de un ejercicio hoy:

```typescript
interface Exercise {
  name: string;        // "Sentadilla goblet"
  sets: number;        // 3
  reps: string;        // "8-10"
  restSeconds: number; // 90
  notes: string | null;
}
```

No hay peso, ni RPE, ni semana. **La rutina es una foto fija.** El cliente
hace en la semana 3 exactamente lo mismo que en la semana 1, con el mismo
peso, y el estímulo se apaga.

El prompt tampoco pide progresión: se le piden días, ejercicios, series y
descansos. Nadie le dice a la IA que el cliente va a repetir esa rutina cuatro
semanas seguidas.

## 3. La decisión de diseño

### 3.1 La progresión es de la rutina, no de la IA

La tentación es meter la regla en el prompt y darlo por hecho. Eso deja sin
progresión a los otros dos caminos:

```
IA ──────────┐
Plantilla ───┼──► WorkoutDraft ──► validateDraft ──► WorkoutVersion
Manual ──────┘
```

Y los rompe justo cuando más importan: **las plantillas existen para cuando la
IA falla.** Una plantilla sin progresión sería un producto peor precisamente el
día malo.

Por eso `progression` es un campo del `Workout`, al lado de `summary` y
`warnings`. Los tres caminos lo producen; la validación lo exige igual a los
tres.

### 3.2 No se registra el peso usado — y es a propósito

La alternativa «de verdad» sería que el cliente reporte qué peso levantó y que
eso alimente la siguiente rutina. Se descarta para V1:

| | Coste |
|---|---|
| `Exercise` gana `weight` | Modelo validado, schema JSON, formateadores, editor, plantillas |
| El check-in pregunta el peso | **Una pregunta por ejercicio.** 15 ejercicios, 15 toques |
| Alimentar la siguiente rutina | El prompt gana historial, y crece cada semana |

El problema no es el código. **Es que nadie contesta quince preguntas por
Telegram cada lunes.** El check-in actual funciona porque son tres toques. En
cuanto pide el peso de cada ejercicio, el cliente deja de contestar — y
entonces no hay ni progresión ni check-in.

Se revisa cuando Carlos, con dos meses de uso real encima, diga que necesita
los números.

### 3.3 Autorregulación, no calendario

La regla la ejecuta el cliente sesión a sesión, no una fecha:

> *Arranca con un peso que te deje 2 repeticiones de sobra. Si completas todas
> las series en el rango alto con buena técnica, sube en la siguiente sesión.
> Si no llegas al rango bajo, baja.*

Es lo que un entrenador diría en persona, y no necesita que el sistema sepa
nada del peso que el cliente tiene en la mano.

## 4. Alcance

**Incluye:**
- `progression` como campo del `Workout`, validado como cualquier otro texto
- La IA lo produce siempre: va en el schema JSON como obligatorio
- Las cuatro plantillas traen el suyo, **escrito por Carlos**
- El editor gana `setProgression` para cambiarlo a mano
- Se muestra una vez en el mensaje del entrenador y una vez en el del cliente

**No incluye:**
- Registrar el peso que el cliente usó (§3.2)
- Progresión estructurada por ejercicio — la nuance va en `notes`, en prosa
- Regenerar la rutina automáticamente desde el check-in (fuera de V1 desde
  SPEC-006)
- Periodización por bloques, deloads programados, 1RM

## 5. Contratos

### Tipos

```typescript
export interface Workout {
  readonly summary: string;
  readonly days: readonly WorkoutDay[];
  readonly warnings: readonly string[];
  /**
   * Cómo avanza el cliente de una semana a la siguiente.
   *
   * `null` solo en versiones guardadas ANTES de esta spec. Todo camino nuevo
   * lo produce.
   */
  readonly progression: string | null;
}

export const WORKOUT_LIMITS = {
  // …
  text: {
    summary: 500,
    focus: 80,
    name: 120,
    reps: 20,
    notes: 500,
    warning: 300,
    progression: 400,   // ← nuevo
  },
} as const;
```

### Entrada — lo que se le pide a la IA

El schema JSON gana la propiedad y la marca **obligatoria**, junto a una
instrucción en el prompt:

```
PROGRESIÓN — el cliente va a repetir esta rutina varias semanas:
- Escribe en `progression` UNA regla, en segunda persona, que le diga cuándo
  subir el peso y cuándo bajarlo. Que dependa de cómo le fue, no de la fecha.
- Si un ejercicio necesita un criterio distinto (un accesorio pequeño no sube
  igual que una sentadilla), dilo en el `notes` de ESE ejercicio.
- No inventes kilos concretos: no sabes con qué peso empieza.
```

### Salida — lo que ve cada uno

**El entrenador**, al revisar, después de los `warnings`:

```
📈 Progresión
Sube el peso cuando completes todas las series en el rango alto con
buena técnica. Si no llegas al rango bajo, baja.
```

**El cliente**, al recibir la rutina, una sola vez al final — nunca repetido
por ejercicio.

### El editor

```
/progresion <texto>
```

Un comando más, con la misma forma que `setNote`. Cuenta como edición
(`edit_count`).

## 6. Reglas de negocio

1. `progression` pertenece al `Workout`. Los tres orígenes lo producen y la
   validación lo trata igual en los tres.
2. **En el schema JSON de la IA es obligatorio.** El tipo es
   `string | null` **solo** para que las versiones ya guardadas sigan siendo
   válidas; no es permiso para omitirlo en una rutina nueva.
3. Las cuatro plantillas de `_core/templates.ts` traen el suyo, escrito a mano.
   Una plantilla sin progresión es un test rojo.
4. Una rutina creada a mano puede dejarlo en `null`: el entrenador sabe lo que
   hace y puede decidir que esa rutina no progresa.
5. **`null` no renderiza nada.** Ni un texto de relleno, ni un «sin
   progresión»: la sección simplemente no aparece.
6. Se muestra **una vez por rutina**, nunca por día ni por ejercicio.
7. Máximo 400 caracteres, como todo campo libre (SECURITY.md).
8. **La progresión NO dispara ninguna transición de estado.** Es una
   instrucción para el cliente, no una acción del sistema. Nada en esta spec
   crea un camino nuevo hacia `SENT`.
9. La IA no escribe kilos concretos: no conoce el peso de partida. Si los
   escribe, es texto y pasa — pero el prompt se lo pide explícitamente.

## 7. Estados

**Ninguno.** Esta spec no toca `version_state` ni la máquina de estados. Es un
campo más dentro del `content` JSONB.

## 8. Errores

| Situación | Respuesta | Efecto |
|---|---|---|
| La IA no devuelve `progression` | `validateDraft` lo rechaza como cualquier campo requerido | La generación falla y el entrenador lo ve |
| Texto de más de 400 caracteres | Se rechaza nombrando el campo | Igual que `summary` |
| Versión guardada antes de esta spec | `progression` llega como `null` | Se renderiza sin esa sección |
| Plantilla sin progresión | Test rojo en `templates.test.ts` | No llega a producción |

## 9. Seguridad

- Texto libre que viene de la IA: se acota a 400 y se escapa en Telegram como
  todo lo demás (MarkdownV2).
- No se loguea el contenido de la rutina, ni aquí ni en ningún sitio.
- Sin cambios en autorización: quien puede ver la rutina puede ver esto.

## 10. Migración

**Ninguna.** El `Workout` vive en `workout_versions.content`, que es `jsonb`.
Añadir un campo no toca el esquema.

Las versiones ya guardadas no lo tienen, y por eso el tipo admite `null`
(regla 2). Es la única razón por la que lo admite.

## 11. Criterios de aceptación

- **CA-1** — DADO una generación con IA, CUANDO devuelve la rutina, ENTONCES
  `progression` trae texto no vacío.
- **CA-2** — DADO que la IA omite `progression`, CUANDO se valida el draft,
  ENTONCES falla nombrando el campo.
- **CA-3** — DADO cualquiera de las cuatro plantillas, CUANDO se carga,
  ENTONCES trae su propia progresión escrita.
- **CA-4** — DADO una versión guardada antes de esta spec (sin el campo),
  CUANDO se lee y se formatea, ENTONCES es válida y el mensaje sale **sin la
  sección de progresión**.
- **CA-5** — DADO una rutina con progresión, CUANDO se formatea para el
  cliente, ENTONCES el texto aparece **una sola vez**, al final.
- **CA-6** — DADO `/progresion <texto>`, CUANDO el entrenador lo envía sobre
  una versión suya en `DRAFT`, ENTONCES cambia el campo y sube `edit_count`.
- **CA-7** — DADO una progresión de 401 caracteres, CUANDO se valida,
  ENTONCES se rechaza.
- **CA-8** — DADO una rutina en `SENT`, CUANDO se le aplica `/progresion`,
  ENTONCES se rechaza por estado, igual que cualquier otra edición.

## 12. Tests

| Nivel | Caso |
|---|---|
| Unit | `validateDraft` con y sin `progression`, y en el límite de 400 |
| Unit | Las cuatro plantillas traen progresión no vacía |
| Unit | `buildPrompt` incluye el bloque de progresión |
| Unit | El schema JSON marca `progression` como requerido |
| Unit | Formateo del entrenador: con progresión y con `null` |
| Unit | Formateo del cliente: aparece una vez, al final |
| Unit | `setProgression`: parseo, límite, y que sube `edit_count` |
| Unit | `/progresion` sobre `SENT` se rechaza (CA-8) |
| Integration | Una versión con `content` sin `progression` se lee sin romper |
| E2E | Tally → generación → el mensaje del entrenador trae la sección |

## 13. Archivos que toca

```
supabase/functions/_core/domain/workout.ts          + progression, + límite
supabase/functions/_core/domain/validate-draft.ts   + validación del campo
supabase/functions/_core/ai/prompt-builder.ts       + schema y + instrucción
supabase/functions/_core/templates.ts               + 4 progresiones a mano
supabase/functions/_core/editor/commands.ts         + setProgression
supabase/functions/_core/telegram/format.ts         + sección del entrenador
supabase/functions/_core/telegram/client-format.ts  + sección del cliente
docs/specs/SPEC-002-generacion-con-ia.md            referencia a esta spec
```

Sin migraciones (§10).

---

## 14. Lo que Carlos tiene que decidir antes de implementar

Esto no lo puede decidir ni Ana ni la IA. **Son las cuatro progresiones de las
plantillas**, y el criterio general que se le pide a la IA:

1. **¿Qué regla quiere por defecto?** La propuesta es doble progresión: subir
   cuando se completa el rango alto en todas las series. ¿Le sirve, o prefiere
   otra?

2. **¿Cuánto se sube?** Aquí está el detalle que importa: 2.5 kg es razonable
   en sentadilla y una barbaridad en elevaciones laterales. Opciones:
   - No decir kilos y dejarlo en «sube al siguiente peso disponible»
   - Distinguir básicos de accesorios en el `notes` de cada ejercicio

3. **¿Cuántas semanas dura un bloque** antes de que toque rutina nueva? Eso
   marca cuándo Carlos espera volver a generar.

4. **¿Qué pasa con el peso corporal?** En la plantilla sin equipamiento no hay
   kilos que subir. ¿Más repeticiones, más series, o progresar a una variante
   más difícil?

Con esas cuatro respuestas, la spec pasa a APROBADA y se implementa.
