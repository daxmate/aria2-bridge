#!/usr/bin/env bash
# ============================================
# scripts/package.sh
# Create a release zip for GitHub Releases.
# ============================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo 'dev')}"
OUTPUT_DIR="${2:-/tmp/aria2-bridge-release}"
ZIP_NAME="aria2-bridge-${VERSION}.zip"

echo "==> Packaging v${VERSION}..."

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/aria2-bridge"

cd "$ROOT_DIR"

# Copy project files (exclude dev artifacts)
cp \
  manifest.json \
  background.js \
  content.js \
  options.html \
  options.js \
  README.md \
  "$OUTPUT_DIR/aria2-bridge/"

# Copy assets
cp -r \
  icons \
  aria-ng \
  "$OUTPUT_DIR/aria2-bridge/"

cd "$OUTPUT_DIR"

echo "==> Creating $ZIP_NAME..."
zip -r "$ZIP_NAME" aria2-bridge > /dev/null
ls -lh "$ZIP_NAME"

echo ""
echo "==> Done! File: $OUTPUT_DIR/$ZIP_NAME"
echo ""
echo "    To create a GitHub release:"
echo "      gh release create ${VERSION} ${OUTPUT_DIR}/${ZIP_NAME} \\"
echo "        --repo daxmate/aria2-bridge \\"
echo "        --title \"Aria2 Bridge ${VERSION}\" \\"
echo "        --notes \"Release notes here\""
