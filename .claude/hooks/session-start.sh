#!/bin/bash
# Prepara una sesión de Claude Code en la nube para correr typecheck, lint y
# los tres niveles de tests (unit, integración/E2E y Deno) sin pasos a mano.
#
# Solo corre en la nube: en una máquina local cada quien ya tiene su entorno.
# Es idempotente: correrlo dos veces deja el mismo estado.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# ── 1. Dependencias ──────────────────────────────────────────────────────────
# `install` y no `install --frozen-lockfile`: el estado del contenedor se
# cachea al terminar el hook, y así la siguiente sesión reutiliza lo ya bajado.
pnpm install

# ── 2. PostgreSQL para los tests de integración y E2E ────────────────────────
# El contenedor trae un cluster instalado pero apagado. Los procesos no
# sobreviven al cacheo, así que hay que arrancarlo en cada sesión.
#
# `postgres:postgres` NO es un secreto: es la misma credencial desechable que
# usa CI (.github/workflows/ci.yml) y el valor por defecto de
# tests/helpers/db.ts, sobre una base que solo escucha en localhost, se crea
# vacía y se tira al terminar.
#
# El contenedor trae PostgreSQL 16; CI y producción usan 17. Es la imagen de
# la sesión, no se elige aquí: CI sigue siendo la referencia.
if command -v pg_lsclusters >/dev/null 2>&1; then
  read -r pg_version pg_cluster _ < <(pg_lsclusters --no-header | head -n 1)

  if [ -n "${pg_version:-}" ]; then
    if ! pg_lsclusters --no-header | grep -q "online"; then
      pg_ctlcluster "$pg_version" "$pg_cluster" start
    fi

    until pg_isready -q -h 127.0.0.1 -p 5432; do sleep 1; done

    su postgres -c "psql -qc \"ALTER USER postgres WITH PASSWORD 'postgres';\""
  fi
else
  echo "Aviso: no hay PostgreSQL en el contenedor; pnpm test:integration no va a poder correr." >&2
fi
