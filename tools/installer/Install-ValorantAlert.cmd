@echo off
REM Double-click entry point. This exists because a .ps1 does not run on
REM double-click (Windows opens it in an editor), and because a .ps1 extracted
REM from a downloaded zip is blocked by the default RemoteSigned policy - so the
REM install has to be launched with an explicit -ExecutionPolicy Bypass for this
REM one process. Nothing here changes the machine's policy.
setlocal
set "INSTALL_SCRIPT=%~dp0Install-ValorantAlert.ps1"

if not exist "%INSTALL_SCRIPT%" (
    echo [LOI] Khong tim thay Install-ValorantAlert.ps1 canh file .cmd nay.
    echo        Hay giai nen TOAN BO file zip roi chay lai.
    pause
    exit /b 1
)

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%INSTALL_SCRIPT%" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
    echo [LOI] Cai dat that bai, ma loi %EXITCODE%. Doc thong bao phia tren.
) else (
    echo [OK] Hoan tat. Mo shortcut "Valorant Score Alert" tren Desktop de chay.
)

REM Pause so a double-click user can read the result before the window closes.
pause
exit /b %EXITCODE%
