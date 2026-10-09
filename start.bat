@echo off
rem ============================================================
rem  Hello Site Bot - 一键启动（清理端口 + 启动服务 + 开浏览器）
rem  双击即可，无需配置 PowerShell 执行策略
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"

rem 1. 杀掉占用 3000 端口的旧 node（避免 EADDRINUSE）
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue ^
   | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

rem 2. 前台启动 node（Ctrl+C 停止）
echo   ============================================
echo    Hello Site Bot  启动中...
echo    访问 http://localhost:3000
echo    按 Ctrl+C 停止
echo   ============================================
node server\index.js

pause
