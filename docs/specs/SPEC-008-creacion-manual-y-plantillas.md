# SPEC-008 — Creación manual y plantillas

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** |

## Resultado parcial

| Pieza | Sesión | Estado |
|---|---|---|
| Modelo `Workout` y `validateDraft` | S-07 | ✅ 61 tests, cobertura 100% |
| Plantillas (`_core/templates.ts`) | S-08 | ✅ 27 tests |
| Editor por comandos | S-10 | ✅ 68 tests, cobertura 100% |
| **E2E-1** (flujo manual completo) | S-11 | ✅ 3 tests contra PostgreSQL real |
| **Depende de** | SPEC-000 |
| **Sesiones** | S-06, S-07 |

## Corrección de S-27: el estado sí se comprueba

`LOAD_TEMPLATE` y `CREATE_MANUAL` salen **solo de `NEW`** (ver
`docs/STATE-MACHINE.md`). Los tres flujos de este documento no lo comprobaban:
pasaban el estado actual como esperado a `fill_version`, que siempre coincide,
y `fill_version` escribe `state = 'DRAFT'` sin mirar de dónde viene.

Un botón viejo —los mensajes de Telegram no caducan— reescribía una rutina ya
enviada. Ahora los tres consultan `nextState` antes de tocar nada, y el rechazo
por estado SÍ explica el motivo: solo llega el dueño, así que no hay nada que
filtrar.

## 1. Objetivo

El entrenador puede crear una rutina **sin tocar la IA**: desde una plantilla o
desde cero. Es el camino que garantiza que la IA nunca sea punto único de fallo.

## 2. Alcance

**Incluye:** las plantillas predefinidas, la creación manual, el editor por
comandos de Telegram, y que las tres fuentes converjan en el mismo `WorkoutDraft`.

**No incluye:** la generación con IA (SPEC-002), un editor visual (no hay
frontend en V1), una biblioteca de plantillas administrable.

## 3. Contratos

### Plantillas: constante, no tabla

```typescript
// _core/templates.ts — sin base de datos, sin red
export interface WorkoutTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly daysPerWeek: number;
  readonly level: Level;
  readonly equipment: string;
  readonly workout: Workout;
}

export const TEMPLATES: readonly WorkoutTemplate[] = [ /* 3–4 plantillas */ ];

export function findTemplate(id: string): WorkoutTemplate | undefined;
export function templatesFor(criteria: TemplateCriteria): readonly WorkoutTemplate[];
```

> **Por qué constante y no tabla.** El punto §6 pide que las plantillas
> funcionen sin depender de la IA. Estando en el binario, funcionan incluso con
> la base de datos degradada. Cero migración, cero query, cero RLS.

### Plantillas iniciales

| `id` | Nombre | Días | Nivel | Equipamiento |
|---|---|---|---|---|
| `full-body-3d` | Cuerpo completo | 3 | principiante | Gimnasio |
| `upper-lower-4d` | Torso / pierna | 4 | intermedio | Gimnasio |
| `home-bodyweight-3d` | Casa, peso corporal | 3 | principiante | Ninguno |
| `push-pull-legs-6d` | Empuje / tirón / pierna | 6 | avanzado | Gimnasio |

### Ampliación: una plantilla para cada número de días

| Campo | Valor |
|---|---|
| **Estado** | **IMPLEMENTADA** — aprobada por Ana el 26/09/2026 |
| **Origen** | Uso real (septiembre 2026): una clienta de 2 días no vio ninguna plantilla de 2 días |

**El hueco.** El formulario acepta de 1 a 7 días (`assessments_days_per_week_range`)
y solo hay plantillas de 3, 4 y 6. `adaptDays` ya ajusta cualquier plantilla a
los días pedidos (en ciclo, con aviso al entrenador), así que nada se rompe.
Pero el ajuste solo es bueno cerca del original: con 7 días repite A, B, C, A,
B, C, A —siete sesiones intensas sin descanso— y con 1 día toma solo la sesión
A, que no está pensada para ir sola.

