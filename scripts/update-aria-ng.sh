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
echo "==> Applying Chrome Extension fixes..."
# 添加 Angular $sce 修复（chrome-extension:// 协议白名单）
cp "$ROOT_DIR/scripts/aria-ng-fix.js" "$DIST_DIR/js/aria-ng-fix.js"
# 在 index.html 中注入 fix 脚本引用（在 aria-ng 主 JS 之后、</body> 之前）
sed -i '' 's|aria-ng-b351331f1a\.min\.js"></script></body>|aria-ng-b351331f1a.min.js"></script><script src="js/aria-ng-fix.js"></script></body>|' "$DIST_DIR/index.html"

echo ""
echo "==> Done! AriaNg updated to $(git describe --tags 2>/dev/null || echo 'latest master')"
echo "    Files in: $DIST_DIR"
echo ""
echo "    To commit:"
echo "      git add -A && git commit -m \"chore: update AriaNg to latest\""
