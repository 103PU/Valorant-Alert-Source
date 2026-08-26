@echo off
cd /d "%~dp0"

:: Auto-create Desktop Shortcut with official icon if missing
if not exist "%USERPROFILE%\Desktop\Valorant Score Alert.lnk" (
  cscript //nologo Create-Desktop-Shortcut.vbs >nul 2>&1
)

:: Launch Background System Tray Runner (Hidden console)
start "" powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\tray.ps1"
exit