**La propuesta.** Cuatro plantillas nuevas, una por cada número de días que
falta. Con ellas, las 8 cubren del 1 al 7.

| `id` | Nombre | Días | Nivel | Equipamiento |
|---|---|---|---|---|
| `full-body-1d` | Cuerpo completo — 1 día | 1 | principiante | Gimnasio |
| `full-body-2d` | Cuerpo completo — 2 días | 2 | principiante | Gimnasio |
| `upper-lower-full-5d` | Torso / Pierna / Cuerpo completo — 5 días | 5 | intermedio | Gimnasio |
| `strength-recovery-7d` | Fuerza + recuperación activa — 7 días | 7 | intermedio | Gimnasio |

Formato: ejercicio · series × repeticiones · descanso.

**`full-body-1d`** — *Una sesión que toca todos los grupos grandes. Con tan
poca frecuencia, lo que cuenta es no saltarla.*

| Día | Ejercicios |
|---|---|
| 1 · Cuerpo completo | Sentadilla con barra 3×8-10 · 120 s *(baja hasta donde controles la postura)* · Press de banca 3×8-10 · 90 s · Remo con barra 3×10-12 · 90 s · Peso muerto rumano 3×8-10 · 120 s · Press militar con mancuernas 2×10-12 · 90 s · Plancha frontal 3×30 s · 60 s |

**`full-body-2d`** — *Cuerpo completo dos veces por semana, con al menos un
día de descanso entre sesiones.*

| Día | Ejercicios |
|---|---|
| 1 · Cuerpo completo A | Sentadilla con barra 3×8-10 · 120 s · Press de banca 3×8-10 · 90 s · Remo con barra 3×10-12 · 90 s · Elevaciones laterales 2×12-15 · 60 s · Plancha frontal 3×30 s · 60 s |
| 2 · Cuerpo completo B | Peso muerto rumano 3×8-10 · 120 s · Press militar con mancuernas 3×10-12 · 90 s · Jalón al pecho 3×10-12 · 90 s · Zancadas con mancuernas 2×10 por pierna · 90 s · Curl de bíceps 2×12-15 · 60 s |

**`upper-lower-full-5d`** — *Torso y pierna dos veces cada uno, con una
sesión de cuerpo completo más ligera en medio.*

| Día | Ejercicios |
|---|---|
| 1 · Torso — fuerza | Press de banca 4×6-8 · 150 s · Remo con barra 4×6-8 · 150 s · Press militar 3×8-10 · 120 s · Jalón al pecho 3×10-12 · 90 s |
| 2 · Pierna — fuerza | Sentadilla con barra 4×6-8 · 180 s · Peso muerto rumano 3×8-10 · 150 s · Prensa de piernas 3×10-12 · 120 s · Elevación de talones 4×12-15 · 60 s |
| 3 · Cuerpo completo — ligero | Sentadilla goblet 3×12-15 · 90 s · Flexiones 3×10-15 · 60 s · Remo con mancuerna 3×12 por brazo · 60 s · Face pull 3×15-20 · 60 s *(cuida la postura del hombro)* · Plancha lateral 3×30 s por lado · 45 s |
| 4 · Torso — volumen | Press inclinado con mancuernas 4×10-12 · 90 s · Remo en polea baja 4×10-12 · 90 s · Aperturas en polea 3×12-15 · 60 s · Elevaciones laterales 3×12-15 · 60 s · Curl de bíceps 3×12-15 · 60 s |
| 5 · Pierna — volumen | Peso muerto convencional 3×5-6 · 180 s · Zancadas con mancuernas 3×10-12 · 90 s · Curl femoral 3×12-15 · 60 s · Extensión de cuádriceps 3×12-15 · 60 s |

**`strength-recovery-7d`** — *Cuatro sesiones de fuerza y tres de
recuperación activa. Siete días de entrenamiento intenso no dejan progresar:
el descanso es parte del plan.*

