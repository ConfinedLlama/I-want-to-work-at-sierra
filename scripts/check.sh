#!/usr/bin/env bash
# One entry point for every check, used locally, by the push gate and by CI.
# Usage: scripts/check.sh [format|fix|lint|typecheck|test|all]
set -euo pipefail

cd "$(dirname "$0")/.."

# The repo pins its Node version in .nvmrc. If the shell is on something else
# and nvm is around, switch rather than fail with a confusing engine error.
want="$(cat .nvmrc)"
have="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1 || true)"
if [ "$have" != "$want" ] && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use >/dev/null
fi

if [ ! -d node_modules ]; then
  pnpm install --frozen-lockfile
fi

case "${1:-all}" in
  format) pnpm format:check ;;
  fix) pnpm format ;;
  lint) pnpm lint ;;
  typecheck) pnpm typecheck ;;
  test) pnpm test ;;
  all) pnpm check ;;
  *)
    echo "unknown check: $1" >&2
    exit 2
    ;;
esac
