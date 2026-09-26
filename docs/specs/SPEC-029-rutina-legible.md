# SPEC-029 — La rutina se lee de un vistazo

| Campo | Valor |
|---|---|
| **Estado** | BORRADOR |
| **Depende de** | SPEC-002, SPEC-005, SPEC-008 |
| **Sesiones** | S-43 |

## 1. Objetivo

La rutina, venga de la IA, de una plantilla o del editor, se lee en un
móvil sin esfuerzo: un ejercicio por bloque, números claros, notas cortas y
ningún asterisco suelto.

## 2. Diagnóstico

La IA **no formatea nada**: devuelve JSON (`summary`, `days`, `warnings`) y
el texto lo arman `formatWorkout` (entrenador) y `formatForClient` (cliente).
Con una respuesta típica del modelo sale esto:

```
🏋️ Rutina para Carlos Pérez (v2)

Rutina de 3 días enfocada en **hipertrofia** y fuerza general, con énfasis
en la técnica y progresión de cargas semana a semana, adaptada a tu molestia
lumbar evitando cargas axiales pesadas.

━━━ Día 1 — Tren superior - Empuje (pecho, hombro, tríceps) ━━━
1. Press de banca con mancuernas (inclinado 30°) — 4x8-10 · 90s
   _Mantén las escápulas retraídas y baja controlado en 3 segundos. Si
   sientes molestia en el hombro, reduce el rango de movimiento._
2. Fondos en banco — 3x12-15 · 60s
```

Cinco problemas, dos de ellos de fondo:

| # | Problema | Causa |
|---|---|---|
| 1 | `**hipertrofia**` sale con los asteriscos | El modelo escribe Markdown y nosotros lo escapamos |
| 2 | Todo el ejercicio en una línea densa, `4x8-10 · 90s` | El renderizador |
| 3 | Notas largas en cursiva, difíciles de leer | El prompt no pide brevedad; el renderizador usa cursiva |
| 4 | La cabecera `━━━ … ━━━` se parte en dos líneas en el móvil | El renderizador |
| 5 | **El resumen menciona la lesión y llega al cliente** | El prompt no lo prohíbe. Rompe la intención de SPEC-005 regla 5 |

Y uno latente: **nadie parte los mensajes largos.** El adaptador corta en
4096 caracteres (`text.slice`), así que una rutina de 6–7 días perdería el
final, y el corte puede caer en mitad de un escape de MarkdownV2 y hacer que
Telegram rechace el mensaje entero.

## 3. Alcance

**Incluye:**
- Un formato nuevo, común a entrenador y cliente (§4).
- Reglas de estilo en el prompt (§5).
- Partir la rutina en varios mensajes cuando no cabe en uno (§6).

**No incluye:**
- Cambiar `WORKOUT_LIMITS` ni el esquema: una versión antigua con notas
  largas tiene que seguir validando y editándose.
- Tocar el contenido guardado. Todo es presentación.
- Imágenes, PDF o enlaces a vídeos de ejercicios.

## 4. El formato nuevo

### Vista del entrenador

```
🏋️ Rutina para Carlos Pérez · v2

Hipertrofia y fuerza general, 3 días. Progresión de cargas cada semana.

📅 Día 1 · Empuje

1. Press inclinado con mancuernas
   4 × 8–10 · descanso 1 min 30 s
   💡 Escápulas atrás, baja en 3 s.

2. Fondos en banco
   3 × 12–15 · descanso 1 min

📅 Día 2 · Tirón
…

⚠️ Tenido en cuenta
• Molestia lumbar: sin peso muerto convencional, se usa hip thrust.
```

### Vista del cliente

La misma estructura, con su cabecera (`👋 Hola Carlos, tu rutina está
lista.` y la línea `🎯 objetivo · días · minutos`) y **sin** el bloque de
advertencias. El pie actual (`💬 Cualquier duda…`) se mantiene.

Los ejercicios del cliente también van **numerados**: «el 3 del día 2 me
molesta» es más fácil de escribir que describirlo.

## 5. Reglas de negocio

### Presentación (`_core/telegram/format.ts` y `client-format.ts`)

1. **Cada ejercicio es un bloque de 2 o 3 líneas**, separado del siguiente
   por una línea en blanco: nombre en negrita con su número; series y
   repeticiones con su descanso; la nota, si la hay.
2. **Series:** `4 × 8–10`. El guion entre dos números pasa a `–`; lo demás
   de `reps` («AMRAP», «30 s», «al fallo») se muestra tal cual.
3. **Descanso en palabras:** `0` → `sin descanso`; menos de 60 → `45 s`;
   múltiplo de 60 → `2 min`; lo demás → `1 min 30 s`.
4. **Nota con 💡 y sin cursiva.** La cursiva larga es lo que peor se lee.
5. **Cabecera de día:** `📅 Día N · <enfoque>`, en negrita, con una línea en
   blanco antes y después. Sin `━━━`.
6. **Limpieza del texto libre al mostrarlo:** se quitan `**`, `__`, las
   comillas invertidas y las viñetas iniciales (`- `, `* `, `• `) que el
   modelo mete por costumbre. Afecta solo a lo que se muestra: lo guardado
   no cambia. Se aplica igual a plantillas y rutinas manuales.
