#!/usr/bin/env bash
# ============================================
# scripts/update-aria-ng.sh
# Update AriaNg bundle from submodule source.
# ============================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUBMODULE_DIR="$ROOT_DIR/submodules/AriaNg"
DIST_DIR="$ROOT_DIR/plugin/aria-ng"

echo "==> Updating AriaNg submodule..."
cd "$SUBMODULE_DIR"

# 修正子模块 remote（防止被人改错指向了父仓库）
EXPECTED_URL="https://github.com/mayswind/AriaNg.git"
CURRENT_URL="$(git remote get-url origin 2>/dev/null || true)"
if [ "$CURRENT_URL" != "$EXPECTED_URL" ]; then
  echo "    Fixing submodule remote: $CURRENT_URL -> $EXPECTED_URL"
  git remote set-url origin "$EXPECTED_URL"
fi

# 丢弃生成文件（package-lock.json 等）的本地修改，避免 pull 被阻塞
git checkout -- .
git checkout master
git pull origin master

echo ""
echo "==> Installing dependencies..."
npm install

echo ""
echo "==> Building AriaNg..."
npm run build

echo ""
echo "==> Copying dist to $DIST_DIR..."
rm -rf "$DIST_DIR"
cp -r dist/ "$DIST_DIR"

echo ""
echo "==> Applying Chrome Extension fixes..."
# 添加 Angular $sce 修复（chrome-extension:// 协议白名单）
cp "$ROOT_DIR/scripts/aria-ng-fix.js" "$DIST_DIR/js/aria-ng-fix.js"
# 在 index.html 中注入 fix 脚本引用（在 aria-ng 主 JS 之后、</body> 之前）
/usr/bin/sed -i '' 's|aria-ng-[a-f0-9]*\.min\.js"></script>|&<script src="js/aria-ng-fix.js"></script>|' "$DIST_DIR/index.html"

if ! grep -q 'aria-ng-fix' "$DIST_DIR/index.html"; then
  echo "ERROR: Failed to inject aria-ng-fix.js into index.html"
  exit 1
fi

echo ""
echo "==> Done! AriaNg updated to $(git describe --tags 2>/dev/null || echo 'latest master')"
echo "    Files in: $DIST_DIR"
echo ""
echo "    To commit:"
echo "      git add -A && git commit -m \"chore: update AriaNg to latest\""
