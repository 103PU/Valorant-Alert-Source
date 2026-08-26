@echo off
title Valorant Realtime Score Alert Launcher
color 0A
cls
echo ===========================================================
echo    VALORANT REALTIME SCORE ALERT (PC DESKTOP LAUNCHER)
echo ===========================================================
echo.
echo [1/2] Cleaning up any old process holding port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

echo [2/2] Starting Valorant Alert Server & PC Dashboard...
echo.

cd /d "%~dp0"

:: Auto-create Desktop Shortcut if missing
if not exist "%USERPROFILE%\Desktop\Valorant Score Alert.lnk" (
  cscript //nologo Create-Desktop-Shortcut.vbs >nul 2>&1
)

if exist "ValorantScoreAlert.exe" (
  ValorantScoreAlert.exe
) else (
  node server/index.js
)

pause
