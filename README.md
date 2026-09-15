# 🏋️ TrainerFlow

Herramienta que ayuda a un entrenador personal a crear y hacer seguimiento de
rutinas usando IA — **sin quitarle nunca la decisión final**.

---

## Índice

1. [Qué hace](#1-qué-hace)
2. [El principio que rige todo](#2-el-principio-que-rige-todo)
3. [Cómo funciona por dentro](#3-cómo-funciona-por-dentro)
4. [Stack y por qué](#4-stack-y-por-qué)
5. [Estructura del proyecto](#5-estructura-del-proyecto)
6. [Cómo trabajamos: Spec Driven Development](#6-cómo-trabajamos-spec-driven-development)
7. [Puesta en marcha](#7-puesta-en-marcha)
8. [Comandos](#8-comandos)
9. [Documentación](#9-documentación)
10. [Estado del proyecto](#10-estado-del-proyecto)

---

## 1. Qué hace

### El problema

Un entrenador personal con 10 clientes pierde horas cada semana en trabajo
repetitivo: recopilar información, diseñar rutinas, adaptarlas, hacer
seguimiento y recordar quién necesita atención.

### La solución

TrainerFlow automatiza la parte mecánica y deja la parte de criterio al
entrenador:

```
El cliente completa un formulario (2-3 minutos)
                ↓
        Se guarda en la base de datos
                ↓
        La IA genera un borrador de rutina
                ↓
    El entrenador lo recibe en Telegram
                ↓
      Lo edita, lo aprueba o lo rechaza
                ↓
    El cliente recibe su rutina en Telegram
                ↓
           Check-in semanal automático
```

### Cómo lo ve el entrenador

No hay dashboard. **Todo ocurre en Telegram**, porque el entrenador ya lo
tiene abierto en el móvil:

```
🏋️ Nueva rutina para Carlos

Objetivo: Ganancia muscular
Nivel: Intermedio
Días: 4 · 60 min
Equipamiento: Gimnasio

━━━ Día 1 — Empuje ━━━
• Press banca — 4x8 (90s)
• Press militar — 3x10 (60s)

⚠️ Limitación: hombro
   Se evitó press tras nuca.

[✏️ Editar]  [✅ Aprobar]  [❌ Rechazar]
```

Si pulsa **Editar**, escribe en lenguaje natural lo que quiere cambiar
("quita sentadilla, tiene molestia de rodilla") y recibe una versión nueva.

---

## 2. El principio que rige todo

> ### La IA propone. El entrenador decide.

Esto no es una preferencia de diseño: es una **restricción de seguridad**.
Una rutina mal adaptada puede lesionar a una persona real.

**Gemini puede:**
- Interpretar la evaluación del cliente.
- Proponer ejercicios, series y repeticiones.
- Estructurar una semana de entrenamiento.
- Modificar una rutina siguiendo instrucciones del entrenador.

**Gemini NO puede:**
- Aprobar una rutina.
- Decidir que un ejercicio es seguro para una lesión.
- Enviar nada al cliente.
- Sustituir el criterio profesional del entrenador.

### Cómo se hace cumplir en el código

No por convención ni por buena intención, sino por estructura:

1. **Una máquina de estados** (`_core/state-machine.ts`) decide qué
   transiciones son legales. Ningún cambio de estado ocurre fuera de ella.
2. **La transición `DRAFT → SENT` no existe.** Para llegar a `SENT` hay que
   pasar obligatoriamente por `APPROVED`, y a `APPROVED` solo se llega con una
   pulsación del entrenador.
3. **Cobertura de tests del 100%** sobre esa máquina, incluidas todas las
   transiciones inválidas.

Si alguna vez un cambio permite que una rutina llegue al cliente sin
aprobación, **es un bug crítico**, no una funcionalidad.

---

## 3. Cómo funciona por dentro

### Flujo completo

```
[Cliente]
    │ completa el formulario de Tally
    ▼
[Tally] ──webhook──► [tally-webhook]
                          │  1. verifica la firma
                          │  2. comprueba que no sea duplicado
                          │  3. guarda cliente + evaluación
                          │  4. responde 200 en <1s  ◄── clave
                          │
                          │  (asíncrono, ya fuera del webhook)
                          ▼
                     [generate-plan]
                          │  1. ¿queda margen de cuota de IA?
                          │  2. llama a Gemini
                          │  3. valida la respuesta
                          │  4. estado → TRAINER_REVIEW
                          ▼
              [Telegram — chat del ENTRENADOR]
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
      [Editar]       [Rechazar]      [Aprobar]
          │               │               │
          ▼               ▼               ▼
      Gemini v2       REJECTED        APPROVED
          │                               │
          └──► TRAINER_REVIEW             ▼
                              [Telegram — chat del CLIENTE]
                                          │
                                         SENT
                                          │
                                          ▼
                                  Check-in semanal
```

### Las tres decisiones técnicas que importan

#### a) El webhook nunca espera a la IA

Generar una rutina tarda entre 10 y 30 segundos. Tally corta la conexión mucho
antes y **reintenta**. Si el webhook esperara a Gemini, el resultado sería:
timeout → reintento → **rutinas duplicadas**.

Por eso el patrón es siempre:

```
recibir → validar → guardar → responder 200 → disparar el trabajo aparte
```

#### b) Idempotencia: el mismo evento dos veces, un solo efecto

Tally y Telegram reintentan entregas. Sin protección, un reintento crea datos
duplicados.

La solución es una tabla con una restricción de unicidad:

```sql
UNIQUE (source, external_id)
```

Todo webhook inserta ahí **antes de hacer nada más**. Si Postgres rechaza la
inserción, el evento ya se procesó: se responde `200` y se sale sin efectos.

#### c) La IA falla y el sistema sigue funcionando

El tier gratuito de Gemini tiene límites por minuto y por día. Y las APIs se
caen.

```
Solicitud → ¿queda margen en la ventana?
              ├── Sí  → Gemini genera
              └── No  → estado MANUAL
                        + aviso al entrenador
                        + él crea la rutina a mano
```

**El entrenador nunca se queda sin poder trabajar.** Esto se llama
*degradación controlada*, y es lo que separa un sistema frágil de uno usable.

### Estados de una rutina

```
NEW ──► GENERATING ──┬──► DRAFT ──► TRAINER_REVIEW
                     │                     │
                     ├──► FAILED           ├──► EDITING ──┐
                     │                     │              │
                     └──► MANUAL           │  ◄───────────┘
                                           │
                                           ├──► REJECTED  (terminal)
                                           │
                                           └──► APPROVED ──► SENT (terminal)
```

Cada transición queda registrada en `plan_events`, lo que permite responder
con precisión a *"¿por qué Carlos no recibió su rutina?"*:

```
10:32  NULL      → NEW             system
10:32  NEW       → GENERATING      system
10:33  GENERATING→ DRAFT           gemini
10:33  DRAFT     → TRAINER_REVIEW  system
10:41  TRAINER_REVIEW → APPROVED   trainer
10:41  APPROVED  → SENT            system
```

---

## 4. Stack y por qué

| Capa | Tecnología | Por qué esta |
|---|---|---|
| Formulario | **Tally** | Webhooks en el plan gratuito, formularios ilimitados |
| Base de datos | **Supabase PostgreSQL** | Postgres real, RLS, plan gratuito |
| Backend | **Supabase Edge Functions** (Deno) | Sin servidor que mantener, junto a la base de datos |
| IA | **Gemini** | Tier gratuito con salida estructurada (JSON schema) |
| Interfaz | **Telegram Bot** | El entrenador ya lo tiene. Botones interactivos. Gratis |
| Tests | **Vitest** (Node) | Rápido, ecosistema maduro |
| Lenguaje | **TypeScript** estricto | En todo el proyecto, sin `any` |

**Costo de infraestructura objetivo: ~$0/mes.**

### Sobre el ORM: no usamos ninguno

Se usa **`supabase-js`** con tipos generados desde el esquema real:

```bash
supabase gen types typescript --linked > supabase/functions/_core/database.types.ts
```

No se pierde seguridad de tipos: TypeScript avisa si escribes mal el nombre de
una columna. Y se gana:

- Funciona nativamente en Edge Functions, sin configurar conexiones ni pooling.
- **RLS funciona de forma natural**, que es un requisito de seguridad.
- Las migraciones son SQL versionado, lo correcto para constraints y políticas.

Prisma no encaja con Deno. Drizzle y Kysely son viables pero añaden complejidad
que este MVP no necesita.

---

## 5. Estructura del proyecto

Es un proyecto **híbrido Node + Deno**, y esa mezcla tiene una razón y una regla.

**La razón:** Supabase Edge Functions corren en Deno, pero el ecosistema de
testing de Node es mejor.

**La regla que lo hace funcionar:**

```
trainer-flow/
├── CLAUDE.md                  # reglas de trabajo para la IA
├── README.md
│
├── docs/
│   ├── PRODUCT.md             # qué se construye y por qué
│   ├── ARCHITECTURE.md        # decisiones técnicas (ADRs)
│   ├── DATA-MODEL.md          # esquema, relaciones, constraints
│   ├── TESTING.md             # estrategia de TDD y E2E
│   ├── SECURITY.md            # secretos, autorización, datos sensibles
│   ├── RISKS.md               # riesgos y mitigaciones
│   ├── ROADMAP.md             # el MVP dividido en 24 sesiones
│   └── specs/                 # SPEC-000 a SPEC-007
│
├── supabase/
│   ├── migrations/            # SQL versionado
│   └── functions/
│       ├── _core/             # ◄── TypeScript PURO
│       ├── _shared/           # ◄── adaptadores de I/O (Deno)
│       ├── tally-webhook/
│       ├── generate-plan/
│       ├── telegram-webhook/
│       ├── send-plan/
│       └── weekly-checkin/
│
└── tests/                     # Vitest (Node), importa desde _core/
```

### La regla de `_core/`

| Carpeta | Runtime | Contenido | Puede importar |
|---|---|---|---|
| `_core/` | **ambos** | Lógica de negocio pura | nada externo |
| `_shared/` | Deno | Adaptadores (Supabase, Gemini, Telegram) | Deno, npm, fetch |
| `<función>/` | Deno | Handlers HTTP | `_core` y `_shared` |
| `tests/` | Node | Vitest | `_core` |

**Nada dentro de `_core/` puede usar `Deno.*`, `process.*`, `fetch` ni
imports de `npm:`.** Si necesita entrada/salida, no pertenece a `_core`.

**El beneficio:** la lógica importante — máquina de estados, validaciones,
construcción de prompts, parsing — se prueba con Vitest en milisegundos, sin
levantar Supabase ni llamar a ninguna API.

---

## 6. Cómo trabajamos: Spec Driven Development

### La regla

> **No se escribe código sin una spec aprobada.**

### El ciclo

```
1. ESCRIBIR      →  docs/specs/SPEC-XXX-nombre.md
2. REVISAR       →  se lee, se corrige, se aprueba
3. IMPLEMENTAR   →  código que cumple la spec, nada más
4. VERIFICAR     →  cada criterio de aceptación pasa como test
5. CERRAR        →  la spec pasa a IMPLEMENTADA
```

Si durante la implementación aparece algo que la spec no contempla,
**se detiene el código y se actualiza la spec primero**. No se improvisa.

### Por qué esto funciona bien aquí

Cada spec termina con **criterios de aceptación** en formato Given/When/Then:

```
CA-2 — DADO un payload ya procesado,
       CUANDO llega por segunda vez,
       ENTONCES la respuesta es 200 y no se crea ninguna fila nueva.
```

Eso **ya es un test**. No hay traducción ni interpretación: se copia al test y
se implementa hasta que pase. La spec y la suite de tests son el mismo
documento en dos formatos.

### Y encima TDD

Para todo lo que vive en `_core/`:

```
RED  →  test que falla
GREEN → código mínimo que lo hace pasar
REFACTOR → limpiar sin romper
```

**Reglas no negociables** (detalle en [`docs/TESTING.md`](docs/TESTING.md)):

1. Toda función de `_core` nace de un test rojo.
2. Ningún webhook se cierra sin su test de idempotencia.
3. La máquina de estados tiene cobertura del 100%, válidas e inválidas.
4. Gemini y Telegram se mockean siempre. Nunca se llaman de verdad en tests.

---

## 7. Puesta en marcha

### Requisitos

- Node 20 o superior
- pnpm
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (para Supabase en local)

### Cuentas necesarias

| Servicio | Para qué |
|---|---|
| [Supabase](https://supabase.com) | Base de datos y funciones |
| [Tally](https://tally.so) | Formulario de evaluación |
| [Google AI Studio](https://aistudio.google.com) | Clave de Gemini |
| [@BotFather](https://t.me/botfather) en Telegram | Crear el bot |

### Instalación

```bash
git clone <url-del-repo>
cd trainer-flow
pnpm install

cp .env.example .env.local   # y rellena los valores

supabase login
supabase link --project-ref <tu-project-ref>
supabase start               # Postgres local en Docker
supabase db reset            # aplica las migraciones
```

### Secretos en producción

**Nunca van a git.** Se cargan en Supabase:

```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set TELEGRAM_BOT_TOKEN=...
supabase secrets set TELEGRAM_TRAINER_CHAT_ID=...
supabase secrets set TELEGRAM_WEBHOOK_SECRET=...
supabase secrets set TALLY_WEBHOOK_SECRET=...
```

### Generar los tipos tras cambiar el esquema

```bash
pnpm types
```

Este archivo **se versiona** y **nunca se edita a mano**.

---

## 8. Comandos

```bash
pnpm test           # tests unitarios en modo watch
pnpm test:run       # tests unitarios, una pasada
pnpm test:coverage  # con reporte de cobertura
pnpm types          # regenerar database.types.ts

supabase start      # levantar Supabase en local
supabase stop       # apagarlo
supabase db reset   # recrear la base desde las migraciones
supabase functions serve <nombre>   # probar una función en local
supabase functions deploy <nombre>  # desplegarla
```

---

## 9. Documentación

| Documento | Qué contiene |
|---|---|
| [`PRODUCT.md`](docs/PRODUCT.md) | Qué se construye, para quién, y qué queda fuera |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Las 6 decisiones técnicas (ADRs) y su razón |
| [`DATA-MODEL.md`](docs/DATA-MODEL.md) | Las 8 tablas, relaciones, constraints, RLS |
| [`TESTING.md`](docs/TESTING.md) | TDD, pirámide de tests, qué se prueba siempre |
| [`SECURITY.md`](docs/SECURITY.md) | Secretos, webhooks, autorización, datos de salud |
| [`RISKS.md`](docs/RISKS.md) | 12 riesgos identificados con su mitigación |
| [`ROADMAP.md`](docs/ROADMAP.md) | El MVP dividido en 24 sesiones de 45 minutos |
| [`specs/`](docs/specs/) | Las 8 specs con sus criterios de aceptación |

**Si vas a tocar código, lee antes:** `CLAUDE.md`, la spec correspondiente, y
`ARCHITECTURE.md`.

---

## 10. Estado del proyecto

🚧 **En desarrollo.** Fase actual: documentación y specs completas.

| Spec | Qué cubre | Estado |
|---|---|---|
| SPEC-000 | Esquema de base de datos | 📝 Borrador |
| SPEC-001 | Ingesta de Tally | 📝 Borrador |
| SPEC-002 | Generación con Gemini | 📝 Borrador |
| SPEC-003 | Revisión en Telegram | 📝 Borrador |
| SPEC-004 | Aprobar / editar / rechazar | 📝 Borrador |
| SPEC-005 | Entrega al cliente | 📝 Borrador |
| SPEC-006 | Check-in semanal | 📝 Borrador |
| SPEC-007 | Comandos del entrenador | 📝 Borrador |

### Qué NO se construye en V1

Dashboard web · App móvil · Pagos · RAG · Biblioteca de ejercicios ·
Analytics · Multi-entrenador · Cualquier automatización sin supervisión humana.

Esta lista existe para proteger el tiempo. Todo lo que no esté en el camino
crítico se anota en el backlog y se queda ahí.

### Cuándo está terminado

El MVP está listo cuando este flujo funciona de principio a fin con una
persona real:

1. Un cliente completa el formulario.
2. Los datos quedan guardados.
3. Gemini genera un borrador.
4. El entrenador lo recibe en Telegram.
5. Lo edita si quiere.
6. Lo aprueba.
7. El cliente recibe su rutina.
8. El cliente hace check-in.
9. El entrenador consulta el progreso.

**Y además:** cuando Gemini se cae, el entrenador recibe el aviso y puede
seguir trabajando a mano.
