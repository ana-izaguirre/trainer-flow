# TrainerFlow — Roadmap por sesiones

**Sesión = ~45 minutos de trabajo real.** Cada una tiene objetivo, entregable y
criterio de cierre. No se avanza con una sesión a medias.

**28 sesiones ≈ 21 horas ≈ 5–6 semanas a 45 min/día.**

> Este archivo es **el único sitio** donde se lleva el progreso. El README no
> lo duplica: una tabla en dos sitios es una tabla que va a estar mal en uno
> de los dos.

---

## El orden y su razón

Dos decisiones marcan la secuencia:

**1. La identidad y la máquina de estados van primero (S-05, S-06).** Son las
dos piezas de las que depende todo lo demás. Construirlas antes significa que
ninguna integración posterior puede romperlas por accidente.

**2. El camino manual se construye ANTES que la IA (bloque 3 vs bloque 5).**
En la sesión 11 ya hay un producto usable sin IA. Eso no es un orden arbitrario:
es lo que garantiza que la IA nunca sea punto único de fallo. Si se construye al
revés, el fallback siempre queda "para después".

---

## Bloque 1 — Cimientos ✅ COMPLETADO

| # | Objetivo | Cierra cuando |
|---|---|---|
| **S-01** | Setup del entorno | `supabase start` levanta, tests en verde |
| **S-02** | Esquema, parte 1 | Enums, `profiles`, `clients`, `assessments` |
| **S-03** | Esquema, parte 2 | Planes, versiones, solicitudes, eventos, funciones |
| **S-04** | RLS y tests | **SPEC-000 cerrada** — 44 tests en verde |

## Bloque 2 — El dominio (S-05 → S-08) ✅ COMPLETADO

*Sin esto, nada de lo demás es seguro.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-05** ✅ | Identidad y autorización (TDD) | `_core/authorization.ts` | **Cobertura 100%** verificada, 22 tests. **SPEC-009 parcial** |
| **S-06** ✅ | Máquina de estados (TDD) | `_core/domain/state-machine.ts` | **Cobertura 100%**, 70 tests: 11 válidas + las 43 inválidas |
| **S-07** ✅ | Modelo Workout y Draft (TDD) | `_core/domain/` + `validateDraft` | **Cobertura 100%**, 60 tests. Manual e IA se validan igual |
| **S-08** ✅ | Plantillas | `_core/templates.ts` | 27 tests. Las 4 pasan `validateDraft`. Cero consultas a la base |

## Bloque 3 — Producto usable SIN IA (S-09 → S-11) ✅ COMPLETADO

*Al terminar este bloque ya hay algo que funciona.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-09** ✅ | Bot de Telegram | Webhook, secreto, identidad, idempotencia | 79 tests. Un desconocido recibe respuesta neutra y queda registrado |
| **S-10** ✅ | Editor y formateo | `_core/editor/` + `_core/telegram/format.ts` | 92 tests. Cobertura 100%. MarkdownV2 escapado y división a 4096 |
| **S-11** ✅ | **E2E-1** | Flujo manual completo | ✅ Crear → editar → aprobar → enviar, con **cero filas en `ai_generations`** |

> 🎯 **Hito.** Aquí el producto ya sirve. Todo lo demás lo mejora.

## Bloque 4 — Ingesta (S-12 → S-14) ✅ COMPLETADO

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-12** ✅ | Parser de Tally (TDD) | Fixture real + `_core/assessment/` | Payload completo, campos faltantes y tipos incorrectos |
| **S-13** ✅ | Webhook: seguridad | Firma + idempotencia | El mismo `eventId` dos veces produce **un solo** efecto |
| **S-14** ✅ | Webhook: escritura | Cliente, evaluación, plan, `link_token` | **SPEC-001 cerrada** |

## Bloque 5 — La IA como capacidad (S-15 → S-18) ✅ COMPLETADO

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-15** ✅ | `AIProvider` + rate limit (TDD) | `_core/ports/ai-provider.ts` | Bajo, en el límite, sobre y ventana expirada, cubiertos |
| **S-16** ✅ | Proveedor de Gemini | `_shared/ai/gemini-provider.ts` | **El grep de "gemini" sobre `_core` no devuelve nada** |
| **S-17** ✅ | Función `generate-version` | Handler + degradación | Un fallo devuelve la versión a `NEW`, no la mata |
| **S-18** ✅ | **E2E-2 y E2E-3** | IA completa y fallo de IA | **SPEC-002 cerrada.** Con `429` el producto sigue funcionando |

