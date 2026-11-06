@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0service.ps1" status
pause
