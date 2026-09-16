# SPEC-008 — Creación manual y plantillas

| Campo | Valor |
|---|---|
| **Estado** | **PARCIAL** — plantillas y validación implementadas (S-07, S-08) |

## Resultado parcial

| Pieza | Sesión | Estado |
|---|---|---|
| Modelo `Workout` y `validateDraft` | S-07 | ✅ 61 tests, cobertura 100% |
| Plantillas (`_core/templates.ts`) | S-08 | ✅ 27 tests |
| Editor por comandos | S-10 | ✅ 68 tests, cobertura 100% |
| **E2E-1** (flujo manual completo) | S-11 | ⏳ |
| **Depende de** | SPEC-000 |
| **Sesiones** | S-06, S-07 |

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

### Las tres fuentes convergen

```
IA         → WorkoutDraft { source: 'ai',       raw: unknown }  ─┐
Plantilla  → WorkoutDraft { source: 'template', raw: Workout }  ─┼─► validateDraft()
Manual     → WorkoutDraft { source: 'manual',   raw: unknown }  ─┘        ↓
                                                                      Workout
```

**Un solo camino de validación.** El §4 dice que no queremos tres sistemas.

### Comandos del editor

| Comando | Efecto | Estado |
|---|---|---|
| `/nueva <cliente>` | Crea el plan y muestra: IA · plantilla · desde cero | ⏳ S-11 |
| `/plantillas` | Lista las plantillas aplicables | ⏳ S-11 |
| `/usar <template_id>` | Carga la plantilla en una versión `DRAFT` | ⏳ S-11 |
| `/dia <n> <foco>` | Añade o renombra un día | ✅ |
| `/add <n> <nombre> <series>x<reps> [descanso]` | Añade ejercicio al día `n` | ✅ |
| `/quitar <n> <índice>` | Elimina un ejercicio | ✅ |
| `/nota <n> <índice> [texto]` | Edita la nota; sin texto, la borra | ✅ |
| `/ver` | Muestra la versión actual formateada | ⏳ S-11 |

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
8. **Nunca se selecciona una plantilla automáticamente** (§6). El entrenador
   elige siempre.
9. **Si el cliente declaró limitaciones, `applyTemplate` inyecta un aviso.**
   Una plantilla no sabe nada del hombro de nadie. Sin el aviso, el borrador
   fallaría `validateDraft` con `LIMITATIONS_NOT_ACKNOWLEDGED` y el entrenador
   no podría ni cargarlo. Con él, pasa la misma validación que exigimos a la
   IA y el recordatorio queda a la vista. **Qué ajustar sigue siendo criterio
   del entrenador.**

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