## Bloque 6 — El cliente (S-19 → S-22) ✅ COMPLETADO

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-19** ✅ | Vinculación | Deep link + `/start <token>` | Token inválido da respuesta neutra |
| **S-20** ✅ | Entrega | Mensaje al cliente + entrega diferida | **SPEC-005 cerrada** salvo el backoff |
| **S-21** ✅ | Cron de check-ins | `pg_cron` + `weekly-checkin` | Correr el cron dos veces no duplica |
| **S-22** ✅ | Respuestas de check-in | Captura + aviso de molestias | **SPEC-006 cerrada** |

## Bloque 7 — El ciclo completo (S-23 → S-25)

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-23** ✅ | Solicitudes de cambio | Botones + aviso al entrenador | Una solicitud **no** muta la versión |
| **S-24** ✅ | **E2E-4** | Ciclo de revisión completo | **SPEC-010 cerrada.** v1 queda byte a byte igual |
| **S-25** ✅ | Comandos del entrenador | `/clientes`, `/cliente`, `/pendientes`… | **SPEC-007 cerrada** |

## Bloque 8 — Cierre (S-26 → S-31)

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-26** ✅ | Observabilidad | `request_id` + logs estructurados + `duration_ms` | **SPEC-012 cerrada.** La cadena no se corta en el salto asíncrono |
| **S-27** ✅ | Seguridad | `tests/integration/security.test.ts` | **SPEC-013 cerrada.** Los 11 casos en verde, y uno estaba roto |
| **S-28** | Deploy y prueba real | Funciones desplegadas + un cliente real | El entrenador aprueba una rutina y el cliente la recibe |
| **S-29** | Progresión en la rutina | `progression` en el `Workout`, los tres orígenes | **SPEC-020.** La rutina dice cómo avanzar, no solo qué hacer |
| **S-30** | Histórico del cliente | `/historial <nombre>` + señales | **SPEC-021.** El entrenador ve la tendencia, no el último dato |
| **S-31** ✅ | Un editor que se entienda | `/rutina`: la rutina entera en un mensaje | **SPEC-022.** Dieciocho comandos pasan a ser uno |

## Por qué la progresión y el histórico sí entran en V1

SPEC-020 y SPEC-021 salieron de la misma conversación que las tres de abajo, y
sin embargo suben al bloque 8. Son las dos mitades de un ciclo:

```
SPEC-020  →  le dice al CLIENTE      cuándo subir el peso
SPEC-021  →  le dice al ENTRENADOR   cuándo cambiar la rutina
```

La diferencia con las de abajo:

> Sin ella, **la semana 3 es idéntica a la semana 1**. El cliente repite el
> mismo peso hasta que el estímulo se apaga, y eso no es un detalle que
> pulir después: es la diferencia entre entregar una rutina y entregar un
> plan.

Y del lado del entrenador, `/cliente` enseña el **último** check-in. «3/4 y
Bien» significa una cosa si viene de 4/4 y otra muy distinta si viene de 2/4:
la tendencia es el dato, y hoy no se ve.

Las dos cuestan poco. SPEC-020 es un campo en un `jsonb` —**cero
migraciones**— y SPEC-021 solo lee datos que ya se guardan desde el primer
día: `checkins`, `change_requests` y `plan_events` se llenan solos.

Lo caro de verdad —registrar el peso que el cliente levantó— se descarta a
propósito, con su razón escrita, en SPEC-020 §3.2.

## Deuda técnica encontrada auditando el estado (S-49)

No son specs todavía: son hallazgos concretos de revisar la máquina de
estados entera buscando callejones sin salida, del tamaño de un PR cada uno.
Se listan aquí, en el orden en que conviene atacarlos, para no perderlos.

