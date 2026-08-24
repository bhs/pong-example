#!/usr/bin/env sh
# teardown.sh – Destroy the Fly.io app provisioned by deploy.sh
#
# Environment variables (provided by Mendel):
#   FLY_API_TOKEN       – Fly.io personal access token
#   MENDEL_VARIATION_ID – Same unique identifier used during deployment
#
# The script is idempotent: if the app is already gone, it exits cleanly.

set -eu

# ── Validate required environment variables ───────────────────────────────────
if [ -z "${FLY_API_TOKEN:-}" ]; then
  echo "ERROR: FLY_API_TOKEN is not set." >&2
  exit 1
fi

if [ -z "${MENDEL_VARIATION_ID:-}" ]; then
  echo "ERROR: MENDEL_VARIATION_ID is not set." >&2
  exit 1
fi

export FLY_API_TOKEN

# ── Reconstruct the app name (must exactly match deploy.sh logic) ─────────────
SHORT_ID=$(printf '%s' "${MENDEL_VARIATION_ID}" \
  | tr '[:upper:]' '[:lower:]' \
  | tr -cs 'a-z0-9' '-' \
  | sed 's/^-//;s/-$//' \
  | cut -c1-20)
APP_NAME="pong-${SHORT_ID}"

echo "Targeting Fly.io app: ${APP_NAME}" >&2

# ── Verify flyctl is available ────────────────────────────────────────────────
if ! command -v flyctl >/dev/null 2>&1; then
  echo "ERROR: flyctl not found in PATH." >&2
  exit 1
fi

# ── Destroy the app (idempotent) ──────────────────────────────────────────────
EXISTING=$(flyctl apps list --json 2>/dev/null || echo '[]')
if printf '%s' "${EXISTING}" | grep -q "\"${APP_NAME}\""; then
  echo "Destroying Fly.io app '${APP_NAME}'..." >&2
  flyctl apps destroy "${APP_NAME}" --yes >&2 || {
    echo "ERROR: Failed to destroy app '${APP_NAME}'." >&2
    exit 1
  }
  echo "App '${APP_NAME}' destroyed successfully." >&2
else
  echo "App '${APP_NAME}' not found – nothing to tear down." >&2
fi

# ── Remove any generated fly.toml from the repo root ─────────────────────────
if [ -d "/workspace" ]; then
  REPO_ROOT="/workspace"
else
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

FLY_TOML="${REPO_ROOT}/fly.toml"
if [ -f "${FLY_TOML}" ]; then
  rm -f "${FLY_TOML}"
  echo "Removed generated ${FLY_TOML}" >&2
fi

echo "Teardown complete." >&2
