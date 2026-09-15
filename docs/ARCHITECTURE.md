# TrainerFlow — Arquitectura

## Principio rector

**La IA es una capacidad del sistema, no la dueña del dominio.**

El dominio de TrainerFlow es crear y versionar rutinas. La IA es *una* de tres
formas de proponer contenido. El sistema funciona completo sin ella.

```
IA ──────────┐
Plantilla ───┼──► WorkoutDraft ──► validar ──► WorkoutVersion ──► Workout
Manual ──────┘                                    (el entrenador decide)
```

---

## Vista general

```
[Cliente]
    │ completa el formulario
    ▼
[Tally] ──webhook──► [tally-webhook]  (Deno)
                          │  verifica firma → idempotencia → guarda
                          │  responde 200 en <1s
                          ▼  (asíncrono)
                     [generate-version]
                          │  ¿hay margen de cuota?
                          │  AIProvider.generate() ──► WorkoutDraft
                          │  validateDraft() ──► Workout
                          │  éxito → DRAFT   ·   fallo → vuelve a NEW
                          ▼
              [Telegram — chat del ENTRENADOR]
                          │
        ┌─────────────────┼─────────────────┐
     [Editar]         [Rechazar]        [Aprobar]
        │                 │                 │
        ▼                 ▼                 ▼
   DRAFT (in-place)   REJECTED          APPROVED
                                            │
                                          SEND (si está vinculado)
                                            ▼
                               [Telegram — chat del CLIENTE]
                                            │
                                          SENT
                                            │
                              ┌─────────────┴─────────────┐
                        check-in semanal        solicitud de cambio
                                                          │
                                                   nueva versión
```

Cuando la IA falla, el camino es el mismo quitando el bloque de Gemini: el
entrenador elige plantilla o manual y sigue en `DRAFT`.

---

## Decisiones de arquitectura

### ADR-001 — Híbrido Node + Deno

**Contexto.** Las Edge Functions de Supabase corren en Deno. El ecosistema de
testing de Node es mejor.

**Decisión.** Separación estricta por carpeta:

| Carpeta | Runtime | Contenido | Puede importar |
|---|---|---|---|
| `_core/` | ambos | Dominio y reglas de negocio | **nada externo** |
| `_shared/` | Deno | Adaptadores de I/O | Deno, npm, fetch |
| `<función>/` | Deno | Handlers HTTP | `_core` y `_shared` |
| `tests/` | Node | Vitest | `_core` |

**Restricción.** Nada dentro de `_core/` puede usar `Deno.*`, `process.*`,
`fetch`, `npm:` ni librerías. Si necesita I/O, no pertenece a `_core`.

**Consecuencia.** El dominio se prueba en milisegundos sin levantar nada.

**Verificado, no supuesto.** `pnpm deno:check` compila el mismo `_core` con el
compilador de Deno en cada push. El `tsc` de Node comprueba `_core` y los
tests; Deno comprueba además `_shared/` y los handlers, que usan `Deno.env`,
`fetch` e imports `npm:` que Node no puede resolver.

---

### ADR-002 — Los webhooks no esperan a la IA

**Contexto.** Generar una rutina tarda 10–30s. Tally corta antes y reintenta.

**Problema si se ignora.** Timeout + reintento = rutinas duplicadas.

**Decisión.** Todo webhook sigue el patrón:

```
recibir → verificar firma → idempotencia → guardar → responder 200 → disparar async
```

**Plan B.** Si la invocación asíncrona resulta poco confiable, un job de
`pg_cron` barre las versiones atascadas en `NEW`. La idempotencia hace seguro
tener ambos mecanismos.

---

### ADR-003 — Idempotencia por identificador de evento

**Decisión.** `webhook_events` con `UNIQUE (source, external_id)`. Todo webhook
inserta ahí primero. Violación de unicidad = ya procesado → `200` y salir.

También `workout_versions` con `UNIQUE (plan_id, version_number)`: un reintento
no puede crear dos veces la misma versión.

---

### ADR-004 — Todo estado pasa por la máquina de estados

**Decisión.** Una función pura en `_core/domain/state-machine.ts` decide si una
transición es válida. Ningún `UPDATE` de estado ocurre fuera de ella.

**Transición prohibida por diseño: `DRAFT → SENT` no existe.** El único camino a
`SENT` sale de `APPROVED`, y a `APPROVED` solo se llega con una acción del
entrenador.

Ver `STATE-MACHINE.md` para la tabla completa.

---

### ADR-005 — Degradación controlada de la IA

**Contexto.** El tier gratuito limita por ventana de tiempo, que se reinicia.
No es un saldo que se agota. Y las APIs se caen.

**Decisión.** `ai_generations` registra cada intento con su timestamp. Antes de
generar se cuenta el uso en la ventana vigente.

```
Solicitud → ¿hay margen?
              ├── Sí  → AIProvider.generate()
              └── No  → la versión vuelve a NEW + aviso al entrenador
                        → él elige plantilla o manual
```

**La IA nunca es punto único de fallo.** Un fallo no deja la versión muerta:
vuelve a `NEW` y el entrenador continúa por otro camino.

---

### ADR-006 — El cliente se vincula con un deep link

**Decisión.** Al guardar la evaluación se genera un `link_token`. El cliente
abre `t.me/<bot>?start=<token>`, el bot resuelve el cliente y guarda su perfil.