| # | Qué | Tamaño | Por qué en este orden |
|---|---|---|---|
| 1 | ✅ `/cliente <nombre>` sin botones — cuatro estados sin ningún camino de vuelta | Un PR | Bloqueaba el trabajo real de Carlos. Hecho en S-49 — ver `STATE-MACHINE.md` |
| 2 | ✅ Vigía para `GENERATING` atascada de verdad | Media tarde | Hecho en S-49: `sweep-generating` + `pg_cron` cada 5 min, mismo patrón que SPEC-006. Falta el paso manual de `docs/DEPLOY.md` §8b al desplegar |
| 3 | ✅ El botón «Editar» de `/pendientes` no hacía nada | Una hora | Hecho en S-49: redirige a `/ver` en vez de fingir. El flujo conversacional de la regla 6 sigue PARCIAL — eso es una feature nueva, no este arreglo |
| 4 | ✅ Reenviar el enlace de vinculación de un cliente | Una hora | Hecho en S-49: botón 🔗 en la ficha, SPEC-014 §3.1. `client_for_resend` dedicada — el token no viaja por `trainer_client_detail` |
| 5 | ✅ Deduplicar `tieneCaracterSinEscapar` entre archivos de test | Media hora | Hecho en S-49, tras mergearse el #58: eran 6 copias (no 3), en `tests/helpers/markdown.ts` |

## Los dos huecos que sí se notan en el mes uno

No salieron de pedirlos: salieron de leer el código buscando otra cosa. Son
los primeros de la cola cuando S-28 termine.

| Spec | El hueco | Tamaño |
|---|---|---|
| **SPEC-023** | **El cliente no puede volver a ver su rutina.** No tiene ningún comando: si archiva el chat, la perdió | Una tarde |
| **SPEC-024** | **Un cliente que se va recibe check-ins para siempre.** `clients` no tiene ningún estado, y un plan `SENT` se queda `SENT` | Una migración y tres comandos |

El segundo es el que da vergüenza: manda veinte mensajes antes de que nadie se
dé cuenta, y contamina las señales de SPEC-021 con gente que se fue en marzo.

## Después del MVP — pedido por el entrenador al usarlo

Tienen spec escrita y esperan turno.

| Spec | Qué resuelve | Por qué no es urgente |
|---|---|---|
| **SPEC-026** | **El progreso medido: ¿está funcionando?** | Una pregunta de peso cada 4 semanas. Los datos del cuerpo se capturan hoy **una vez** y no se vuelven a tocar |
| **SPEC-025** | **Videos del cliente para corregir técnica** | La que más diferencia y de las más baratas: Telegram guarda el video, se guarda el `file_id`. Pero no se decide bien sin ver cómo usan el bot |
| **SPEC-017** | Plantillas editables desde la base | Hoy se cambian con un despliegue. Primero conviene ver **cuánto** las cambia |
| **SPEC-018** | Sus preferencias en cada prompt | Es lo que hace que las rutinas se parezcan a **las suyas** |

> **«Progresión» son TRES cosas, y conviene no confundirlas:**
>
> | | Qué responde | Dónde |
> |---|---|---|
> | De la rutina | «¿Cuándo subo el peso?» | SPEC-020 · V1 |
> | De adherencia | «¿Está cumpliendo?» | SPEC-021 · V1 |
> | **Medida** | **«¿Está funcionando?»** | **SPEC-026** |
>
> Las dos primeras pueden ir perfectas y la tercera ser un desastre: alguien
> que entrena las 4 sesiones, se siente bien, y lleva tres meses sin moverse
> hacia su objetivo.

> **SPEC-025 sigue siendo la prioridad pendiente de este bloque.** Las
> ilustraciones de SPEC-019 (abajo, ya implementada) ayudan al cliente a
> ejecutar; el video deja al entrenador **entrenar**. La rutina la genera
> cualquiera; corregir una sentadilla mirando un video es él.

---

## Tres decisiones tomadas, para no volver sobre ellas

### SPEC-019 enlaza a RepDB, no a workout-guide — y ya está implementada

