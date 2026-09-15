# TrainerFlow — Arquitectura

## Vista general

```
[Cliente]
    │ completa formulario
    ▼
[Tally] ──webhook──► [Edge Function: tally-webhook]  (Deno)
                              │
                              ├─► guarda en PostgreSQL
                              └─► responde 200 en <1s
                              │
                              │ (asíncrono)
                              ▼
                     [Edge Function: generate-plan]
                              │
                              ├─► verifica cuota de IA
                              ├─► llama a Gemini
                              └─► guarda borrador → estado TRAINER_REVIEW
                              │
                              ▼
                  [Telegram — chat del ENTRENADOR]
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
          [Editar]       [Rechazar]      [Aprobar]
              │               │               │
              ▼               ▼               ▼
          Gemini v2        REJECTED        APPROVED
              │                               │
              └──► TRAINER_REVIEW             ▼
                                    [Telegram — chat del CLIENTE]
                                              │
                                             SENT
```

---

## Decisiones de arquitectura

### ADR-001 — Híbrido Node + Deno

**Contexto.** Supabase Edge Functions corren en Deno. Ana prefiere trabajar
en Node y el ecosistema de testing de Node es más maduro.

**Decisión.** Proyecto híbrido con una regla estricta de separación:

| Carpeta | Runtime | Contenido | Puede importar |
|---|---|---|---|
| `functions/_core/` | ambos | Lógica de negocio pura | nada externo |
| `functions/_shared/` | Deno | Adaptadores de I/O | Deno, npm, fetch |
| `functions/<nombre>/` | Deno | Handlers HTTP | `_core` y `_shared` |
| `tests/` | Node | Vitest | `_core` |

**Consecuencia.** La lógica importante (máquina de estados, validaciones,
construcción de prompts, parsing) se prueba en Node sin levantar Supabase.
El I/O se prueba manualmente o con integración.

**Restricción.** Nada dentro de `_core/` puede usar `Deno.*`, `process.*`,
`fetch` ni imports de `npm:`. Si necesita I/O, no pertenece a `_core`.

---

### ADR-002 — Webhooks no hacen trabajo lento en línea

**Contexto.** Generar una rutina con Gemini tarda entre 10 y 30 segundos.
Tally corta la conexión antes y reintenta el webhook.

**Problema si se ignora.** Timeout + reintento = rutinas duplicadas y el
cliente nunca recibe nada.

**Decisión.** Todo webhook sigue este patrón:

```
recibir → validar firma → guardar → responder 200 → disparar async
```

`tally-webhook` guarda la evaluación y responde inmediatamente. La generación
ocurre en `generate-plan`, invocada de forma asíncrona.

**Mecanismo de disparo (V1).** Invocación directa sin `await` a la función
`generate-plan`. Si resulta poco confiable, se sustituye por un job de
`pg_cron` que procesa planes en estado `NEW` cada minuto.

---

### ADR-003 — Idempotencia por identificador de evento

**Contexto.** Tally y Telegram reintentan entregas. Un mismo evento puede
llegar dos o tres veces.

**Decisión.** Tabla `webhook_events` con `UNIQUE (source, external_id)`.
Todo webhook inserta ahí primero. Si la inserción viola la restricción de
unicidad, el evento ya fue procesado: se responde 200 y se ignora.

---

### ADR-004 — Todo estado pasa por la máquina de estados

**Contexto.** El principio del producto es que nada llega al cliente sin
aprobación humana. Eso tiene que ser imposible de romper por accidente.

**Decisión.** Una sola función pura en `_core/state-machine.ts` decide si una
transición es válida. Ningún `UPDATE` de estado ocurre fuera de ella.
Cada transición registra una fila en `plan_events`.

**Transición prohibida por diseño:** cualquier camino de `DRAFT` a `SENT`
que no pase por `APPROVED`.

---

### ADR-005 — Degradación controlada de Gemini

**Contexto.** El tier gratuito de Gemini tiene límites por minuto y por día,
que se reinician. No es un saldo que se agota para siempre.

**Decisión.** `ai_usage` registra cada llamada con su timestamp. Antes de
generar se cuenta el uso en la ventana vigente.

```
Solicitud → ¿hay margen en la ventana?
              ├── Sí  → Gemini
              └── No  → estado MANUAL + aviso al entrenador
```

Si Gemini falla o no hay margen, el plan queda en `MANUAL` y el entrenador
recibe un mensaje en Telegram para crear la rutina a mano. El flujo continúa.

---

### ADR-006 — El cliente se vincula con un deep link de Telegram

**Contexto.** Para enviar la rutina al cliente hace falta su `chat_id`, que
solo se obtiene cuando el cliente escribe al bot primero.

**Decisión.** Al guardar la evaluación se genera un `link_token` único.
El cliente recibe (en la pantalla final de Tally) un enlace
`t.me/<bot>?start=<link_token>`. Al abrirlo, el bot recibe
`/start <link_token>`, resuelve el cliente y guarda su `chat_id`.

**Consecuencia.** Un plan aprobado cuyo cliente aún no se vinculó queda en
`APPROVED` (no en `SENT`) y se envía automáticamente en cuanto se vincule.

---

## Capas

```
Interfaz        Telegram / Tally
Handlers        supabase/functions/<nombre>/index.ts
Lógica          supabase/functions/_core/
Datos           PostgreSQL (Supabase)
Externos        Gemini · Telegram API
```

Los handlers no contienen reglas de negocio. `_core` no contiene I/O.
