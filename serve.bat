@echo off
title 3D-Viewer Local Server
cd /d "%~dp0"
echo.
echo Starting local server at http://localhost:8080
echo Press CTRL+C to stop.
echo.

REM Prüfen, ob Python installiert ist
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found! Please install Python 3 and try again.
    pause
    exit /b 1
)

REM Starten des Servers
start "" http://localhost:8080/index.html
python -m http.server 8080
pause