La decisión original de esta sección nombraba la librería
[workout-guide](https://github.com/bryllim/workout-guide) (302 ejercicios).
Se cambió por [RepDB](https://github.com/yuhonas/free-exercise-db) (601
ejercicios reales) antes de implementar, y la spec (`docs/specs/SPEC-019`) ya
refleja esto — lo que quedaba atrás era este resumen.

**Que la IA genere links de YouTube sigue descartado.** El modelo se inventa
identificadores de vídeo: URLs con buena pinta que son 404 o, peor, un vídeo
real que no corresponde.

El diseño implementado, en dos capas — y sin que la IA sepa de slugs:

```
¿El ejercicio nombrado está en el diccionario (plantillas, después RepDB)?
   SÍ  → ilustración real (comparación de strings, local, DESPUÉS de generar)
   NO  → link de BÚSQUEDA en YouTube (armado con el nombre, no generado)
```

La diferencia con el diseño original: no es "la IA elige un slug de una lista
cerrada o `null`" — eso seguía dándole al modelo una forma de inventar. Es
`_core/exercise-library.ts` comparando el nombre que el modelo ya escribió
contra el diccionario, sin que la IA sepa que el diccionario existe. Así
ningún cliente se queda sin referencia, y no hay nada que el modelo pueda
inventar mal.

**Empezó por las plantillas**: 48 ejercicios, mapeo hecho a mano, cobertura
completa y riesgo cero (`TEMPLATE_EXERCISE_SLUGS`). Lo que nombra la IA cae
al diccionario ampliado de los 601 de RepDB — con menos acierto que las
plantillas, porque el prompt no orienta hacia nombres reconocibles (ver
SPEC-032 §4, resuelto en S-52).

### El dashboard es V2, y de solo lectura

Telegram se queda corto para **ver**: la cartera entera, las tendencias, varios
clientes a la vez. Un dashboard completo es un proyecto; uno de solo lectura es
una semana.

```
Escribir  →  sigue en Telegram (aprobar, editar, enviar)
Leer      →  web (clientes, rutinas, check-ins, de un vistazo)
```

Sale barato por una razón concreta: **`_core` es TypeScript puro sin
dependencias**, así que una web en Node importa el mismo dominio, las mismas
validaciones y el mismo formateo. No se reimplementa nada. Esa decisión, que en
su momento fue por los tests (ADR-001), es la que regala el dashboard.

**No entra en V1.** Nada de lo que hay que aprender de los primeros dos meses
se aprende más rápido teniéndolo.

### WhatsApp queda descartado — ver ADR-012

No es una postergación, es una decisión, y está razonada entera en
`ARCHITECTURE.md`. En corto:

| | |
|---|---|
| **El coste técnico** | ~4.850 líneas de Telegram viven **dentro de `_core`**. No es transporte, es la interfaz del producto: teclados, `callback_data`, deep links |
| **El coste externo** | La Business API cobra por conversación, exige aprobación de Meta, y **no deja escribir primero** sin plantilla pre-aprobada — justo lo que hace el check-in semanal |

**Se revisa solo por una razón de negocio, no técnica:** que los clientes de
verdad no usen Telegram. Y entonces el puerto `MessagingProvider` se mete
**antes** de construir nada nuevo encima.

---

## Regla de cierre de sesión

Antes de cerrar cualquier sesión:

1. `pnpm typecheck` pasa.
2. `pnpm lint` pasa.
3. Los tests están en verde.
4. El trabajo está commiteado, con el mensaje referenciando la spec.
5. Si la sesión cierra una spec, su estado pasa a `IMPLEMENTADA`.
6. Lo que quedó abierto se anota al inicio de la siguiente.

## Si el tiempo aprieta

Orden de recorte, de menos a más doloroso:

1. **S-25** (comandos) — se puede consultar en Supabase Studio mientras tanto.
2. **S-21/S-22** (check-ins) — con 10 clientes se hacen a mano.
3. **S-23/S-24** (solicitudes de cambio) — el cliente puede escribirle por chat.
4. **Bloque 5 entero** (la IA) — 😮 **sí, se puede recortar.** Ese es el punto:
   el producto ya funciona desde la sesión 11.

**Nunca se recorta:** S-05 (autorización), S-06 (máquina de estados),
S-13 (idempotencia). Sin esas tres el sistema no es seguro.
