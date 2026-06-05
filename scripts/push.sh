#!/bin/bash

cd "$(dirname "$0")"

echo ""
echo "=== Lionade Push ==="

# Check if there's anything to commit
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "Nothing to commit — working tree is clean."
  exit 0
fi

# Show what's changed
echo ""
git status --short
echo ""

# Ask for commit message
read -p "Commit message: " msg

if [ -z "$msg" ]; then
  echo "Aborted — commit message cannot be empty."
  exit 1
fi

git add -A
git commit -m "$msg"
git push origin main

echo ""
echo "Done! Pushed to github.com/Samc0105/lionade"
