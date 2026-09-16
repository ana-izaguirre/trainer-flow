# 🏋️ TrainerFlow

Herramienta que ayuda a un entrenador personal a crear y hacer seguimiento de
rutinas — **manualmente, con plantillas o con IA**, sin quitarle nunca la
decisión final.

---

## Qué hace

```
El cliente completa un formulario (2-3 min)
            ↓
El entrenador crea la rutina:  IA · plantilla · desde cero
            ↓
La revisa y la edita en Telegram
            ↓
La aprueba
            ↓
El cliente la recibe en Telegram
            ↓
Check-in semanal · puede pedir cambios
```

**Interfaz: Telegram.** No hay dashboard ni app. El entrenador ya lo tiene abierto.

---

## Los dos principios

### 1. La IA propone, el entrenador decide

Una rutina mal adaptada puede lesionar a alguien. Por eso la revisión humana no
es una convención, es estructura:

- **La transición `DRAFT → SENT` no existe.** El único camino a `SENT` sale de
  `APPROVED`, y ahí solo se llega con una acción del entrenador.
- Ningún cambio de estado ocurre fuera de la máquina de estados.
- Cobertura del 100% sobre ella, incluidas las transiciones inválidas.

### 2. La IA es una capacidad, no la dueña del dominio

```
IA ──────────┐
Plantilla ───┼──► WorkoutDraft ──► validar ──► WorkoutVersion
Manual ──────┘
```

Las tres fuentes producen el mismo tipo y pasan por la misma validación.
**Si Gemini se cae, el producto sigue funcionando**: el entrenador usa una
plantilla o escribe la rutina a mano.

La palabra "Gemini" no aparece en `_core/`. El dominio solo conoce la interfaz
`AIProvider`.

---

## Cómo funciona por dentro

### Las cuatro decisiones que importan

**1. El webhook nunca espera a la IA.** Generar tarda 10–30s; Tally corta antes
y reintenta. El patrón es `recibir → guardar → responder 200 → disparar aparte`.

**2. Idempotencia por `UNIQUE (source, external_id)`.** Todo webhook inserta ahí
antes de hacer nada. Si Postgres lo rechaza, el evento ya se procesó.

**3. Versionado con snapshot completo.** Una rutina enviada no se sobrescribe
nunca. Un cambio produce `version + 1`; la anterior queda intacta.

**4. Degradación controlada.** Sin margen de cuota o con la API caída, la versión
vuelve a `NEW` y el entrenador continúa por plantilla o manual.

### Estados de una versión

```
NEW → GENERATING → DRAFT ──┬──► APPROVED ──► SENT
                           └──► REJECTED
```

6 estados, 11 transiciones. Detalle completo en
[`docs/STATE-MACHINE.md`](docs/STATE-MACHINE.md).

Cada transición queda en `plan_events`, lo que permite responder
*"¿por qué Carlos no recibió su rutina?"*:

```
10:32  ∅      → NEW         system
10:33  NEW    → GENERATING  trainer
10:33  GENERATING → DRAFT   ai
10:41  DRAFT  → APPROVED    trainer
10:41  APPROVED → SENT      system
```

---

## Stack

| Capa | Tecnología |
|---|---|
| Formulario | Tally (webhook, plan gratuito) |
| Base de datos | Supabase PostgreSQL |
| Backend | Supabase Edge Functions (Deno) |
| IA | Gemini, tras la interfaz `AIProvider` |
| Interfaz | Telegram Bot |
| Tests | Vitest (Node) |
| Lenguaje | TypeScript estricto, sin `any` |

**Costo objetivo: ~$0/mes.** Sin ORM: `supabase-js` con tipos generados desde
el esquema.

---

## Estructura

```
trainer-flow/
├── CLAUDE.md              reglas de trabajo
├── docs/                  producto, arquitectura, specs
├── supabase/
│   ├── migrations/        SQL versionado
│   └── functions/
│       ├── _core/         ◄── dominio puro, CERO dependencias
│       ├── _shared/       ◄── adaptadores (Supabase, Gemini, Telegram)
│       └── <función>/     handlers HTTP
└── tests/                 Vitest, importa desde _core/
```

### La regla que hace funcionar el híbrido

| Carpeta | Runtime | Puede importar |
|---|---|---|
| `_core/` | ambos | **nada externo** |
| `_shared/` | Deno | Deno, npm, fetch |
| `tests/` | Node | `_core` |

**Nada en `_core/` usa `Deno.*`, `process.*`, `fetch`, `npm:` ni librerías.**
Si necesita entrada/salida, no pertenece ahí.

El beneficio: el dominio —máquina de estados, validaciones, autorización— se
prueba en milisegundos sin levantar Supabase ni llamar a ninguna API.

---

## Cómo trabajamos: Spec Driven Development

> **No se escribe código sin una spec aprobada.**

```
ESCRIBIR → REVISAR → IMPLEMENTAR → VERIFICAR → CERRAR
```

Cada spec termina con criterios de aceptación en formato Given/When/Then:

```
CA-2 — DADO un payload ya procesado,
       CUANDO llega por segunda vez,
       ENTONCES la respuesta es 200 y no se crea ninguna fila.
```

**Eso ya es un test.** Se copia y se implementa hasta que pase.

Y sobre todo lo que vive en `_core/`, **TDD**: primero el test rojo.

---

## Puesta en marcha

**Requisitos:** Node 20+, pnpm, Supabase CLI, Docker.

