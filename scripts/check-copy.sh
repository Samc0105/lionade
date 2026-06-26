#!/usr/bin/env bash
#
# Copy guard — fails the build if specific user-facing regressions reappear.
# Deliberately CONSERVATIVE: it only flags exact known-bad strings, so it never
# false-positives on identifiers (userCoins, coin_reward, formatCoins, etc.).
# Add patterns here as new "never ship this again" rules are agreed.
#
# Run locally:  bash scripts/check-copy.sh
# Wire into CI before `next build`.

set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
SEARCH_DIRS="app components lib"

check() {
  local pattern="$1" desc="$2"
  local hits
  hits=$(grep -rniE "$pattern" $SEARCH_DIRS 2>/dev/null | grep -viE "scripts/check-copy")
  if [ -n "$hits" ]; then
    echo "✗ $desc"
    echo "$hits" | sed 's/^/    /'
    echo ""
    FAIL=1
  fi
}

# 1. Placeholder assets must never ship.
check "/image-name\.png" "placeholder asset /image-name.png — point at a real asset in public/"

# 2. Cash-out is a future/V2 feature. No copy may claim it is live.
check "cash out at \\\$|cash payouts opened|live for early cohorts|still cash out real money|worth \\\$[0-9].*cash payout" \
  "live cash-out claim — cash-out is future/V2 only, never advertise it as live"

if [ "$FAIL" -eq 0 ]; then
  echo "✓ copy guard passed"
fi
exit $FAIL
