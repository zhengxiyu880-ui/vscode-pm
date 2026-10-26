#!/bin/bash
# 打包成可直接分发的安装包
#
#   ./package.sh            → dist/vscode-pm-<版本>.dmg（macOS）
#                             dist/vscode-pm-<版本>-windows.zip（Windows）
#   ./package.sh --no-dmg   → 跳过 dmg（在非 macOS 上跑得用这个）
#
# 说明：这是「启动器」式打包，不是 Electron。
# .app 里只有启动脚本 + 服务端代码，依赖系统已装的 Node.js；
# 好处是包只有几十 KB、不破坏「零依赖」的定位，坏处是对方得装 Node。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

DIST="$HERE/dist"
NAME="vscode-pm"
VERSION="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$VERSION" ] || { echo "读不到 package.json 里的 version"; exit 1; }

MAKE_DMG=1
[ "${1:-}" = "--no-dmg" ] && MAKE_DMG=0

FILES=(server.js package.json LICENSE README.md)
COPY_DIRS=(public)

echo "==> 清理 dist/"
rm -rf "$DIST"
mkdir -p "$DIST"

# ---------------------------------------------------------------- macOS .app
if [ "$(uname -s)" = "Darwin" ]; then
  APP="$DIST/项目管理.app"
  echo "==> 组装 $APP"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

  for f in "${FILES[@]}"; do cp "$f" "$APP/Contents/Resources/app/"; done
  for d in "${COPY_DIRS[@]}"; do cp -R "$d" "$APP/Contents/Resources/app/"; done
  cp packaging/使用说明.txt "$APP/Contents/Resources/app/"

  cp packaging/macos/launcher.sh "$APP/Contents/MacOS/launcher"
  chmod +x "$APP/Contents/MacOS/launcher"
  cp packaging/macos/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleDisplayName</key>
    <string>项目管理系统</string>
    <key>CFBundleName</key>
    <string>项目管理系统</string>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>local.vscodepm</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>$VERSION</string>
    <key>CFBundleVersion</key>
    <string>$VERSION</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.productivity</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSHumanReadableCopyright</key>
    <string>MIT License · 数据只存在本机</string>
</dict>
</plist>
PLIST

  # 清掉扩展属性并 ad-hoc 签名，减少 Gatekeeper 的麻烦
  xattr -cr "$APP" 2>/dev/null || true
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "   (签名失败，未签名也能运行)"

  # zip（保留 app 包结构与可执行位）
  echo "==> 打 zip"
  ( cd "$DIST" && ditto -c -k --sequesterRsrc --keepParent "项目管理.app" "$NAME-$VERSION-macos.zip" )

  # dmg
  if [ "$MAKE_DMG" -eq 1 ]; then
    echo "==> 打 dmg"
    STAGE="$DIST/.dmg-stage"
    rm -rf "$STAGE"
    mkdir -p "$STAGE"
    cp -R "$APP" "$STAGE/"
    cp packaging/使用说明.txt "$STAGE/"
    ln -s /Applications "$STAGE/Applications"
    if hdiutil create -quiet -volname "项目管理系统 $VERSION" -srcfolder "$STAGE" \
      -ov -format UDZO "$DIST/$NAME-$VERSION.dmg"; then
      echo "    ✓ dmg 已生成"
    else
      echo "    ! 无法生成 dmg（hdiutil 在当前环境被限制），zip 版照样能用"
      echo "      在你的「终端」里跑一次 ./package.sh 通常就能生成"
    fi
    rm -rf "$STAGE"
  fi
else
  echo "==> 非 macOS，跳过 .app / .dmg"
fi

# ---------------------------------------------------------------- Windows zip
echo "==> 组装 Windows 版"
WIN="$DIST/$NAME-windows"
mkdir -p "$WIN"
for f in "${FILES[@]}"; do cp "$f" "$WIN/"; done
for d in "${COPY_DIRS[@]}"; do cp -R "$d" "$WIN/"; done
cp packaging/使用说明.txt "$WIN/README-zh.txt"
cp packaging/windows/start.cmd "$WIN/"
echo "==> 打 zip"
( cd "$DIST" && zip -qr "$NAME-$VERSION-windows.zip" "$NAME-windows" )
rm -rf "$WIN"

# ---------------------------------------------------------------- 汇总
echo
echo "==> 产物："
ls -lh "$DIST" | grep -v "^total"
echo
echo "上传到 GitHub Release："
echo "  gh release upload v$VERSION dist/*.zip dist/*.dmg --clobber   # dmg 不存在时去掉它"
