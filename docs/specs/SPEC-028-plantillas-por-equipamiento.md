# SPEC-028 — Plantillas según el equipamiento del cliente

| Campo | Valor |
|---|---|
| **Estado** | **BORRADOR — pendiente de aprobación** |
| **Depende de** | SPEC-008, SPEC-016 |
| **Sesiones** | Por asignar |
| **Origen** | Revisión del orden de plantillas (septiembre 2026), con las opciones reales del formulario |

## 1. Objetivo

Que la primera plantilla que ve el entrenador sea **una que el cliente pueda
hacer con el equipo que tiene**, y que haya plantillas para quien entrena en
casa con mancuernas o con bandas.

## 2. El problema

### El bug: la plantilla de casa nunca encaja

El formulario manda el equipamiento como las opciones marcadas, separadas por
coma (`field-mapping.ts`):

```
Sin equipamiento · Mancuernas · Barra y discos · Bandas elásticas · Banco ·
Kettlebell · Máquinas de gimnasio · Cardio (cinta, bicicleta, elíptica, etc.) · Otro
```

`templatesFor` compara ese texto con el `equipment` de cada plantilla. La de
casa dice `'Ninguno'`, que **no es ninguna opción del formulario**, así que
nunca suma su punto. Las de gimnasio dicen `'Gimnasio'` y solo encajan por
casualidad con «Máquinas de gimnasio». Los tests usaban `'Ninguno'` y no lo
vieron.

Medido hoy, con respuestas reales:

| Cliente | Primera plantilla hoy | ¿Puede hacerla? |
|---|---|---|
| Sin equipamiento · 3 días | `full-body-3d` (gimnasio) | ❌ |
| Sin equipamiento · 2 días | `full-body-2d` (gimnasio) | ❌ |
| Mancuernas, Bandas elásticas · 3 días | `full-body-3d` (gimnasio) | ❌ |
| Bandas elásticas · 2 días | `full-body-2d` (gimnasio) | ❌ |
| Máquinas de gimnasio · 4 días | `upper-lower-4d` | ✅ |

### El hueco: no hay plantillas para casa con material

Hay 7 plantillas de gimnasio y 1 sin equipo. Nada para mancuernas ni para
bandas, que son lo más común en casa.

## 3. Decisiones que Ana tiene que tomar

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | ¿Pesa más el equipamiento que los días? | **Sí.** Un ejercicio que no se puede hacer es peor que un número de días distinto, y eso último ya lo ajusta `adaptDays` |
| **D2** | ¿Cómo se agrupan las 9 opciones? | Cuatro niveles (§4) |
| **D3** | ¿Qué plantillas nuevas? | Dos: mancuernas en casa y bandas, de 3 días (§5). Los ejercicios los revisa Ana |

## 4. Cuatro niveles de equipamiento

Cada plantilla declara el nivel que **necesita**. Cada cliente tiene el nivel
**más alto** de lo que marcó.

| Nivel | Opciones del formulario que lo dan |
|---|---|
| `gym` — gimnasio | Máquinas de gimnasio |
| `free_weights` — peso libre | Mancuernas · Barra y discos · Kettlebell |
| `bands` — bandas | Bandas elásticas |
| `none` — sin equipo | Sin equipamiento |

Orden: `gym` > `free_weights` > `bands` > `none`. Quien tiene un nivel puede
hacer todas las plantillas de los niveles de abajo: con mancuernas se puede
hacer una rutina de peso corporal.

**Las que no dan nivel:** Banco, Cardio y Otro. Por sí solos no alcanzan para
ninguna plantilla de fuerza. Un cliente que solo marcó alguna de ellas queda
en `none`. Si **solo** marcó «Otro», o no hay evaluación, el nivel es
**desconocido** y el equipamiento no cuenta al ordenar, como hoy cuando falta
el dato. El detalle que escribió en «Otro» lo ve el entrenador en la ficha.

**Contradicciones.** «Sin equipamiento» + «Mancuernas» da `free_weights`: se
toma lo más alto que marcó. Ya pasa en datos reales (`pipeline.test.ts` tiene
un caso con «Sin equipamiento, Banco, Cardio»).

**Si Ana renombra una opción en Tally**, el texto deja de reconocerse y esa
opción no da nivel. No se rompe nada: el orden vuelve a depender solo de los
días. Un test fija los nueve textos para que el cambio se vea.

## 5. Dos plantillas nuevas

| `id` | Nombre | Días | Nivel | Necesita |
|---|---|---|---|---|
| `home-dumbbells-3d` | En casa, con mancuernas — 3 días | 3 | principiante | `free_weights` |
| `home-bands-3d` | En casa, con bandas — 3 días | 3 | principiante | `bands` |

**`home-dumbbells-3d`**, cuerpo completo con mancuernas:

| Día | Ejercicios |
|---|---|
| 1 · Cuerpo completo A | Sentadilla goblet 3×10-12 · 90 s · Press de pecho con mancuernas en el suelo 3×10-12 · 90 s · Remo con mancuerna 3×10-12 por brazo · 60 s · Plancha frontal 3×30 s · 45 s |
| 2 · Cuerpo completo B | Peso muerto rumano con mancuernas 3×10-12 · 90 s · Press de hombros con mancuernas 3×10-12 · 90 s · Zancadas con mancuernas 3×10 por pierna · 90 s · Curl de bíceps 2×12-15 · 60 s |
| 3 · Cuerpo completo C | Sentadilla búlgara con mancuernas 3×8-10 por pierna · 90 s · Flexiones 3×10-15 · 60 s · Remo inclinado con dos mancuernas 3×10-12 · 60 s · Puente de glúteo con mancuerna 3×12-15 · 60 s |

