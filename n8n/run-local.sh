#!/usr/bin/env bash
# Runs n8n without Docker, e.g. on macOS versions that current Docker Desktop
# no longer supports. Mirrors the settings in docker-compose.yml.
#
#   n8n/run-local.sh start                     # editor at http://localhost:5678
#   n8n/run-local.sh <any n8n CLI command>     # e.g. execute --id=LendLoopOverdue1
#
# Requires nvm (n8n 2.x needs Node >= 24; your default Node is left alone).
set -euo pipefail

N8N_VERSION=2.46.6
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$DIR/.env" ]; then
  echo "Missing $DIR/.env. Copy n8n/.env.example to n8n/.env and fill it in." >&2
  exit 1
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use --silent 24 >/dev/null || { echo "Run: nvm install 24" >&2; exit 1; }

# Pinned n8n, installed once into a git-ignored folder.
RUNTIME="$DIR/.runtime"
INSTALLED="$(node -p "try{require('$RUNTIME/node_modules/n8n/package.json').version}catch{''}")"
if [ "$INSTALLED" != "$N8N_VERSION" ]; then
  echo "Installing n8n@$N8N_VERSION (one-time, a few minutes)…" >&2
  npm install --prefix "$RUNTIME" "n8n@$N8N_VERSION" --no-audit --no-fund --loglevel=error >&2
fi

# Secrets from n8n/.env (never committed).
set -a
# shellcheck source=/dev/null
source "$DIR/.env"
set +a
# Outside Docker, the Convex local backend is plain localhost.
export CONVEX_SITE_URL="${CONVEX_SITE_URL//host.docker.internal/127.0.0.1}"

export N8N_USER_FOLDER="$DIR/.data"
export N8N_LISTEN_ADDRESS=127.0.0.1
export N8N_HOST=localhost N8N_PORT=5678 N8N_PROTOCOL=http WEBHOOK_URL=http://localhost:5678/
export GENERIC_TIMEZONE=UTC TZ=UTC
export N8N_DIAGNOSTICS_ENABLED=false N8N_PERSONALIZATION_ENABLED=false
export N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
# Code nodes need `crypto` for HMAC and `$env` for the signing secrets.
export NODE_FUNCTION_ALLOW_BUILTIN=crypto N8N_BLOCK_ENV_ACCESS_IN_NODE=false CODE_ENABLE_STDOUT=true
# Data minimisation: execution data contains emails, so prune it.
export EXECUTIONS_DATA_PRUNE=true EXECUTIONS_DATA_MAX_AGE=168
export EXECUTIONS_DATA_SAVE_ON_SUCCESS=none EXECUTIONS_DATA_SAVE_ON_ERROR=all

exec "$RUNTIME/node_modules/.bin/n8n" "$@"
