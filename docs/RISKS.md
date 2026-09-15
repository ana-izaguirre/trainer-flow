# TrainerFlow — Riesgos

Escala: **Probabilidad** (baja/media/alta) × **Impacto** (bajo/medio/alto/crítico).

## Resumen

| # | Riesgo | P | I | Estado |
|---|---|---|---|---|
| R-01 | Gemini propone un ejercicio contraindicado | Media | **Crítico** | Mitigado por diseño |
| R-02 | Secretos filtrados a GitHub | Baja | **Crítico** | Mitigado |
| R-03 | La invocación asíncrona no es confiable | Media | Alto | Plan B definido |
| R-04 | La calidad de las rutinas no convence al entrenador | Media | **Alto** | Sin mitigar |
| R-05 | El cliente no usa Telegram | Media | Alto | Mitigado parcialmente |
| R-06 | El alcance crece y el MVP no se termina | **Alta** | Alto | Mitigado |
| R-07 | Límites del tier gratuito de Gemini durante pruebas | Alta | Medio | Mitigado |
| R-08 | El payload de Tally no es el que asumimos | **Alta** | Bajo | Mitigado |
| R-09 | `pg_cron` / `net.http_post` no disponibles en el plan gratuito | Media | Medio | Plan B definido |
| R-10 | Supabase pausa el proyecto por inactividad | Media | Medio | Aceptado |
| R-11 | Fricción entre Deno y Node en el híbrido | Media | Bajo | Mitigado |
| R-12 | Un desconocido encuentra el bot | Media | Alto | Mitigado |

---

## R-01 — Gemini propone un ejercicio contraindicado

**El riesgo más serio del proyecto: puede lesionar a una persona real.**

Gemini no entiende de medicina. Puede proponer press militar a alguien con una
lesión de hombro.

**Mitigación (ya en el diseño):**
- El entrenador revisa **toda** rutina antes de que salga. Es el control real.
- El prompt incluye las limitaciones de forma explícita y obligatoria.
- `WorkoutContent.warnings` obliga a Gemini a declarar qué limitaciones tuvo
  en cuenta, y el entrenador lo ve destacado en el mensaje.
- La máquina de estados hace imposible saltarse la revisión.

**Riesgo residual:** el entrenador aprueba sin leer con atención.
No es un problema de software. Conviene hablarlo con él explícitamente.

## R-02 — Secretos filtrados a GitHub

**Mitigación:** `.gitignore` cubre `.env*`, se versiona solo `.env.example`,
los secretos viven en `supabase secrets`. Revisión obligatoria en S-23.

**Si ocurre:** rotar la clave inmediatamente. Borrarla del historial no basta:
si estuvo en un repo, hay que asumirla comprometida.

## R-03 — La invocación asíncrona no es confiable

El patrón "responder 200 y disparar sin `await`" (ADR-002) puede fallar: la
Edge Function podría terminar antes de que la invocación salga.

**Síntoma:** planes que se quedan en `NEW` para siempre.

**Plan B (ya previsto):** un job de `pg_cron` cada minuto que barre los planes
en `NEW` con más de 2 minutos de antigüedad y los procesa. Más lento, pero
confiable. La idempotencia hace que sea seguro tener ambos mecanismos.

**Detección:** una consulta de planes atascados en `NEW` en S-22.

## R-04 — La calidad de las rutinas no convence al entrenador

**Este es el riesgo de producto, no de software.** El sistema puede funcionar
perfectamente y ser inútil si las rutinas son malas y hay que reescribirlas
enteras.

**Sin mitigar todavía.** Lo que propongo:

1. **Validar antes de S-11.** Pegar 3 evaluaciones reales en la interfaz web
   de Gemini y enseñarle los resultados al entrenador. Si no le sirven, el
   problema es el prompt, y sale mucho más barato descubrirlo antes de
   construir la integración.
2. **Métrica de éxito:** porcentaje de rutinas aprobadas sin edición.
   Por debajo del 50%, el prompt necesita trabajo.
3. Iterar el prompt **con él**, usando su vocabulario y sus criterios.

## R-05 — El cliente no usa Telegram

Telegram es minoritario en varios países. El cliente puede no tenerlo o no
querer instalarlo.

**Mitigación parcial:** entrega diferida (SPEC-005) — el plan aprobado no se
pierde, espera. El entrenador puede reenviar el enlace.

**Riesgo residual:** si varios clientes se niegan, hace falta un canal
alternativo (PDF, enlace web, WhatsApp). **No está en V1.**

**Validación barata:** preguntar a 3 clientes reales antes de S-17.

## R-06 — El alcance crece y el MVP no se termina

**El riesgo más probable de todos.** 45 minutos al día es poco margen.

**Mitigación:**
- `PRODUCT.md` tiene una lista explícita de lo que NO se construye.
- `ROADMAP.md` tiene un orden de recorte ya decidido, para no improvisar bajo
  presión.
- SDD: una funcionalidad sin spec no se implementa. La spec es el freno.

## R-07 — Límites de Gemini durante el desarrollo

Probar la generación consume cuota. Se puede agotar en pleno desarrollo.

**Mitigación:** los tests **siempre** mockean Gemini (regla de `TESTING.md`).
Las llamadas reales se reservan para validación manual. La ruta `MANUAL` de
SPEC-002 hace que agotar la cuota no bloquee el trabajo.

## R-08 — El payload de Tally no es el que asumimos

Muy probable: el parser se está diseñando sin haber visto un payload real.

**Mitigación:** S-06 empieza capturando un payload real en
`tests/fixtures/tally-payload.json`, y el parser se escribe contra ese
fixture. `raw_payload` se guarda íntegro siempre, así que ningún dato se
pierde aunque el parsing falle.

**Impacto bajo** porque está aislado en un solo módulo de `_core`.

## R-09 — `pg_cron` o `net.http_post` no disponibles

Los check-ins semanales dependen de un scheduler.

**Plan B:** GitHub Actions con `schedule:` llamando a la Edge Function.
Gratis, confiable, y ya tienes el repo.

**Plan C:** el entrenador lanza los check-ins con un comando de Telegram.

## R-10 — Supabase pausa el proyecto por inactividad

El plan gratuito pausa proyectos tras un periodo sin actividad. Con 10 clientes
el tráfico es bajo.

**Mitigación:** el cron semanal genera actividad. **Riesgo aceptado** en V1;
la primera petición tras una pausa simplemente tarda más.

## R-11 — Fricción entre Deno y Node

Deno exige extensión `.ts` en los imports; Node y Vitest necesitan
configuración para tolerarlo.

**Mitigación:** se resuelve una sola vez en S-01, con un test trivial que
importa desde `_core`. Si no funciona ahí, no se avanza.

## R-12 — Un desconocido encuentra el bot

Los bots de Telegram son públicos. Cualquiera puede escribirle.

**Mitigación:** toda interacción valida el `chat_id` contra el entrenador o un
cliente registrado (SPEC-003, SPEC-004, SPEC-007). Un desconocido no puede
aprobar rutinas ni obtener datos. Los intentos se registran.

---

## Revisión

Estos riesgos se revisan al cerrar cada bloque del roadmap. Un riesgo que se
materializa deja de ser riesgo y pasa a ser trabajo: se le escribe una spec.