Nota en el primer ejercicio: *«Si usas kettlebell o barra, cambia por el
equivalente.»*

**`home-bands-3d`**, cuerpo completo con bandas y peso corporal:

| Día | Ejercicios |
|---|---|
| 1 · Cuerpo completo A | Sentadilla con banda 3×12-15 · 60 s · Flexiones 3×10-15 · 60 s · Remo con banda 3×12-15 · 60 s · Plancha frontal 3×30 s · 45 s |
| 2 · Cuerpo completo B | Puente de glúteo con banda 3×15 · 45 s · Press de hombros con banda 3×12-15 · 60 s · Jalón con banda 3×12-15 · 60 s · Caminata lateral con banda 3×12 por lado · 45 s |
| 3 · Cuerpo completo C | Zancadas 3×10 por pierna · 60 s · Aperturas con banda 3×12-15 · 60 s · Face pull con banda 3×15-20 · 45 s *(cuida la postura del hombro)* · Pallof press con banda 3×10 por lado · 45 s |

Nota en el primer ejercicio: *«Elige una banda que te deje terminar las
repeticiones con buena técnica.»*

**Por qué solo de 3 días.** Una por cada combinación de días y equipo serían
28 plantillas para mantener. Con el equipamiento pesando más, `adaptDays` las
lleva a los días del cliente, con aviso, igual que hoy.

## 6. Reglas de negocio

1. **`templatesFor` ordena en este orden de prioridad:**
   1. Las que el cliente **puede hacer** (nivel de la plantilla ≤ el suyo).
   2. Entre esas, las de **su mismo nivel**: quien tiene gimnasio ve primero
      las de gimnasio, no las de peso corporal.
   3. Los **días** exactos.
   4. El **nivel** de experiencia (principiante, intermedio, avanzado).
2. **Sigue sin filtrar** (SPEC-008 regla 7). Las que no puede hacer salen
   **al final**, no desaparecen: el entrenador puede saber algo que el
   formulario no dice.
3. **Nivel desconocido: el equipamiento no cuenta.** El orden es por días y
   nivel, como hoy.
4. **El `equipment` de las plantillas pasa de texto libre al nivel.** El
   nombre que ve el entrenador no cambia.
5. **Las plantillas nuevas pasan `validateDraft`** como cualquier otra, y
   quedan en `templates.ts`, sin migración.
6. **La IA no cambia.** El prompt sigue recibiendo el texto del formulario
   tal cual.

## 7. Estados

Ninguno. Esto solo cambia en qué orden se listan las plantillas.

## 8. Criterios de aceptación

- **CA-1** — DADO «Sin equipamiento» y 3 días, CUANDO se listan, ENTONCES la
  primera es `home-bodyweight-3d`.
- **CA-2** — DADO «Sin equipamiento» y 2 días, CUANDO se listan, ENTONCES la
  primera es `home-bodyweight-3d` (la carga ajusta los días, con aviso).
- **CA-3** — DADO «Mancuernas, Bandas elásticas», CUANDO se listan, ENTONCES
  la primera es `home-dumbbells-3d`.
- **CA-4** — DADO «Bandas elásticas», CUANDO se listan, ENTONCES la primera
  es `home-bands-3d`, y todas las de gimnasio y de mancuernas van detrás de
  las de bandas y peso corporal.
- **CA-5** — DADO «Máquinas de gimnasio» y *n* días, CUANDO se listan,
  ENTONCES la primera es de gimnasio y de *n* días (CA-A1 de SPEC-008 se
  mantiene para quien tiene gimnasio).
- **CA-6** — DADO solo «Otro», o sin evaluación, CUANDO se listan, ENTONCES
  el orden es el de hoy por días y nivel.
- **CA-7** — DADO «Sin equipamiento, Mancuernas», CUANDO se calcula el nivel,
  ENTONCES es `free_weights`.
- **CA-8** — DADO cualquier criterio, CUANDO se listan, ENTONCES salen las 10
  plantillas.
- **CA-9** — Las dos plantillas nuevas pasan `validateDraft` con sus días y
  con 1 a 7 días (ajustadas).

## 9. Tests

| Nivel | Caso |
|---|---|
| Unit | `equipmentTier`: cada una de las 9 opciones, combinaciones, contradicción, solo «Otro», vacío, mayúsculas y tildes |
| Unit | `templatesFor`: CA-1 a CA-8, con los textos **reales** del formulario (se cambian los tests que usaban `'Ninguno'`) |
| Unit | CA-9 en el `it.each` que ya recorre todas las plantillas |

## 10. Archivos que toca

```
supabase/functions/_core/equipment.ts         el nivel a partir del texto del formulario
supabase/functions/_core/equipment.test.ts
supabase/functions/_core/templates.ts         nivel por plantilla, orden, dos nuevas
supabase/functions/_core/templates.test.ts
docs/specs/SPEC-008-creacion-manual-y-plantillas.md   la regla 7 remite aquí
```
