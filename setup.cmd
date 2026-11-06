@echo off
cd /d "%~dp0"
if not exist .venv python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
cd model-bridge
call npm.cmd ci
if errorlevel 1 exit /b 1
cd ..
cd app
call npm.cmd ci
if errorlevel 1 exit /b 1
call npm.cmd run build
