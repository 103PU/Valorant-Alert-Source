Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
strDesktop = WshShell.SpecialFolders("Desktop")

Set oShellLink = WshShell.CreateShortcut(strDesktop & "\Valorant Score Alert.lnk")
oShellLink.TargetPath = "wscript.exe"
oShellLink.Arguments = "//nologo """ & strScriptDir & "\scripts\launcher.vbs"""
oShellLink.WorkingDirectory = strScriptDir
oShellLink.WindowStyle = 7
oShellLink.IconLocation = strScriptDir & "\assets\icon.ico,0"
oShellLink.Description = "Valorant Realtime Score Alert"
oShellLink.Save

WScript.Echo "Da tao Shortcut Valorant Score Alert ngoai Desktop thanh cong!"
