# CLAUDE.md — Reglas de trabajo en TrainerFlow

## Idioma
Responde siempre en español latino neutro. Los documentos, specs y comentarios
de código también van en español. Los identificadores de código (variables,
funciones, tablas, columnas) van en inglés.

## Metodología: Spec Driven Development

**Regla #1: no se escribe código sin una spec aprobada.**

El ciclo es:

```
1. ESCRIBIR   →  docs/specs/SPEC-XXX-nombre.md
2. REVISAR    →  Ana lee, corrige, aprueba
3. IMPLEMENTAR→  código que cumple la spec, nada más
4. VERIFICAR  →  cada criterio de aceptación pasa
5. CERRAR     →  marcar la spec como IMPLEMENTADA
```

Si durante la implementación aparece algo que la spec no contempla:
**detenerse y actualizar la spec primero.** No improvisar en el código.

Si Ana pide una funcionalidad sin spec, la respuesta es proponer la spec,
no escribir el código.

## Principio de producto (no negociable)

**La IA propone, el entrenador decide.**

Gemini NUNCA puede:
- Aprobar una rutina.
- Enviar una rutina al cliente.
- Decidir que un ejercicio es seguro para una lesión.

Toda rutina pasa por `TRAINER_REVIEW` y aprobación humana explícita antes de
llegar al cliente. Cualquier código que permita saltarse esto es un bug crítico.

## Stack

| Capa | Tecnología |
|---|---|
| Formulario | Tally (webhook) |
| Base de datos | Supabase PostgreSQL |
| Backend | Supabase Edge Functions (**Deno**) |
| IA | Gemini API |
| Interfaz entrenador | Telegram Bot |
| Interfaz cliente | Telegram Bot (mismo bot) |
| Tests / tooling | **Node** + Vitest |

## Estructura del proyecto (híbrido Node + Deno)

```
trainer-flow/
├── CLAUDE.md
├── docs/
│   ├── PRODUCT.md            # qué y por qué
│   ├── ARCHITECTURE.md       # decisiones técnicas
│   ├── DATA-MODEL.md         # esquema y relaciones
│   └── specs/                # specs por funcionalidad
├── supabase/
│   ├── config.toml
│   ├── migrations/           # SQL versionado
│   └── functions/
│       ├── _core/            # ← TS PURO. Sin Deno, sin npm, sin I/O.
│       ├── _shared/          # adaptadores (Supabase, Gemini, Telegram)
│       ├── tally-webhook/
│       ├── generate-plan/
│       ├── telegram-webhook/
│       └── weekly-checkin/
├── tests/                    # Node + Vitest, importan desde _core/
├── package.json              # SOLO tooling: vitest, eslint, supabase CLI
└── tsconfig.json
```

### La regla que hace funcionar el híbrido

`supabase/functions/_core/` contiene **TypeScript puro**: máquina de estados,
validaciones, construcción de prompts, parsing de respuestas. Sin `Deno.*`,
sin `npm:`, sin `fetch`, sin acceso a base de datos.

Así el mismo archivo corre en Deno (producción) y en Node (tests con Vitest).
Toda la lógica de negocio testeable vive ahí.

El I/O (Supabase, Gemini, Telegram) vive en `_shared/` y se inyecta.

## Reglas de código

- TypeScript estricto. Nada de `any`.
- Los imports dentro de `functions/` llevan extensión `.ts` explícita (Deno lo exige).
- Cada Edge Function valida su entrada antes de tocar la base de datos.
- Ningún webhook hace trabajo lento en línea: recibe, guarda, responde 200,
  y dispara el trabajo pesado de forma asíncrona.
- Errores: siempre se registran con contexto (qué cliente, qué plan, qué estado).
  Nunca se registra un secreto, un token ni datos médicos del cliente.

## Secretos

Nunca van a git. Se gestionan con `supabase secrets set`.

```
GEMINI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_TRAINER_CHAT_ID
TALLY_WEBHOOK_SECRET
SUPABASE_SERVICE_ROLE_KEY
```

Si un secreto aparece en un archivo que va a commitearse, es un bloqueante.

## Git

- Rama de trabajo: `code/youthful-cannon-4lqn8c`
- Un commit por spec implementada, o por paso claro dentro de una spec.
- Mensaje: `feat(spec-001): ingesta de webhook de Tally`

## Qué NO construir en V1

Dashboard web, app móvil, pagos, RAG, biblioteca de ejercicios, analytics,
multi-entrenador, automatización sin humano. Si algo de esto aparece en una
propuesta, se rechaza y se anota en el backlog.
