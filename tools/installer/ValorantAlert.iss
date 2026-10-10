#define MyAppName "Valorant Score Alert"
#define MyAppExeName "ValorantScoreAlert.exe"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\\..\\dist\\ValorantScoreAlert-Release"
#endif
#ifndef OutputDir
  #define OutputDir "..\\..\\dist"
#endif

[Setup]
AppId={{B7E0B5A4-8E77-4B4E-9A06-7A1E7A1E2026}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\Programs\ValorantAlert
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=ValorantScoreAlert-v{#MyAppVersion}-win-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes
CloseApplications=yes
RestartApplications=no
AppMutex=ValorantAlertInstallMutex

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs restartreplace

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\scripts\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\icon.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\scripts\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\icon.ico"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\scripts\launcher.vbs"""; WorkingDir: "{app}"; Flags: nowait skipifsilent

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/F /IM ValorantScoreAlert.exe /T"; Flags: runhidden

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/F /IM ValorantScoreAlert.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('powershell.exe', '-NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like ''*tray.ps1*'' -or $_.CommandLine -like ''*launcher.vbs*'' -or $_.CommandLine -like ''*ValorantScoreAlert*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('cmd.exe', '/c "for /f ""tokens=5"" %a in (''netstat -aon ^| findstr :3000 ^| findstr LISTENING'') do taskkill /f /pid %a"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(500);
  Result := True;
end;

function InitializeUninstall(): Boolean;
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/F /IM ValorantScoreAlert.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('powershell.exe', '-NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like ''*tray.ps1*'' -or $_.CommandLine -like ''*launcher.vbs*'' -or $_.CommandLine -like ''*ValorantScoreAlert*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;