| Día | Ejercicios |
|---|---|
| 1 · Torso — fuerza | Igual que el día 1 de `upper-lower-full-5d` |
| 2 · Pierna — fuerza | Igual que el día 2 de `upper-lower-full-5d` |
| 3 · Recuperación activa | Caminata 1×30-40 min *(ritmo que permita conversar)* · Movilidad de cadera 2×10 por lado · 30 s · Movilidad de hombros 2×10 · 30 s · Estiramientos generales 1×10 min |
| 4 · Torso — volumen | Igual que el día 4 de `upper-lower-full-5d` |
| 5 · Pierna — volumen | Igual que el día 5 de `upper-lower-full-5d` |
| 6 · Recuperación activa | Bicicleta o elíptica suave 1×20-30 min · Puente de glúteo 3×15 · 45 s · Plancha frontal 3×30 s · 45 s · Movilidad torácica 2×10 · 30 s |
| 7 · Recuperación activa | Caminata 1×30-40 min · Estiramientos generales 1×15 min |

Aviso para el entrenador (`warnings`, que **no** llega al cliente, SPEC-005
regla 5): *«Siete días: los de recuperación activa son suaves a propósito.
Si el cliente los convierte en entrenamiento intenso, pierde el descanso que
necesita para progresar.»*

**Reglas de la ampliación**

- **R-A1.** Para cada número de días de 1 a 7 existe al menos una plantilla
  con exactamente esos días.
- **R-A2.** Siguen siendo constante en código, no tabla (§3): cero migración.
- **R-A3.** Se listan las 8, ordenadas como hoy (regla 7): la de los días
  exactos del cliente queda arriba. No se filtra: el entrenador puede preferir
  otra y `adaptDays` la ajusta.
- **R-A4.** Son un punto de partida, igual que las cuatro de hoy: el
  entrenador las revisa y edita antes de aprobar. Los ejercicios de esta
  propuesta los revisa Ana (o su entrenador) antes de implementar.

**Criterios de aceptación**

- **CA-A1** — DADO un cliente de *n* días, con *n* de 1 a 7, CUANDO se listan
  las plantillas, ENTONCES la primera tiene exactamente *n* días.
- **CA-A2** — DADO cualquiera de las 8 plantillas, CUANDO se carga con sus
  propios días, ENTONCES pasa `validateDraft` sin avisos de ajuste.
- **CA-A3** — DADO la plantilla de 7 días, CUANDO se carga, ENTONCES el
  borrador lleva el aviso de recuperación para el entrenador, y el mensaje al
  cliente no lo incluye.

**Tests** — en `templates.test.ts`: CA-A1 para *n* = 1…7; las 8 plantillas
pasan `validateDraft` (ya existe, se extiende solo); CA-A3 con `applyTemplate`
y `formatForClient`.

**Fuera de alcance** — que el entrenador cree o edite plantillas desde
Telegram: eso es SPEC-017 (aprobada, pendiente).

**Resultado.** Las cuatro, en `_core/templates.ts`. Las cuatro sesiones de
fuerza que comparten la de 5 y la de 7 días son constantes, no copias. El aviso de
días ajustados pasa a ir antes que los avisos propios de la plantilla (hasta
ahora ninguna tenía): es el que explica por qué la rutina no se parece a la
elegida. `tpl:strength-recovery-7d:<uuid>` ocupa 61 de los 64 bytes.

> **Resuelto en SPEC-028 — el equipamiento pesaba menos que los días.** Con una plantilla
> para cada número de días, a un cliente **sin equipo** de 2 días le sale
> primero `full-body-2d` (gimnasio): los días suman 3 y el equipamiento 1.
> Nada se rompe —se listan todas—, pero la primera opción no le sirve.
> Además no hay plantillas para bandas ni para mancuernas en casa.
> **Propuesta en SPEC-028**, que encontró además un bug anterior: la
> plantilla de casa compara contra «Ninguno», que no es una opción del
> formulario, así que nunca encajaba.

### Las tres fuentes convergen

```
IA         → WorkoutDraft { source: 'ai',       raw: unknown }  ─┐
Plantilla  → WorkoutDraft { source: 'template', raw: Workout }  ─┼─► validateDraft()
Manual     → WorkoutDraft { source: 'manual',   raw: unknown }  ─┘        ↓
                                                                      Workout
```

