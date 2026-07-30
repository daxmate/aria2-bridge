#!/usr/bin/env bash
# ============================================
# scripts/package.sh
# Create a release zip for GitHub Releases.
# Usage: ./scripts/package.sh [version]
#   version defaults to the latest git tag
# ============================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RAW_VERSION="${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo 'dev')}"
VERSION="${RAW_VERSION#v}"  # strip leading 'v' if present
OUTPUT_DIR="${2:-/tmp/aria2-bridge-release}"
ZIP_NAME="aria2-bridge-${VERSION}.zip"

echo "==> Packaging v${VERSION}..."

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/aria2-bridge"

cd "$ROOT_DIR"

# Copy the complete plugin directory + project docs
cp -r plugin/* "$OUTPUT_DIR/aria2-bridge/"
cp README.md LICENSE "$OUTPUT_DIR/aria2-bridge/"

cd "$OUTPUT_DIR"

echo "==> Creating $ZIP_NAME..."
zip -r "$ZIP_NAME" aria2-bridge > /dev/null
ls -lh "$ZIP_NAME"

echo ""
echo "==> Done! File: $OUTPUT_DIR/$ZIP_NAME"
echo ""
echo "    To create a GitHub release:"
echo "      gh release create v${VERSION} ${OUTPUT_DIR}/${ZIP_NAME} \\"
echo "        --repo daxmate/aria2-bridge \\"
echo "        --title \"Aria2 Bridge v${VERSION}\" \\"
echo "        --notes \"Release notes here\""
