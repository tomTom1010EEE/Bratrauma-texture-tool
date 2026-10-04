@echo off
setlocal
cd /d "%~dp0"
set "SPRITELAB_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%SPRITELAB_NODE%" goto launch
set "SPRITELAB_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. See README.md.
  pause
  exit /b 1
)
:launch
"%SPRITELAB_NODE%" scripts\launch.mjs
if errorlevel 1 pause
