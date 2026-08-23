#!/usr/bin/env sh
# teardown.sh – Destroy the Fly.io app provisioned by deploy.sh
# Required env vars:
#   FLY_API_TOKEN       – Fly.io API token
#   MENDEL_VARIATION_ID – Same unique ID used during deployment
set -eu

# ── Validation ────────────────────────────────────────────────────────────────
if [ -z "${FLY_API_TOKEN:-}" ]; then
  echo "ERROR: FLY_API_TOKEN is not set." >&2
  exit 1
fi

if [ -z "${MENDEL_VARIATION_ID:-}" ]; then
  echo "ERROR: MENDEL_VARIATION_ID is not set." >&2
  exit 1
fi

export FLY_API_TOKEN

# ── Reconstruct the app name (must match deploy.sh) ──────────────────────────
SHORT_ID=$(echo "${MENDEL_VARIATION_ID}" | tr '[:upper:]' '[:lower:]' | tr '_' '-' | cut -c1-20)
APP_NAME="pong-${SHORT_ID}"

# ── Ensure flyctl is available ────────────────────────────────────────────────
if ! command -v flyctl >/dev/null 2>&1; then
  echo "ERROR: flyctl is not installed or not in PATH." >&2
  exit 1
fi

# ── Destroy the app (idempotent – no-op if already gone) ─────────────────────
if flyctl apps list --json 2>/dev/null | grep -q "\"${APP_NAME}\""; then
  echo "Destroying Fly.io app '${APP_NAME}'..." >&2
  flyctl apps destroy "${APP_NAME}" --yes 2>&1 >&2 || {
    echo "ERROR: Failed to destroy app '${APP_NAME}'." >&2
    exit 1
  }
  echo "App '${APP_NAME}' destroyed successfully." >&2
else
  echo "App '${APP_NAME}' does not exist – nothing to tear down." >&2
fi

# ── Clean up any generated fly.toml left in the repo root ────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLY_TOML="${REPO_ROOT}/fly.toml"
if [ -f "${FLY_TOML}" ]; then
  rm -f "${FLY_TOML}"
  echo "Removed ${FLY_TOML}" >&2
fi
