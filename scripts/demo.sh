#!/usr/bin/env bash
# One-command demo for judges / Claude Code / Codex screening.
set -euo pipefail
cd "$(dirname "$0")/.."
echo ">>>> 1/3 Attack injection (must fail closed)"
node demos/attack-injection.js
echo
echo ">>>> 2/3 Over-limit (must fail on-chain)"
node demos/over-limit.js
echo
echo ">>>> 3/3 Happy path (allowlisted merchant 0.05 NEAR)"
node demos/happy-path.js
echo
echo "ALL DEMOS PASSED"
