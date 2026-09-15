# TrainerFlow — Roadmap por sesiones

**Sesión = ~45 minutos de trabajo real.**

Cada sesión tiene un objetivo, un entregable concreto y un criterio de cierre.
Si una sesión no cierra, se continúa en la siguiente. No se avanza con una
sesión a medias.

**24 sesiones ≈ 18 horas ≈ 4–5 semanas a 45 min/día.**

> El plan original eran 21 días. Con TDD y tests E2E como requisito, 24
> sesiones es la estimación honesta. El calendario es flexible; el orden no.

---

## Por qué este orden

La máquina de estados va en la **sesión 5**, antes que cualquier integración.
Es la pieza de la que depende el principio del producto (ningún plan llega al
cliente sin aprobación). Construirla primero y con cobertura total significa
que ninguna integración posterior puede romperlo por accidente.

---

## Bloque 1 — Cimientos (S-01 → S-04)

*Objetivo: los datos entran y se guardan bien.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-01** | Setup del entorno | Supabase CLI vinculado, estructura de carpetas, Vitest, secretos cargados | `supabase start` levanta y `pnpm test` corre en verde con un test trivial |
| **S-02** | Esquema, parte 1 | Migración con enum `plan_state` + `trainers`, `clients`, `assessments` | `supabase db reset` aplica sin error |
| **S-03** | Esquema, parte 2 | `workout_plans`, `plan_events`, `checkins`, `webhook_events`, `ai_usage` + tipos generados | `database.types.ts` compila |
| **S-04** | RLS y constraints | Migración de políticas + tests de integración del esquema | **SPEC-000 cerrada** — CA-1 a CA-7 en verde |

## Bloque 2 — El corazón (S-05 → S-08)

*Objetivo: la lógica que protege el principio del producto.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-05** | Máquina de estados (TDD) | `_core/state-machine.ts` | **100% de transiciones cubiertas**, válidas e inválidas. `DRAFT→SENT` imposible |
| **S-06** | Parser de Tally (TDD) | Fixture real capturado + `_core/tally-parser.ts` | Payload completo, campos faltantes y tipos incorrectos, todos cubiertos |
| **S-07** | Webhook: seguridad | Verificación de firma + idempotencia en `tally-webhook` | El mismo `eventId` dos veces produce **un solo** efecto |
| **S-08** | Webhook: escritura | Cliente, evaluación, plan en `NEW`, `link_token` | **SPEC-001 cerrada** — CA-1 a CA-7 en verde |

## Bloque 3 — Inteligencia (S-09 → S-11)

*Objetivo: Gemini genera, con límites y red de seguridad.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-09** | Rate limit (TDD) | `_core/rate-limit.ts` | Bajo, en el límite exacto, sobre el límite y ventana expirada, cubiertos |
| **S-10** | Prompt y validación (TDD) | `_core/prompt-builder.ts` + `_core/plan-validator.ts` | JSON roto, días incorrectos y sets fuera de rango, rechazados |
| **S-11** | Función `generate-plan` | Adaptador de Gemini + handler | **SPEC-002 cerrada** — incluido el camino `MANUAL` |

## Bloque 4 — El entrenador (S-12 → S-16)

*Objetivo: revisar y decidir desde Telegram.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-12** | Bot operativo | Bot creado, webhook registrado, secreto verificado, autorización por `chat_id` | Un `chat_id` desconocido es rechazado y registrado |
| **S-13** | Formateo (TDD) | `_core/telegram-format.ts` | Escapado de MarkdownV2 y división a 4096 caracteres, cubiertos |
| **S-14** | Envío al entrenador | Mensaje con los tres botones | **SPEC-003 cerrada** |
| **S-15** | Aprobar y rechazar | Handlers de `callback_query` | Doble pulsación no duplica. `answerCallbackQuery` < 3s |
| **S-16** | Editar | Flujo conversacional + versionado | **SPEC-004 cerrada** — `version = 2` tras una edición |

## Bloque 5 — El cliente (S-17 → S-18)

*Objetivo: la rutina llega a quien la va a usar.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-17** | Vinculación | Deep link + `/start <token>` | `telegram_chat_id` guardado. Token inválido da respuesta neutra |
| **S-18** | Entrega | Mensaje al cliente + entrega diferida | **SPEC-005 cerrada** — aprobar sin vincular no pierde la rutina |

## Bloque 6 — Seguimiento (S-19 → S-21)

*Objetivo: el ciclo semanal se cierra solo.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-19** | Cron de check-ins | `pg_cron` + `weekly-checkin` | Correr el cron dos veces **no duplica** check-ins |
| **S-20** | Respuestas | Captura + aviso de molestias | **SPEC-006 cerrada** |
| **S-21** | Comandos | `/clientes`, `/cliente`, `/pendientes`, `/checkins`, `/ayuda` | **SPEC-007 cerrada** — un cliente no obtiene datos |

## Bloque 7 — Cierre (S-22 → S-24)

*Objetivo: funciona de verdad, con una persona real.*

| # | Objetivo | Entregable | Cierra cuando |
|---|---|---|---|
| **S-22** | E2E camino crítico | Test de los 9 pasos | Pasa en verde, sin llamadas externas reales |
| **S-23** | E2E degradación + seguridad | Test de Gemini caído + repaso de `SECURITY.md` | El sistema responde con Gemini en `429`. Cero secretos en git |
| **S-24** | Deploy y prueba real | Funciones desplegadas + un cliente real de principio a fin | El entrenador aprueba una rutina y el cliente la recibe |

---

## Regla de cierre de sesión

Antes de cerrar cualquier sesión:

1. Los tests están en verde.
2. El trabajo está commiteado con un mensaje que referencia la spec.
3. Si la sesión cierra una spec, su estado pasa a `IMPLEMENTADA`.
4. Si algo quedó abierto, se anota al inicio de la siguiente sesión.

## Si el tiempo aprieta

Orden de recorte, de menos a más doloroso:

1. **S-21** (comandos) — el entrenador puede consultar en Supabase mientras tanto.
2. **S-19/S-20** (check-ins) — se pueden hacer a mano con 10 clientes.
3. **S-16** (editar) — rechazar y regenerar cubre el caso, peor pero funciona.

**Nunca se recorta:** S-05 (máquina de estados), S-07 (idempotencia),
S-12 (autorización). Sin esas tres el sistema no es seguro.
