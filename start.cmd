@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Please run setup.cmd first.
  pause
  exit /b 1
)
if not exist app\dist\index.html (
  echo Please run setup.cmd first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0service.ps1" start
pause
