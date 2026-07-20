#!/usr/bin/env bash
# 在 macOS 上交叉打包 Windows x64 ZIP 绿色版。
#
# 坑:ffmpeg-static 在 npm install 时只装了当前平台(mac)的二进制。
# electron-packager --platform=win32 会换 Electron 本体,但不会换 ffmpeg。
# 所以打包前临时把 ffmpeg 换成 win 版,打完再换回 mac 版,不破坏本地 dev。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FFDIR="$ROOT/node_modules/ffmpeg-static"
MAC_BIN="$FFDIR/ffmpeg"
WIN_BIN="$FFDIR/ffmpeg.exe"
BACKUP="$FFDIR/.ffmpeg.mac.bak"

cleanup() {
  # 恢复 mac 版 ffmpeg,删掉 win 版,保证本地 npm start 正常
  if [ -f "$BACKUP" ]; then
    mv -f "$BACKUP" "$MAC_BIN"
  fi
  rm -f "$WIN_BIN"
}
trap cleanup EXIT

echo "==> 备份 mac 版 ffmpeg"
cp -f "$MAC_BIN" "$BACKUP"

echo "==> 下载 Windows x64 版 ffmpeg.exe"
# 强制 ffmpeg-static 只解析/下载 win32 x64 二进制到 ffmpeg.exe
rm -f "$WIN_BIN"
( cd "$ROOT" && npm_config_platform=win32 npm_config_arch=x64 node node_modules/ffmpeg-static/install.js )

if [ ! -f "$WIN_BIN" ]; then
  echo "!! ffmpeg.exe 未生成,打包中止" >&2
  exit 1
fi
echo "==> ffmpeg.exe 就绪: $(du -h "$WIN_BIN" | cut -f1)"

# surreal.exe(SurrealDB 引擎)不入仓(见 .gitignore),缺了就按需下载。
# forge.config extraResource 会把它拷进包;缺了数据层起不来。
# 版本须与 dev 用的 server 对齐(2026-07 = 3.0.4)。
SURREAL_VERSION="3.0.4"
SURREAL_WIN="$ROOT/build/surreal/win32-x64/surreal.exe"
if [ ! -f "$SURREAL_WIN" ]; then
  echo "==> 下载 surreal ${SURREAL_VERSION} win-x64 (~90MB)"
  mkdir -p "$(dirname "$SURREAL_WIN")"
  curl -fsSL \
    "https://github.com/surrealdb/surrealdb/releases/download/v${SURREAL_VERSION}/surreal-v${SURREAL_VERSION}.windows-amd64.exe" \
    -o "$SURREAL_WIN"
  if [ ! -f "$SURREAL_WIN" ]; then
    echo "!! surreal.exe 下载失败,数据库引擎不会进包 → 打包中止" >&2
    exit 1
  fi
fi
echo "==> surreal.exe 就绪: $(du -h "$SURREAL_WIN" | cut -f1)"

echo "==> electron-forge make --platform=win32 --arch=x64"
# KRIG_TARGET_PLATFORM 让 forge.config 在 mac 交叉打 win 时也注入 surreal.exe
( cd "$ROOT" && KRIG_TARGET_PLATFORM=win32 npx electron-forge make --platform=win32 --arch=x64 )

echo "==> 打包完成,产物在 out/make/"
find "$ROOT/out/make" -name '*.zip' -newer "$BACKUP" 2>/dev/null || true
