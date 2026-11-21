Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get absolute path of root project directory
strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
strRootDir = fso.GetParentFolderName(strScriptDir)
If Not fso.FileExists(strRootDir & "\server\index.js") And Not fso.FileExists(strRootDir & "\config.json") Then
    strRootDir = strScriptDir
End If

' Set working directory to project root
WshShell.CurrentDirectory = strRootDir

' 1. Clean up old processes on configured port (default 3000)
strPort = "3000"
If fso.FileExists(strRootDir & "\config.json") Then
    On Error Resume Next
    Set cfgFile = fso.OpenTextFile(strRootDir & "\config.json", 1)
    strCfg = cfgFile.ReadAll
    cfgFile.Close
    Set rePort = New RegExp
    rePort.Pattern = """port""\s*:\s*(\d+)"
    Set mPort = rePort.Execute(strCfg)
    If mPort.Count > 0 Then strPort = mPort(0).SubMatches(0)
    On Error GoTo 0
End If
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr /R /C:"":" & strPort & " "" ^| findstr LISTENING') do taskkill /f /pid %a", 0, True

' 2. Ensure Desktop Shortcut exists and points to correct path (Windowless)
strDesktop = WshShell.SpecialFolders("Desktop")
If Not fso.FileExists(strDesktop & "\Valorant Score Alert.lnk") Then
    WshShell.Run "wscript //nologo """ & strRootDir & "\Create-Desktop-Shortcut.vbs""", 0, True
End If

' 3. Start Valorant Alert Server (Pure hidden background window)
If fso.FileExists(strRootDir & "\ValorantScoreAlert.exe") Then
    WshShell.Run """" & strRootDir & "\ValorantScoreAlert.exe""", 0, False
Else
    WshShell.Run "node """ & strRootDir & "\server\index.js""", 0, False
End If

' 4. Start PowerShell System Tray Icon (Pure hidden background window)
WshShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & strRootDir & "\scripts\tray.ps1""", 0, False
