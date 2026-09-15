# CLAUDE.md — Reglas de trabajo en TrainerFlow

## Idioma
Responde siempre en español latino neutro. Documentos, specs y comentarios de
código también en español. Los identificadores de código (variables, funciones,
tablas, columnas) en inglés.

## Metodología: Spec Driven Development

**Regla #1: no se escribe código sin una spec aprobada.**

```
1. ESCRIBIR    →  docs/specs/SPEC-XXX-nombre.md
2. REVISAR     →  Ana lee, corrige, aprueba
3. IMPLEMENTAR →  código que cumple la spec, nada más
4. VERIFICAR   →  cada criterio de aceptación pasa
5. CERRAR      →  marcar la spec como IMPLEMENTADA
```

Si durante la implementación aparece algo que la spec no contempla:
**detenerse y actualizar la spec primero.** No improvisar en el código.

Si Ana pide una funcionalidad sin spec, la respuesta es proponer la spec, no
escribir el código.

---

## Los dos principios (no negociables)

### 1. La IA propone, el entrenador decide

Gemini NUNCA puede aprobar una rutina, enviarla al cliente, ni decidir que un
ejercicio es seguro para una lesión.

**Se hace cumplir estructuralmente: la transición `DRAFT → SENT` no existe.**
El único camino a `SENT` sale de `APPROVED`, y ahí solo se llega con una acción
del entrenador. Cualquier código que permita saltarse esto es un bug crítico.

### 2. La IA es una capacidad, no la dueña del dominio

```
IA ──────────┐
Plantilla ───┼──► WorkoutDraft ──► validateDraft ──► WorkoutVersion
Manual ──────┘
```

Reglas que se derivan:

- **La palabra "gemini" no aparece en `_core/`.** Ni el modelo, ni la URL, ni la
  clave. El dominio solo conoce la interfaz `AIProvider`.
- **`version_state` no contiene ningún estado de IA.** El estado de la IA vive
  en `ai_generations`.
- **Una rutina manual se valida igual de estricto que una generada por IA.**
- **El sistema funciona completo sin IA.** Si eso deja de ser cierto, es un bug.

---

## Stack

| Capa | Tecnología |
|---|---|
| Formulario | Tally (webhook) |
| Base de datos | Supabase PostgreSQL |
| Backend | Supabase Edge Functions (**Deno**) |
| IA | Gemini, tras la interfaz `AIProvider` |
| Interfaz | Telegram Bot — **sin frontend en V1** |
| Tests | **Node** + Vitest |

---

## Estructura

```
supabase/functions/
├── _core/                  ◄── TS PURO. Sin Deno, sin npm, sin I/O
│   ├── domain/             modelos, máquina de estados, validaciones
│   ├── ports/              interfaces (AIProvider)
│   ├── editor/             comandos del editor
│   ├── ai/                 prompt, rate limit (SIN el proveedor)
│   ├── templates.ts        plantillas como constante
│   └── authorization.ts    reglas de acceso
├── _shared/                ◄── adaptadores: Supabase, Gemini, Telegram
│   └── ai/gemini-provider.ts   aquí vive GEMINI_API_KEY
└── <función>/              handlers HTTP
```

### La regla del híbrido

| Carpeta | Runtime | Puede importar |
|---|---|---|
| `_core/` | ambos | **nada externo** |
| `_shared/` | Deno | Deno, npm, fetch |
| `tests/` | Node | `_core` |

**Nada en `_core/` usa `Deno.*`, `process.*`, `fetch`, `npm:` ni librerías.**
Si necesita entrada/salida, no pertenece ahí.

---

## Reglas de código

- TypeScript estricto. **Nada de `any`** — para datos externos, `unknown`.
- Los imports dentro de `functions/` llevan extensión `.ts` (Deno lo exige).
- **TDD obligatorio en `_core/`**: primero el test rojo.
- Cada Edge Function valida su entrada **y la autorización** antes de tocar datos.
- Ningún webhook hace trabajo lento en línea: recibe, guarda, responde 200,
  dispara aparte.
- Cada petición lleva un `request_id` que se propaga y se guarda.
- Errores con contexto. **Nunca un secreto, un token ni datos de salud.**

## Autorización

Con Telegram como única interfaz, todo pasa por `service_role` y **RLS no
protege nada**. La única capa real es `_core/authorization.ts`.

**Por eso su cobertura es del 100% obligatorio, casos denegados incluidos.**
Ver ADR-010.

## Secretos

Nunca van a git. Se gestionan con `supabase secrets set`:
`GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TALLY_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

Un secreto en un archivo que va a commitearse es un bloqueante.

## Definition of Done

Antes de dar una feature por terminada:

- [ ] Happy path funciona
- [ ] Errores manejados
- [ ] Inputs validados
- [ ] Autorización correcta
- [ ] Unit tests (obligatorios en `_core`)
- [ ] Integration tests cuando corresponda
- [ ] E2E si afecta un flujo crítico
- [ ] No expone secretos
- [ ] No rompe versiones anteriores
- [ ] `pnpm typecheck` pasa
- [ ] `pnpm lint` pasa

## Git

- Rama: `code/youthful-cannon-4lqn8c`
- Un commit por spec, o por paso claro dentro de una spec
- Mensaje: `feat(spec-008): plantillas y creación manual`

## Qué NO construir en V1

Dashboard web · Frontend · App móvil · Pagos · RAG · Biblioteca de ejercicios ·
Analytics · Multi-entrenador · **Segundo proveedor de IA** · **Diffing entre
versiones** · XState · Event sourcing · CQRS · Redis, colas o workers ·
Automatización sin supervisión humana.

Si algo de esto aparece en una propuesta, se rechaza y se anota en el backlog.

**Toda abstracción debe justificar su existencia.** La pregunta es:
*"¿esto ayuda al MVP, o estamos resolviendo un problema que aún no tenemos?"*
