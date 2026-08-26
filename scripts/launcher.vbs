Set WshShell = CreateObject("WScript.Shell")
strCurrentDir = WshShell.CurrentDirectory

' 1. Clean up old process on port 3000
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %a", 0, True

' 2. Auto-create Desktop Shortcut if missing
strDesktop = WshShell.SpecialFolders("Desktop")
If Not CreateObject("Scripting.FileSystemObject").FileExists(strDesktop & "\Valorant Score Alert.lnk") Then
    WshShell.Run "cscript //nologo """ & strCurrentDir & "\Create-Desktop-Shortcut.vbs""", 0, True
End If

' 3. Start Node Server (Hidden window)
WshShell.Run "node """ & strCurrentDir & "\server\index.js""", 0, False

' 4. Start PowerShell System Tray Icon (Hidden window)
WshShell.Run "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & strCurrentDir & "\scripts\tray.ps1""", 0, False