**Un solo camino de validación.** El §4 dice que no queremos tres sistemas.

### Elegir plantilla: dos pulsaciones, no una

```
📋 Plantilla  ──►  se listan las aplicables, ordenadas
                          │
                   [Torso / pierna · 4d]
                   [Cuerpo completo · 3d]
                   [Casa, peso corporal · 3d]
                          │
                   se carga y queda en DRAFT, con sus botones
```

El `callback_data` de la segunda pulsación es `tpl:<templateId>:<versionId>`.
Prefijo propio porque no es una acción sobre la versión, sino la elección de
**cuál** cargar; y los tres prefijos (`act:`, `chk:`, `tpl:`) viajan por el
mismo canal.

Caben en los 64 bytes de Telegram: el id más largo es `strength-recovery-7d`,
que deja `tpl:strength-recovery-7d:<uuid>` en 61.

**Nunca se carga una plantilla automáticamente** (regla 8), ni siquiera cuando
solo hay una que encaje: el entrenador elige siempre.

### Sobre qué versión actúa el editor

Los comandos del editor no llevan cliente: `/add 1 Press 4x8` no dice de
quién. **Se aplican al borrador que el entrenador tocó más recientemente.**

Se eligió así, y no «el único borrador abierto», porque con dos clientes a la
vez esa regla bloquearía los dos. Y no se añadió un argumento de cliente
porque escribir `/add carlos 1 Press 4x8` desde el móvil, en cada comando, es
exactamente la fricción que hace que el camino manual no se use.

**A cambio, cada respuesta dice sobre quién se aplicó.** Si el entrenador
tenía otro en mente, lo ve en el acto y no después de cuatro comandos.

> **Limitación reconocida.** Con varios borradores abiertos hay que aprobar o
> rechazar para cambiar de contexto. Es el mismo caso que las plantillas
> resuelven: se edita sobre algo, no se construye desde cero.

### Comandos del editor

| Comando | Efecto | Estado |
|---|---|---|
| 📋 **Plantilla** (botón) | Lista las aplicables y carga la elegida | ✅ |
| ✍️ **A mano** (botón) | Crea un borrador vacío y explica los comandos | ✅ |
| `/dia <n> <foco>` | Añade o renombra un día | ✅ |
| `/add <n> <nombre> <series>x<reps> [descanso]` | Añade ejercicio al día `n` | ✅ |
| `/quitar <n> <índice>` | Elimina un ejercicio | ✅ |
| `/nota <n> <índice> [texto]` | Edita la nota; sin texto, la borra | ✅ |
| `/ver` | Muestra el borrador actual formateado | ✅ |

**El parser tolera cómo escribe una persona en el móvil:** espacios de más,
`X` mayúscula, la `s` de segundos (`90s`), nombres de varias palabras. El
descanso es opcional y vale 90 segundos por defecto.

Lo que **no** tolera son valores fuera de rango: ahí devuelve un mensaje que
explica la sintaxis esperada, no un error genérico.

`/add` a un día que no existe **lo crea**, que es lo que espera quien escribe
`/add 3 ...` sin haber hecho `/dia 3` antes.

> **Limitación reconocida:** reordenar y duplicar días con comandos es incómodo.
> Se difiere a la fase 2, cuando exista una interfaz visual. Con las plantillas
> como punto de partida, el entrenador edita valores en vez de construir desde
> cero, que es el caso de uso real.

## 4. Reglas de negocio

1. **Ninguna operación de esta spec llama a la IA.** Ni una.
2. Cargar una plantilla crea una versión con `source='template'`,
   `template_id` y contenido → estado `DRAFT`.
3. Crear desde cero crea una versión con `source='manual'` y contenido mínimo
   → estado `DRAFT`.
4. Toda edición pasa por `validateDraft` antes de persistir. **Una rutina
   manual se valida igual de estricto que una generada por la IA.**
5. Editar una versión en `DRAFT` la modifica **in-place**: no crea versión ni
   cambia estado.
