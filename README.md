# 🏋️ TrainerFlow

[![CI](https://github.com/ana-izaguirre/trainer-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/ana-izaguirre/trainer-flow/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)](docs/TESTING.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Deno](https://img.shields.io/badge/Deno-Edge%20Functions-70FFAF?logo=deno&logoColor=black)](supabase/functions/deno.json)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](docs/DATA-MODEL.md)
[![SDD](https://img.shields.io/badge/method-Spec%20Driven%20Development-8A63D2)](docs/specs/)

**English** · [Español](README.es.md)

A tool that helps a personal trainer build and follow up on workout plans —
**by hand, from a template, or with AI** — without ever taking the final call
away from them.

> The coverage badge isn't decorative: if it drops below 100%, **CI goes red**.
> The threshold lives in `vitest.config.ts`.

---

## What it does

```mermaid
flowchart TD
    Form["🧍 The client fills in<br/>a 2–3 min form"] --> Tally[["Tally"]]
    Tally -->|webhook| Ingest["tally-webhook"]
    Ingest --> DB[("PostgreSQL")]
    Ingest -.->|"🔔 a new assessment"| T1

    DB -->|"🔔 the trainer decides"| Source{"which source?"}

    subgraph sources ["the three produce the same type"]
        direction LR
        Source -->|AI| Gen["generate-version"]
        Source -->|template| Tpl["templates.ts"]
        Source -->|by hand| Man["the editor"]
    end

    Gen -.->|"the only replaceable part"| Gemini[["Gemini"]]

    sources --> Draft["DRAFT · the trainer reads it<br/>in Telegram, with buttons"]
    Draft --> T1["🧑‍🏫 TRAINER"]

    T1 ==>|"✋ approves"| Sent["SENT"]
    T1 -->|"rejects or edits"| Draft

    Sent --> Deliver["🧍 the client gets the plan,<br/>already adapted"]

    Cron(["⏰ pg_cron · Mondays"]) --> Weekly["weekly-checkin"]
    Deliver --> Weekly
    Weekly -->|"3 questions"| Answer["🧍 the client answers"]
    Answer -->|"⚠️ discomfort → right away"| T1

    style T1 fill:#8A63D2,color:#fff,stroke:#5B3FA8
    style Sent fill:#3ECF8E,color:#000,stroke:#2A9E6B
    style Gemini stroke-dasharray: 5 5
    style Form fill:#E8F8F0,color:#000
    style Deliver fill:#E8F8F0,color:#000
    style Answer fill:#E8F8F0,color:#000

    style sources fill:#F7F5FC,stroke:#C9BEE8
```

**The interface is Telegram.** No dashboard, no app. The trainer already has it
open.

The dashed line to Gemini is the point: it's the only replaceable part. Every
other path works without it.

---

## The two principles

### 1. The AI proposes, the trainer decides

A badly adapted workout can injure someone. So human review isn't a convention
here — it's structure:

```mermaid
stateDiagram-v2
    direction LR
    [*] --> NEW

    NEW --> GENERATING: GENERATE
    NEW --> DRAFT: LOAD_TEMPLATE
    NEW --> DRAFT: CREATE_MANUAL

    GENERATING --> DRAFT: GENERATION_SUCCEEDED
    GENERATING --> NEW: GENERATION_FAILED

    DRAFT --> DRAFT: EDIT
    DRAFT --> APPROVED: APPROVE ✋
    APPROVED --> SENT: SEND

    NEW --> REJECTED: REJECT
    DRAFT --> REJECTED: REJECT
    APPROVED --> REJECTED: REJECT

    SENT --> [*]
    REJECTED --> [*]

    note right of DRAFT
        There is no DRAFT to SENT edge.
        Not "we never call it".
        It is not in the table.
    end note

    note right of APPROVED
        Only APPROVE gets you here.
        Only a trainer's tap fires it.
    end note
```

- **The `DRAFT → SENT` transition does not exist.** The only road to `SENT`
  starts at `APPROVED`, and the only way there is a trainer's action.
- No state change happens outside the state machine.
- 100% coverage on it, invalid transitions included.

`GENERATION_FAILED` goes back to `NEW`, not to a dead end: the trainer carries
on with a template or writes it by hand, on the same version.

### 2. The AI is a capability, not the owner of the domain

```
AI ──────────┐
Template ────┼──► WorkoutDraft ──► validate ──► WorkoutVersion
By hand ─────┘
```

All three sources produce the same type and go through the same validation.
**If Gemini goes down, the product keeps working**: the trainer uses a template
or writes the plan by hand.

The word "Gemini" does not appear in `_core/`. The domain only knows the
`AIProvider` interface — and a test greps for it.

---

## How it works inside

### The layers, and what each one may import

```mermaid
flowchart TB
    fns["<b>🌐 Edge Functions</b> · Deno<br/>telegram-webhook · tally-webhook<br/>generate-version · weekly-checkin<br/><i>HTTP glue only</i>"]

    shared["<b>🔌 _shared/</b> · adapters<br/>db.ts · telegram/ · ai/gemini-provider.ts<br/><i>Deno, npm, fetch live here</i>"]

    core["<b>🧠 _core/</b> · pure TypeScript<br/>domain/ · authorization.ts · ports/<br/><i>no Deno, no npm, no fetch, no I/O</i>"]

    fns ==>|"builds the adapters<br/>and calls the domain"| shared
    shared ==>|"implements the ports"| core
    core x--x|"<b>❌ NEVER</b><br/>oxlint fails the build"| shared

    style core fill:#EDE7F9,stroke:#8A63D2,stroke-width:3px,color:#000
    style shared fill:#E4F7EE,stroke:#3ECF8E,stroke-width:2px,color:#000
    style fns fill:#F4F4F6,stroke:#B8B8C4,stroke-width:2px,color:#000
```

`_core/` uses no `Deno.*`, no `process.*`, no `fetch`, no `npm:` imports and
nothing from `_shared`. **The linter enforces it** — it isn't a guideline
(ADR-001). That's what lets the whole domain run under Node and Vitest while
production runs on Deno.

### The four decisions that matter

**1. A webhook never waits for the AI.** Generating takes 10–30s; Tally times
out before that and retries. The pattern is
`receive → store → answer 200 → fire separately`.

**2. Idempotency through `UNIQUE (source, external_id)`.** Every webhook
inserts there before doing anything else. If Postgres rejects it, the event was
already processed. It's the mechanism, not a side effect: a prior check would
let two concurrent requests both through.

**3. Versioning with a full snapshot.** A plan that was sent is never
overwritten. A change produces `version + 1`; the previous one stays intact.

**4. Controlled degradation.** Out of quota or with the API down, the version
goes back to `NEW` and the trainer carries on with a template or by hand.

### Status

🚧 **In development.**

**The product already works without AI.** `E2E-1` walks the whole path — create,
edit, approve, send — and asserts `ai_generations` ends with **zero rows**. That
milestone doesn't come undone: what comes next improves the product, it doesn't
enable it.

> ### There are no counts or progress tables here, on purpose
>
> There used to be, and they lied. They said "375 tests" when there were 504,
> and listed specs as drafts when they already had code. A number you have to
> update by hand on every commit is a number that will be wrong.
>
> | What you want to know | Where it actually lives |
> |---|---|
> | Whether everything passes right now | The CI badge, up top |
> | How each spec is doing | The **Estado** field in each [`spec`](docs/specs/) |
> | Which session is next | [`ROADMAP.md`](docs/ROADMAP.md) |
> | How many tests there are | `pnpm test:run` |
>
> Each of those updates itself, or lives next to what it describes.

### The three modules at a mandatory 100%

| Module | What it guarantees |
|---|---|
| `authorization.ts` | With RLS denying everything, it's the only thing keeping one client's data from another |
| `domain/state-machine.ts` | Makes it impossible for a plan to reach a client unapproved |
| `domain/validate-draft.ts` | The border with the AI: nothing enters the domain without passing through |

If any of them drops below 100%, **CI goes red**. That doesn't need
maintaining by hand — it's in `vitest.config.ts`.

### Out of scope for V1

Web dashboard · Mobile app · Payments · RAG · Exercise library · Analytics ·
Multi-trainer · Diffing between versions · A second AI provider · Any
automation without human supervision.

### Done when

A client fills in the form, the trainer builds the plan (with AI, a template or
by hand), approves it, the client receives it and checks in.

**And when Gemini goes down, the trainer keeps working.**

---

## Getting started

| | |
|---|---|
| Deploying for the first time | [`docs/DEPLOY.md`](docs/DEPLOY.md) — a ten-step checklist |
| How the pieces fit | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| The schema | [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) |
| Working method | [`CLAUDE.md`](CLAUDE.md) — spec first, code second |

```bash
pnpm install
pnpm test:run     # domain, under Node
pnpm deno:test    # adapters and handlers, under Deno
```
