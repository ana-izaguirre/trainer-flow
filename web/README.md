# TrainerFlow — panel web

Implementación de [SPEC-033](../docs/specs/SPEC-033-panel-web.md): panel de
solo lectura para el entrenador. Escribir sigue siendo exclusivo de Telegram
— acá no hay ningún botón que apruebe, edite o envíe nada.

```bash
pnpm web:dev          # http://localhost:3000, necesita web/.env.local
pnpm web:build
pnpm web:typecheck
pnpm web:lint
```

Variables de entorno: `web/.env.example` tiene la única que no es secreta.
El resto está en `docs/SECURITY.md`.

Reusa `_core/` directo (mismo dominio, misma `authorization.ts`) vía el path
alias `@core/*` — ver SPEC-033 §3.2.