6. Editar una versión en `SENT` **no está permitido**: se crea `version + 1`.
7. Las plantillas se **ordenan** por días, nivel y equipamiento — **no se
   filtran**. Si se filtraran, un cliente con criterios poco comunes se
   quedaría sin ninguna opción justo cuando la IA acaba de fallar, que es
   exactamente el momento en que las plantillas tienen que estar ahí.
   `templatesFor` nunca devuelve una lista vacía.
   *Desde SPEC-028, el equipamiento va antes que los días: primero las que
   el cliente puede hacer con su equipo, después su mismo nivel, después
   los días y al final la experiencia.*
8. **Nunca se selecciona una plantilla automáticamente** (§6). El entrenador
   elige siempre.
9. **Si el cliente declaró limitaciones, `applyTemplate` inyecta un aviso.**
   Una plantilla no sabe nada del hombro de nadie. Sin el aviso, el borrador
   fallaría `validateDraft` con `LIMITATIONS_NOT_ACKNOWLEDGED` y el entrenador
   no podría ni cargarlo. Con él, pasa la misma validación que exigimos a la
   IA y el recordatorio queda a la vista. **Qué ajustar sigue siendo criterio
   del entrenador.**

12. **`applyTemplate` ajusta los días a los que el cliente pidió.**

    La regla 7 promete que el entrenador nunca se queda sin opciones. No se
    cumplía: `validateDraft` exige que los días coincidan exactamente, y las
    cuatro plantillas son de 3, 4, 3 y 6 días. **Un cliente de 2 días veía las
    cuatro y ninguna cargaba**, con un «El cliente pidió 2 días y la rutina
    trae 3» por cada intento.

    ```
    Plantilla de 3 días, cliente de 2  →  días 1 y 2
    Plantilla de 3 días, cliente de 5  →  días 1, 2, 3, 1, 2
    ```

    Se recorre la plantilla **en ciclo**, renumerando. Es como se usa una
    plantilla de verdad: «cuerpo completo 3×» a dos días son dos de esos tres.

    **Y se avisa.** Cuando el número cambia, se inyecta una nota en `warnings`
    igual que con las limitaciones: recortar «torso/pierna» a 2 días deja un
    reparto que hay que mirar. El sistema deja la rutina cargable; **decidir
    si ese reparto sirve es del entrenador.**

10. **Un borrador creado a mano nace vacío, y eso es correcto.** No se puede
    aprobar —`validateDraft` lo rechaza sin ejercicios—, así que el mensaje
    que lo crea explica los comandos en vez de dejar al entrenador mirando
    una rutina sin nada.
11. **La puerta de `validateDraft` está en APROBAR, no en cada edición.**

    Un borrador a medias no puede pasarla y no debe: `/dia 1 Empuje` deja un
    día sin ejercicios, y dos días de cuatro no cuadran con la evaluación. Si
    se validara en cada edición, **no habría forma de construir una rutina
    paso a paso**: el primer comando siempre fallaría.

    Lo que sí corre en cada edición son los rangos del propio comando
    —`sets` entre 1 y 10, día entre 1 y 7— que ya comprueba
    `applyEditorCommand`.

    **Y aprobar valida.** Antes no lo hacía: solo `generate-version` llamaba a
    `validateDraft`, así que una rutina manual podía aprobarse y enviarse sin
    haber pasado nunca por ahí. Eso contradecía la tabla de §6 y el punto 4.

## 5. Estados

```
NEW ──┬── LOAD_TEMPLATE ──► DRAFT
      └── CREATE_MANUAL ──► DRAFT

DRAFT ── EDIT ──► DRAFT   (in-place)
```

## 6. Errores

| Situación | Efecto |
|---|---|
| `template_id` inexistente | Se listan las disponibles |
| Comando sobre una versión en `SENT` | "Esa rutina ya se envió. ¿Creo una nueva versión?" |
| Día fuera de 1..7 | Mensaje de error, sin cambios |
| Ejercicio con `sets` fuera de 1..10 | Rechazado por `validateDraft` |
| Rutina sin ningún ejercicio al aprobar | Rechazada |
| Texto de más de 2000 caracteres | Truncado |

## 7. Seguridad

