@echo off
title VALORANT SCORE ALERT // LAUNCHER
color 0A
cls

cd /d "%~dp0"

echo ======================================================================
echo   VALORANT REALTIME SCORE ALERT // SYSTEM LAUNCHER
echo ======================================================================
echo.
echo [1/3] Kiem tra va giai phong cong 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

:: Auto-create Desktop Shortcut with official icon if missing
if not exist "%USERPROFILE%\Desktop\Valorant Score Alert.lnk" (
  cscript //nologo Create-Desktop-Shortcut.vbs >nul 2>&1
)

echo [2/3] Khoi chay Server ngam va Icon Khay He Thong (System Tray)...
start "" powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\tray.ps1"

echo [3/3] Dang mo PC Dashboard tren man hinh...
timeout /t 2 /nobreak >nul

echo.
echo ======================================================================
echo   [OK] SERVER VA SYSTEM TRAY ICON DA SAN SANG!
echo ======================================================================
echo.
echo   * Server dang tiep tuc chay ngam trong Khay He Thong (System Tray).
echo   * Ban co the nhap doi chuot vao Icon Valorant o goc phai de mo Dashboard.
echo   * Nhan chuot phai vao Icon de tuy chon Copy Link, Cau Hinh, hoac Thoat.
echo.
echo ======================================================================
echo   [!] NHAN PHIM BAT KY DE DONG CUA SO TERMINAL NAY CHO DO VUONG...
echo ======================================================================
pause >nul
exit