7. **Advertencias (solo entrenador):** un título `⚠️ Tenido en cuenta` y
   una viñeta por advertencia.
8. La numeración de la vista del entrenador **es la misma** que usan
   `/quitar <día> <n>` y `/nota <día> <n>` (SPEC-004). No cambia.

### Estilo pedido a la IA (`_core/ai/prompt-builder.ts`)

9. Se añaden a las REGLAS DE SALIDA (que siguen yendo al final):
   - `summary`: una o dos frases, **máximo 200 caracteres**, hablándole al
     cliente de tú. **Sin mencionar lesiones, condiciones ni fármacos**:
     eso va en `warnings`, que el cliente no ve.
   - `focus`: de 2 a 4 palabras («Empuje», «Pierna y glúteo»).
   - `name`: solo el nombre del ejercicio, sin series ni explicaciones.
   - `reps`: solo el número o el rango («8-10», «12», «30 s»).
   - `notes`: una indicación técnica de **máximo 80 caracteres**, o vacío.
     Sin repetir series ni descanso.
   - `warnings`: una frase corta por cada cosa tenida en cuenta.
   - **Texto plano**: sin Markdown, asteriscos, viñetas ni emojis.
10. Son **instrucciones, no límites**: el esquema y `WORKOUT_LIMITS` no
    cambian. Si el modelo se pasa, la rutina sigue siendo válida y el
    formato de §4 la hace legible igual.

## 6. Mensajes largos

11. `formatWorkout` y `formatForClient` devuelven **una lista de mensajes**,
    cortada entre días (nunca en mitad de un ejercicio) cuando el texto no
    cabe en 4096 caracteres.
12. **Los botones van en el último mensaje.** Sin ellos no hay decisión
    (SPEC-005 regla 10, SPEC-010 regla 10).
13. Si un solo día no cabe, se corta entre ejercicios. `splitMessage`, que
    ya existe y tiene tests, hace el último recurso.
14. El recorte a lo bruto del adaptador (`text.slice(0, 4096)`) se queda
    como red de seguridad, pero con esto no debería activarse nunca.

## 7. Estados

No añade ni cambia ninguno.

## 8. Seguridad

- La regla 9 cierra una fuga: hoy el `summary` puede decirle al cliente, en
  un chat que ve cualquiera que le coja el móvil, lo que SPEC-005 regla 5
  quiso dejar solo para el entrenador.
- El escapado de MarkdownV2 se sigue aplicando a TODO texto libre, después
  de la limpieza de la regla 6.

## 9. Criterios de aceptación

- **CA-1** — DADO un ejercicio con nota, CUANDO se formatea, ENTONCES sale
  en tres líneas: `*N\. nombre*`, `S × reps · descanso …`, `💡 nota`.
- **CA-2** — DADO `restSeconds` 0, 45, 60, 90 y 150, ENTONCES se leen
  `sin descanso`, `45 s`, `1 min`, `1 min 30 s`, `2 min 30 s`.
- **CA-3** — DADO `reps` «8-10», ENTONCES se muestra `8–10`; DADO «AMRAP»,
  se muestra igual.
- **CA-4** — DADO un texto con `**negrita**` y una viñeta `- ` inicial,
  CUANDO se muestra, ENTONCES no aparecen ni los asteriscos ni el guion, y
  el contenido guardado no cambia.
- **CA-5** — DADO una rutina con advertencias, CUANDO la ve el cliente,
  ENTONCES no aparece ninguna. CUANDO la ve el entrenador, aparecen bajo
  `⚠️ Tenido en cuenta`.
- **CA-6** — DADO una rutina de 7 días con 10 ejercicios con nota larga,
  CUANDO se formatea, ENTONCES sale en más de un mensaje, ninguno supera
  4096 caracteres, ningún ejercicio queda partido y los botones van en el
  último.
- **CA-7** — DADO el prompt, ENTONCES contiene las reglas de estilo de §5.9
  **después** de todo texto del cliente y del entrenador.
- **CA-8** — La numeración de la vista del entrenador coincide con la que
  usan `/quitar` y `/nota` (test sobre una misma rutina).
- **CA-9** — Todo mensaje producido pasa el detector de MarkdownV2 de
  `tests/helpers/markdown.ts`.

## 10. Tests

| Nivel | Caso |
|---|---|
| Unit | CA-1 a CA-9 en `format.test.ts`, `client-format.test.ts`, `prompt-builder.test.ts` |
| Integration | Entrega y `/rutina` con una rutina de 7 días: varios mensajes, botones en el último |
| E2E | Los existentes que miran el texto se actualizan al formato nuevo |

## 11. Archivos que toca

```
supabase/functions/_core/telegram/format.ts           formatWorkout → string[], helpers de §5
supabase/functions/_core/telegram/client-format.ts    formatForClient → string[]
supabase/functions/_core/telegram/notify.ts           envía la lista, botones al final
supabase/functions/_core/telegram/delivery.ts         ídem
supabase/functions/_core/commands/router.ts           /rutina: ídem
supabase/functions/_core/creation/editor-session.ts   ídem
supabase/functions/_core/ai/prompt-builder.ts         reglas de estilo
+ sus tests
docs/specs/SPEC-002, SPEC-005                          referencia a esta spec
```