- Solo el entrenador ejecuta estos comandos. Se verifica el `profile_id`
  resuelto del webhook, no el ID recibido.
- Se valida que el plan pertenece a un cliente de ese entrenador.
- El texto libre se valida en longitud y se escapa antes de mostrarse.

## 8. Criterios de aceptación

- **CA-1** — DADO un cliente sin evaluación, CUANDO el entrenador usa `/nueva`,
  ENTONCES se crea un plan con `assessment_id` NULL.
- **CA-2** — DADO `/usar full-body-3d`, CUANDO se ejecuta, ENTONCES se crea una
  versión en `DRAFT` con `source='template'` y `template_id='full-body-3d'`.
- **CA-3** — DADO cualquier operación de esta spec, CUANDO termina, ENTONCES
  **`ai_generations` no tiene ninguna fila nueva**.
- **CA-4** — DADO una versión en `DRAFT`, CUANDO se añade un ejercicio,
  ENTONCES se modifica in-place, sigue en `DRAFT` y `version_number` no cambia.
- **CA-5** — DADO una versión en `SENT`, CUANDO se intenta editar, ENTONCES se
  rechaza y se ofrece crear una versión nueva.
- **CA-6** — DADO una rutina manual con `sets = 15`, CUANDO se valida, ENTONCES
  se rechaza igual que una de la IA.
- **CA-7** — DADO que la base de plantillas está en código, CUANDO se listan,
  ENTONCES no se ejecuta ninguna consulta a PostgreSQL.
- **CA-8** — DADO una evaluación de 4 días nivel intermedio, CUANDO se listan
  las plantillas, ENTONCES `upper-lower-4d` aparece primero.
- **CA-9** — DADO criterios que no encajan con ninguna plantilla, CUANDO se
  listan, ENTONCES se devuelven **todas**, nunca una lista vacía.
- **CA-10** — DADO un cliente con limitaciones, CUANDO se carga una plantilla,
  ENTONCES el borrador incluye un aviso y pasa `validateDraft`.
- **CA-11** — DADO el botón 📋, CUANDO se pulsa, ENTONCES se listan plantillas
  y **ninguna se carga**: hace falta una segunda pulsación.
- **CA-12** — DADO el botón ✍️, CUANDO se pulsa, ENTONCES queda un `DRAFT`
  vacío y el mensaje explica los comandos del editor.
- **CA-13** — DADO dos borradores abiertos, CUANDO se edita sin decir cliente,
  ENTONCES se aplica al más reciente y la respuesta dice de quién es.
- **CA-14** — DADO un comando del editor sin ningún borrador abierto, CUANDO
  se envía, ENTONCES se dice que no hay nada que editar, sin tocar la base.
- **CA-15** — DADO un borrador a medias (un día sin ejercicios), CUANDO se
  edita, ENTONCES **se guarda igual**: la validación completa no bloquea la
  construcción.
- **CA-16** — DADO ese mismo borrador, CUANDO se intenta **aprobar**,
  ENTONCES se rechaza diciendo qué falta, y la versión sigue en `DRAFT`.

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `findTemplate` con id válido e inválido |
| Unit | `templatesFor` filtra y ordena por criterios |
| Unit | Las 4 plantillas pasan `validateDraft` |
| Unit | `applyEditCommand` para cada comando del editor |
| Unit | `validateDraft` rechaza manual inválido igual que IA inválida |
| Integration | CA-1 a CA-5 |
| **E2E-1** | Manual completo: crear → editar → aprobar → enviar, **sin IA** |

## 10. Archivos

```
supabase/functions/_core/templates.ts
supabase/functions/_core/templates.test.ts
supabase/functions/_core/domain/workout.ts          ✅ S-07
supabase/functions/_core/domain/draft.ts            ✅ S-07
supabase/functions/_core/domain/validate-draft.ts   ✅ S-07
supabase/functions/_core/domain/validate-draft.test.ts ✅ S-07
supabase/functions/_core/editor/commands.ts
supabase/functions/_core/editor/commands.test.ts
supabase/functions/telegram-webhook/handlers/editor.ts
```
