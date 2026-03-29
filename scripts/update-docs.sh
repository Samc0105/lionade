#!/bin/bash
# update-docs.sh — Append to CHANGELOG and optionally FEATURES, then auto-commit.

DOCS_DIR="$(cd "$(dirname "$0")/../docs" && pwd)"
CHANGELOG="$DOCS_DIR/CHANGELOG.md"
FEATURES="$DOCS_DIR/FEATURES.md"

# Prompt for input
printf "What did you build or change? "
read -r INPUT

if [ -z "$INPUT" ]; then
  echo "Nothing entered. Aborting."
  exit 1
fi

TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
DATE=$(date +"%Y-%m-%d")

# --- Append to CHANGELOG ---
# Find the first "## " date header and insert before it, or append at end
ENTRY="- \`$TIMESTAMP\` — $INPUT"

# Check if today's date section already exists
if grep -q "^## $DATE" "$CHANGELOG"; then
  # Append under existing date header
  sed -i '' "/^## $DATE$/a\\
$ENTRY
" "$CHANGELOG"
else
  # Insert a new date section after the "---" separator (line 4)
  sed -i '' "4a\\
\\
## $DATE\\
$ENTRY
" "$CHANGELOG"
fi

echo "Added to CHANGELOG.md"

# --- Append to FEATURES if starts with "feat:" ---
if echo "$INPUT" | grep -qi "^feat:"; then
  FEATURE_DESC=$(echo "$INPUT" | sed 's/^[Ff]eat: *//')
  FEATURE_ENTRY="- **$FEATURE_DESC** — $DATE"

  # Append before the last empty line or at end of file
  echo "$FEATURE_ENTRY" >> "$FEATURES"
  echo "Added to FEATURES.md"
fi

# --- Auto-commit ---
cd "$(dirname "$0")/.."
git add docs/CHANGELOG.md docs/FEATURES.md
git commit -m "docs: update changelog — $INPUT

Co-Authored-By: update-docs.sh <noreply@lionade.dev>"

echo "Done."
