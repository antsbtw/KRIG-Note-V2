#!/bin/bash
# Patch Electron dev binary for macOS — set app name and icon.
#
# 背景:macOS 应用菜单首项粗体名取自 Info.plist 的 CFBundleName,
# 不是 app.setName()。dev mode 跑的是 node_modules 内的 Electron.app,
# 默认 CFBundleName='Electron',所以菜单首项显 "Electron"。
#
# 这个脚本由 postinstall 自动调用,改写 Electron.app 的 Info.plist
# + 替换图标资源,让 dev mode 菜单 + dock 显示 'KRIG Note' + KRIG logo。
#
# 重装 electron(`npm install` 触发)时自动重跑;不需要手动调。
#
# Linux / Windows 不需要这一步(它们的应用菜单不依赖 Info.plist),
# 脚本在非 macOS 上跳过。

if [ "$(uname)" != "Darwin" ]; then
  exit 0
fi

ELECTRON_APP="node_modules/electron/dist/Electron.app"
PLIST="$ELECTRON_APP/Contents/Info.plist"
ICON_SRC="build/icon.icns"
ICON_DST="$ELECTRON_APP/Contents/Resources/electron.icns"

if [ ! -f "$PLIST" ]; then
  echo "Electron plist not found, skipping dev patch."
  exit 0
fi

# Patch app name
/usr/libexec/PlistBuddy -c "Set CFBundleName 'KRIG Note'" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Set CFBundleDisplayName 'KRIG Note'" "$PLIST" 2>/dev/null

# Patch icon
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DST"
fi

echo "✅ Patched Electron dev binary: KRIG Note"