**Consecuencia.** Una versión aprobada cuyo cliente aún no se vinculó queda en
`APPROVED` (no `SENT`) y se envía automáticamente al vincularse.

---

### ADR-007 — `AIProvider`: el core no conoce a Gemini

**Contexto.** El punto §2: debe ser posible cambiar de proveedor sin tocar la
lógica de negocio.

**Decisión.** Una interfaz en `_core`, implementaciones en `_shared`.

```typescript
// _core/ports/ai-provider.ts — cero dependencias
export interface AIProvider {
  readonly name: string;
  generate(request: AIRequest): Promise<AIResult>;
}

export type AIResult =
  | { ok: true; draft: WorkoutDraft; usage: TokenUsage }
  | { ok: false; reason: AIFailureReason; detail: string };
```

```
_core/ports/ai-provider.ts     ← la interfaz. El core solo conoce esto
_shared/ai/gemini-provider.ts  ← implementación. Aquí vive la API key
```

**La palabra "Gemini" no aparece en `_core`.** Ni el modelo, ni la URL, ni la
clave. Añadir otro proveedor es un archivo nuevo en `_shared/`.

**No se implementa un segundo proveedor ahora** (§21). Solo queda preparado.

---

### ADR-008 — Versionado con snapshot completo

**Contexto.** El punto §7: no sobrescribir una rutina ya enviada.

**Decisión.** `workout_plans` agrupa N `workout_versions`. Cada versión guarda
un **snapshot completo** del `Workout` en `jsonb`. `current_version_id` apunta a
la vigente.

**Reglas:**
- Una versión en `DRAFT` se edita **in-place** (aún no salió)
- Una versión en `SENT` **no se toca nunca**. Un cambio produce `version + 1`
- La versión anterior conserva su contenido y su estado

**No se implementa diffing** (§21). Un snapshot completo por versión es
correcto, simple y barato para el volumen del MVP.

**Atomicidad.** Crear la versión, actualizar `current_version_id` y registrar el
evento deben ser todo o nada. `supabase-js` no hace transacciones de varias
sentencias, así que vive en una función de PostgreSQL invocada por RPC. Es la
**única** operación que la necesita.

---

### ADR-009 — Identidad por Telegram, verificada server-side

**Contexto.** El punto §14: sin email ni contraseñas; identidad por Telegram,
verificada en el servidor.

**Decisión.** La identidad sale del webhook, no del cliente.

```
Telegram → POST /telegram-webhook
             ├─ verificar X-Telegram-Bot-Api-Secret-Token
             ├─ si no coincide → 401, no se procesa nada
             └─ update.message.from.id es CONFIABLE
                  (lo envía Telegram, no el usuario)
                       ▼
             profiles WHERE telegram_user_id = ...
```

**No hay frontend en V1**, así que no existe ningún `telegram_user_id` enviado
arbitrariamente. La única fuente es el update verificado.

`profiles` guarda `telegram_user_id` (identidad) y `telegram_chat_id` (destino
de mensajes) por separado: coinciden en chats privados, pero son conceptos
distintos.

**Si algún día hay Telegram WebApp:** se verifica el HMAC de `initData` con el
token del bot y se emite un JWT con un claim `profile_id`. El diseño ya lo
soporta; no se construye ahora.

---

### ADR-010 — Autorización en el core, RLS como red de seguridad

**Contexto.** El punto §16 pide RLS real. Pero con Telegram como única interfaz,
**todas las operaciones pasan por Edge Functions con `service_role`, que salta
RLS por diseño.** Escribir políticas por rol hoy produciría SQL que nunca se
evalúa.

**Decisión — dos capas, con honestidad sobre cuál protege hoy:**

| Capa | Qué hace | ¿Activa hoy? |
|---|---|---|
| `_core/authorization.ts` | Funciones puras. Se invocan **antes** de cada operación. Cobertura 100% | ✅ **Es la que protege** |
| RLS deniega-todo | 10 tablas con RLS activo y cero políticas | ✅ Red contra fugas de `anon key` |
| Políticas por rol | Diseñadas en `SECURITY.md` | ⏳ Se activan cuando exista un JWT |

**Reglas que hace cumplir `_core/authorization.ts`:**
- Un entrenador solo accede a sus propios clientes
- Un cliente solo accede a sus propias rutinas
- Un cliente **nunca** puede modificar una rutina
- Un cliente solo ve versiones en `SENT`, nunca borradores
- Cambiar un ID en una petición no da acceso a nada ajeno

**Por qué así y no al revés.** Escribir 30 políticas inertes daría una falsa
sensación de seguridad. Funciones puras testeadas al 100% son verificables hoy
y se pueden ejecutar en cada test.

**Cuándo cambiar:** cuando exista un cliente que porte un JWT — una WebApp, un
dashboard. Ahí las políticas de `SECURITY.md` se activan y pasan a ser la
segunda capa real.

---

## Capas

```
Interfaz     Telegram · Tally
Handlers     supabase/functions/<nombre>/index.ts
Adaptadores  supabase/functions/_shared/     ← Supabase, Gemini, Telegram
Dominio      supabase/functions/_core/       ← sin dependencias
Datos        PostgreSQL (Supabase)
```

Los handlers no contienen reglas de negocio. `_core` no contiene I/O.
