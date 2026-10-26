#!/bin/bash
# 项目管理系统 · 启动器
# 由 package.sh 放进 .app/Contents/MacOS/launcher，双击 app 时执行。
# 职责：找 node → 起本地服务 → 等端口就绪 → 打开浏览器 → 退出时关掉服务。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_RES="$(cd "$HERE/../Resources" && pwd)"
SERVED="$APP_RES/app"
# 允许用环境变量覆盖，便于测试 / 排查；正常双击运行时用默认位置
LOG="${PM_LOG:-$HOME/Library/Logs/vscode-pm.log}"
DATA_DIR="${PM_DATA_DIR:-$HOME/Library/Application Support/vscode-pm}"
PORT="${PM_PORT:-5177}"
URL="http://127.0.0.1:$PORT"

mkdir -p "$DATA_DIR" "$(dirname "$LOG")"

alert() {
  /usr/bin/osascript -e "display alert \"项目管理系统\" message \"$1\" as critical" >/dev/null 2>&1 || true
}

# Finder 启动时 PATH 很干净（只有 /usr/bin:/bin:/usr/sbin:/sbin），得自己找 node
find_node() {
  local candidate
  for candidate in \
    "$(command -v node 2>/dev/null || true)" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node; do
    if [ -n "${candidate:-}" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  # nvm：取版本号最大的那个
  if [ -d "$HOME/.nvm/versions/node" ]; then
    candidate="$(ls -1d "$HOME/.nvm/versions/node/"*/bin/node 2>/dev/null | sort -V | tail -1)"
    if [ -n "${candidate:-}" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  fi
  return 1
}

NODE_BIN="$(find_node)"
if [ -z "${NODE_BIN:-}" ]; then
  alert "找不到 Node.js。\n\n请先安装 Node.js 18 或更新版本（https://nodejs.org），装完再重新打开本 app。"
  exit 1
fi

if [ ! -f "$SERVED/server.js" ]; then
  alert "app 包不完整：找不到 server.js。\n\n请重新下载安装包。"
  exit 1
fi

cd "$SERVED" || exit 1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') 启动 ===" >>"$LOG"
PM_DATA_FILE="$DATA_DIR/db.json" HOST=127.0.0.1 PORT="$PORT" \
  "$NODE_BIN" server.js >>"$LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 等服务就绪，最多 10 秒
READY=0
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    alert "服务启动失败。\n\n日志：~/Library/Logs/vscode-pm.log"
    exit 1
  fi
  if /usr/bin/curl -fsS "$URL/api/state" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.1
done

if [ "$READY" -ne 1 ]; then
  alert "服务没能起来。\n\n可能是 $PORT 端口被别的程序占用。\n日志：~/Library/Logs/vscode-pm.log"
  exit 1
fi

if [ "${PM_NO_OPEN:-0}" != "1" ]; then
  /usr/bin/open "$URL"
fi

wait "$SERVER_PID"
