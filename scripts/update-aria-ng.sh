#!/usr/bin/env bash
# ============================================
# scripts/update-aria-ng.sh
# Update AriaNg bundle from submodule source.
# ============================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUBMODULE_DIR="$ROOT_DIR/submodules/AriaNg"
DIST_DIR="$ROOT_DIR/aria-ng"

echo "==> Updating AriaNg submodule..."
cd "$SUBMODULE_DIR"

# Stash any local changes (e.g. package-lock.json from previous build)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "    Stashing local changes..."
  git stash --include-untracked
fi

git checkout master
git pull origin master

echo ""
echo "==> Installing dependencies..."
npm install --silent

echo ""
echo "==> Building AriaNg..."
npm run build

echo ""
echo "==> Copying dist to $DIST_DIR..."
rm -rf "$DIST_DIR"
cp -r dist "$DIST_DIR"

echo ""
echo "==> Done! AriaNg updated to $(git describe --tags 2>/dev/null || echo 'latest master')"
echo "    Files in: $DIST_DIR"
echo ""
echo "    To commit:"
echo "      git add -A && git commit -m \"chore: update AriaNg to latest\""
