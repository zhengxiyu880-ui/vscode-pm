@echo off
chcp 65001 >nul
title 项目管理系统
setlocal

cd /d "%~dp0"

if not defined PM_PORT set "PM_PORT=5177"
set "PORT=%PM_PORT%"
set "HOST=127.0.0.1"
set "PM_DATA_FILE=%APPDATA%\vscode-pm\db.json"
if not exist "%APPDATA%\vscode-pm" mkdir "%APPDATA%\vscode-pm"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   找不到 Node.js。需要先安装 Node.js 18 或更新版本：
    echo   https://nodejs.org
    echo.
    echo   装好之后再双击本文件。
    echo.
    pause
    exit /b 1
)

echo.
echo   项目管理系统正在启动……
echo   浏览器会自动打开 http://127.0.0.1:%PORT%
echo   用完关掉这个窗口即可停止服务。
echo.

rem 等 3 秒再打开浏览器，避免服务还没起来
start "" /b cmd /c "timeout /t 3 >nul & rundll32 url.dll,FileProtocolHandler http://127.0.0.1:%PORT%"

node server.js

echo.
echo   服务已停止。
pause
