#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

OUTPUT_PATH=""
if [ "${1:-}" = "--output_path" ]; then
  OUTPUT_PATH="$2"
  shift 2
fi

MODE="${1:-new}"
TEST_LOG="$(mktemp)"
STATUS=0

run_tests() {
  regex="$1"
  shift
  npx vitest run --config config/vitest.config.ts "$regex" -- "$@" 2>&1 | tee -a "$TEST_LOG"
  status=${PIPESTATUS[0]}
  if [ "$status" -ne 0 ]; then STATUS=$status; fi
}

case "$MODE" in
  base)
    run_tests "src/renderer/src/lib/orchestration-skill-coverage"
    ;;
  new)
    run_tests "src/__tests__/skill-discovery-pi-opencode"
    ;;
esac

if [ -n "$OUTPUT_PATH" ]; then
  cat "$TEST_LOG" > "$OUTPUT_PATH" || true
fi
exit "$STATUS"
