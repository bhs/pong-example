#!/bin/sh
# teardown.sh – Destroy the Fly.io app provisioned by deploy.sh
#
# Environment variables (provided by Mendel):
#   FLY_API_TOKEN       – Fly.io personal access token
#   MENDEL_VARIATION_ID – Same unique identifier used during deployment
#
# The script is idempotent: if the app is already gone it exits cleanly.

set -eu

# ── Install flyctl ─────────────────────────────────────────────────────────────
if ! command -v flyctl >/dev/null 2>&1; then
  echo "Installing flyctl..." >&2
  if ! command -v curl >/dev/null 2>&1; then
    apk add --no-cache curl >&2
  fi
  curl -fsSL https://fly.io/install.sh | sh >&2
fi

export PATH="${HOME}/.fly/bin:${PATH}"

if ! command -v flyctl >/dev/null 2>&1; then
  echo "ERROR: flyctl installation failed." >&2
  exit 1
fi

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
  | sed 's/^-*//;s/-*$//' \
  | cut -c1-20)
APP_NAME="pong-${SHORT_ID}"
echo "Targeting Fly.io app: ${APP_NAME}" >&2

# ── Destroy the app (idempotent) ──────────────────────────────────────────────
APP_EXISTS=$(flyctl apps list --json 2>/dev/null \
  | grep '"Name"' \
  | grep "\"${APP_NAME}\"" || true)

if [ -n "${APP_EXISTS}" ]; then
  echo "Destroying Fly.io app '${APP_NAME}'..." >&2
  if ! flyctl apps destroy "${APP_NAME}" --yes >&2; then
    echo "ERROR: Failed to destroy app '${APP_NAME}'." >&2
    exit 1
  fi
  echo "App '${APP_NAME}' destroyed successfully." >&2
else
  echo "App '${APP_NAME}' not found – nothing to tear down." >&2
fi

# ── Remove any generated fly.toml from the workspace ─────────────────────────
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