```bash
pnpm install
cp .env.example .env.local     # rellena los valores
supabase link --project-ref <tu-ref>
supabase start
supabase db reset
```

Secretos en producción — **nunca van a git**:

```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set TELEGRAM_BOT_TOKEN=...
supabase secrets set TELEGRAM_WEBHOOK_SECRET=...
supabase secrets set TALLY_WEBHOOK_SECRET=...
```

---

## Comandos

```bash
pnpm test             # unit (_core), en watch
pnpm test:run         # unit, una pasada
pnpm test:integration # integración, contra PostgreSQL real
pnpm test:all         # todo
pnpm typecheck        # TypeScript / Node — _core y tests
pnpm lint             # oxlint
pnpm deno:check       # TypeScript / Deno — todas las Edge Functions
pnpm deno:lint        # linter de Deno
pnpm types:local      # regenerar database.types.ts
```

**Dos typecheckers a propósito.** Node comprueba el dominio; Deno comprueba
todo, incluidos `_shared/` y los handlers. Que el mismo `_core` pase los dos es
la premisa del ADR-001, verificada en cada push.

---

## Documentación

| Documento | Contenido |
|---|---|
| [`PRODUCT.md`](docs/PRODUCT.md) | Qué se construye y qué queda fuera |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Las 11 decisiones (ADRs) y su razón |
| [`DATA-MODEL.md`](docs/DATA-MODEL.md) | Las 10 tablas, constraints, RLS |
| [`STATE-MACHINE.md`](docs/STATE-MACHINE.md) | Estados, transiciones, por qué no XState |
| [`TESTING.md`](docs/TESTING.md) | TDD, pirámide, qué se prueba siempre |
| [`SECURITY.md`](docs/SECURITY.md) | Secretos, autorización, datos de salud |
| [`RISKS.md`](docs/RISKS.md) | Riesgos con su mitigación |
| [`ROADMAP.md`](docs/ROADMAP.md) | El MVP dividido en sesiones |
| [`DEPLOY.md`](docs/DEPLOY.md) | CI, despliegue y desarrollo local |
| [`specs/`](docs/specs/) | Las specs con sus criterios de aceptación |

**Antes de tocar código:** `CLAUDE.md`, la spec correspondiente y `ARCHITECTURE.md`.

---

## Estado

🚧 **En desarrollo.** El dominio está construido; falta conectarlo a Telegram.

```
375 tests unitarios · 48 de integración y E2E · cobertura global del 100%
typecheck ✅  lint ✅  deno:check ✅  deno:lint ✅
```

**El producto ya funciona sin IA.** `E2E-1` recorre el camino completo — crear,
editar, aprobar, enviar — y asevera que `ai_generations` queda con **cero
filas**.

### Progreso

| Bloque | Sesiones | Estado |
|---|---|---|
| 1 · Cimientos | S-01 → S-04 | ✅ Esquema, RLS, migraciones |
| 2 · El dominio | S-05 → S-08 | ✅ Autorización, estados, validación, plantillas |
| 3 · Producto usable **sin IA** | S-09 → S-11 | ✅ **Hito alcanzado** |
| 4 · Ingesta | S-12 → S-14 | 🟡 S-12 hecha. Falta el webhook (S-13, S-14) |
| 5 · La IA | S-15 → S-18 | ⬜ |
| 6 · El cliente | S-19 → S-22 | ⬜ |
| 7 · Ciclo completo | S-23 → S-25 | ⬜ |
| 8 · Cierre | S-26 → S-28 | ⬜ |

**Hito alcanzado en la sesión 11.** El producto ya sirve: crear una rutina,
aprobarla y enviarla, **sin una sola llamada a la IA**. Lo que viene la mejora,
no la habilita.

### Los tres módulos con cobertura obligatoria del 100%

| Módulo | Qué garantiza |
|---|---|
| `authorization.ts` | Con RLS en denegación total, es lo único que separa a un cliente de los datos de otro |
| `domain/state-machine.ts` | Hace imposible que una rutina llegue al cliente sin aprobación |
| `domain/validate-draft.ts` | La frontera con la IA: nada entra al dominio sin pasar por aquí |

Si la cobertura de cualquiera baja del 100%, **el CI se pone rojo**.

### Specs

| Spec | Estado |
|---|---|
| SPEC-000 · Esquema | ✅ Implementada |
| SPEC-001 · Ingesta de Tally | 🟡 Parcial (validación, mapeo y sobre) |
| SPEC-003 · Revisión en Telegram | 🟡 Parcial (webhook y parsing) |
| SPEC-008 · Manual y plantillas | 🟡 Parcial (dominio completo y E2E-1) |
| SPEC-009 · Identidad y autorización | 🟡 Parcial (core + webhook) |
| SPEC-002, 004 a 007, 010 | 📝 Borrador |

Una spec toca varias capas, así que se cierra en varias sesiones. `SPEC-009`
define las reglas de autorización **y** cómo el webhook resuelve la identidad:
las reglas son S-05, el webhook es S-09.

### Fuera de alcance en V1

Dashboard web · App móvil · Pagos · RAG · Biblioteca de ejercicios · Analytics ·
Multi-entrenador · Diffing entre versiones · Segundo proveedor de IA ·
Cualquier automatización sin supervisión humana.

### Terminado cuando

Un cliente completa el formulario, el entrenador crea la rutina (con IA,
plantilla o a mano), la aprueba, el cliente la recibe y hace check-in.

**Y cuando Gemini se cae, el entrenador sigue trabajando.**
