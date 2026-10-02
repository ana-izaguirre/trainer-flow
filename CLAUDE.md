# CLAUDE.md — Reglas de trabajo en TrainerFlow

## Idioma
Responde siempre en español latino neutro. Documentos, specs y comentarios de
código también en español. Los identificadores de código (variables, funciones,
tablas, columnas) en inglés.

**Excepción: el README.** `README.md` va en inglés, porque es lo primero que ve
quien llega al repositorio desde fuera. `README.es.md` lleva la versión en
español. Los dos dicen lo mismo: si se cambia uno, se cambia el otro.

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
| Lint | **oxlint** — `typescript-eslint` aún no soporta TS 7 |

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
- **El linter hace cumplir el aislamiento de `_core`** (ADR-001): `Deno`,
  `process`, `fetch`, imports `npm:`/`jsr:`/`https:` y cualquier import de
  `_shared` están prohibidos ahí y fallan en `pnpm lint`.
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

**Un solo sitio:** `supabase secrets set` en producción,
`supabase/functions/.env` (gitignored, sin plantilla) en local.

**Ningún archivo versionado los contiene, ni siquiera vacíos.** `.env.example`
no lleva los nombres de las claves: un hueco llamado `GEMINI_API_KEY=` es una
invitación a pegarla ahí.

La lista de qué secretos necesita el sistema está en `docs/SECURITY.md`.

Un secreto en un archivo que va a commitearse es un bloqueante. El CI lo busca
en el historial y falla si lo encuentra.

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

- Rama: la que asigne cada sesión. **Nunca se trabaja directo en `main`**:
  todo entra por PR con CI en verde.
- Un commit por spec, o por paso claro dentro de una spec
- Mensaje: `feat(spec-008): plantillas y creación manual`
- **Un PR por feature — nunca dos features no relacionadas en el mismo PR,
  aunque las dos hayan caído en la rama de la misma sesión.** Un PR mezclado
  es más lento de revisar, y si el CI falla no queda claro cuál de las dos
  cosas lo rompió — como pasó: un PR de README + panel web falló "Types and
  lint" por tres errores reales del panel, y el README (que no tenía
  ninguno) quedó bloqueado con él. Si la rama de la sesión ya lleva una
  feature y aparece otra que no depende de ella, la segunda va a una rama
  nueva (`git checkout -b <nombre> origin/main`) con su propio PR — nunca
  apilada como commit extra sobre la primera.

## Qué NO construir en V1

Dashboard web · Frontend · App móvil · Pagos · RAG · Biblioteca de ejercicios ·
Analytics · Multi-entrenador · **Segundo proveedor de IA** · **Diffing entre
versiones** · XState · Event sourcing · CQRS · Redis, colas o workers ·
Automatización sin supervisión humana.

Si algo de esto aparece en una propuesta, se rechaza y se anota en el backlog.

**Toda abstracción debe justificar su existencia.** La pregunta es:
*"¿esto ayuda al MVP, o estamos resolviendo un problema que aún no tenemos?"*
