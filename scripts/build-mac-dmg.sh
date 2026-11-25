#!/usr/bin/env bash
# 在 macOS 上构建通用架构（Intel + Apple Silicon）的 cDesk.app 并打包为 dmg。
# 用法：npm run dist:mac:dmg
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != "Darwin" ]; then
  echo "错误：appdmg 依赖 macOS 的 hdiutil，只能在 macOS 上打包 dmg。" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
APP="release/mac-universal/cDesk.app"
DMG="release/cDesk-${VERSION}.dmg"

npm run build
npx electron-builder --mac --universal --dir

if [ ! -d "$APP" ]; then
  echo "错误：未找到 $APP，请检查 electron-builder 输出目录。" >&2
  exit 1
fi

rm -f "$DMG"
npx appdmg build/dmg.json "$DMG"
echo "已生成：$DMG"
