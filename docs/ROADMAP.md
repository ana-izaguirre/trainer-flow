# TrainerFlow — Roadmap por sesiones

**Sesión = ~45 minutos de trabajo real.** Cada una tiene objetivo, entregable y
criterio de cierre. No se avanza con una sesión a medias.

**28 sesiones ≈ 21 horas ≈ 5–6 semanas a 45 min/día.**

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

## Bloque 3 — Producto usable SIN IA (S-09 → S-11)

*Al terminar este bloque ya hay algo que funciona.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-09** ✅ | Bot de Telegram | Webhook, secreto, identidad, idempotencia | 79 tests. Un desconocido recibe respuesta neutra y queda registrado |
| **S-10** ✅ | Editor y formateo | `_core/editor/` + `_core/telegram/format.ts` | 92 tests. Cobertura 100%. MarkdownV2 escapado y división a 4096 |
| **S-11** | **E2E-1** | Flujo manual completo | **SPEC-008 cerrada.** Crear → editar → aprobar → enviar, **sin una sola llamada a la IA** |

> 🎯 **Hito.** Aquí el producto ya sirve. Todo lo demás lo mejora.

## Bloque 4 — Ingesta (S-12 → S-14)

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-12** | Parser de Tally (TDD) | Fixture real + `_core/tally-parser.ts` | Payload completo, campos faltantes y tipos incorrectos |
| **S-13** | Webhook: seguridad | Firma + idempotencia | El mismo `eventId` dos veces produce **un solo** efecto |
| **S-14** | Webhook: escritura | Cliente, evaluación, plan, `link_token` | **SPEC-001 cerrada** |

## Bloque 5 — La IA como capacidad (S-15 → S-18)

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-15** | `AIProvider` + rate limit (TDD) | `_core/ports/ai-provider.ts` | Bajo, en el límite, sobre y ventana expirada, cubiertos |
| **S-16** | Proveedor de Gemini | `_shared/ai/gemini-provider.ts` | **El grep de "gemini" sobre `_core` no devuelve nada** |
| **S-17** | Función `generate-version` | Handler + degradación | Un fallo devuelve la versión a `NEW`, no la mata |
| **S-18** | **E2E-2 y E2E-3** | IA completa y fallo de IA | **SPEC-002 cerrada.** Con `429` el producto sigue funcionando |

## Bloque 6 — El cliente (S-19 → S-22)

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-19** | Vinculación | Deep link + `/start <token>` | Token inválido da respuesta neutra |
| **S-20** | Entrega | Mensaje al cliente + entrega diferida | **SPEC-005 cerrada** |
| **S-21** | Cron de check-ins | `pg_cron` + `weekly-checkin` | Correr el cron dos veces no duplica |
| **S-22** | Respuestas de check-in | Captura + aviso de molestias | **SPEC-006 cerrada** |

## Bloque 7 — El ciclo completo (S-23 → S-25)

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-23** | Solicitudes de cambio | Botones + aviso al entrenador | Una solicitud **no** muta la versión |
| **S-24** | **E2E-4** | Ciclo de revisión completo | **SPEC-010 cerrada.** v1 queda byte a byte igual |
| **S-25** | Comandos del entrenador | `/clientes`, `/cliente`, `/pendientes`… | **SPEC-007 cerrada** |

## Bloque 8 — Cierre (S-26 → S-28)

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-26** | Observabilidad | `request_id` + logs estructurados + `duration_ms` | Se puede seguir una petición de extremo a extremo |
| **S-27** | Seguridad | `tests/integration/security.test.ts` | Los 11 casos de `SECURITY.md` en verde. Cero secretos en git |
| **S-28** | Deploy y prueba real | Funciones desplegadas + un cliente real | El entrenador aprueba una rutina y el cliente la recibe |

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
