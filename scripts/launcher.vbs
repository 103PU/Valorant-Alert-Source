Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get absolute path of root project directory
strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
strRootDir = fso.GetParentFolderName(strScriptDir)
If Not fso.FileExists(strRootDir & "\server\index.js") Then
    strRootDir = strScriptDir
End If

' Set working directory to project root
WshShell.CurrentDirectory = strRootDir

' 1. Clean up old processes on port 3000
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %a", 0, True

' 2. Ensure Desktop Shortcut exists and points to correct path
strDesktop = WshShell.SpecialFolders("Desktop")
If Not fso.FileExists(strDesktop & "\Valorant Score Alert.lnk") Then
    WshShell.Run "cscript //nologo """ & strRootDir & "\Create-Desktop-Shortcut.vbs""", 0, True
End If

' 3. Start Node Server (Hidden window)
WshShell.Run "node """ & strRootDir & "\server\index.js""", 0, False

' 4. Start PowerShell System Tray Icon (Hidden window)
WshShell.Run "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & strRootDir & "\scripts\tray.ps1""", 0, False
