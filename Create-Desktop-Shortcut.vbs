Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
strCurrentDir = WshShell.CurrentDirectory

Set oShellLink = WshShell.CreateShortcut(strDesktop & "\Valorant Score Alert.lnk")
oShellLink.TargetPath = strCurrentDir & "\Start-ValorantAlert.bat"
oShellLink.WorkingDirectory = strCurrentDir
oShellLink.WindowStyle = 1
oShellLink.IconLocation = strCurrentDir & "\assets\icon.ico,0"
oShellLink.Description = "Valorant Realtime Score Alert Launcher"
oShellLink.Save

WScript.Echo "Icon Shortcut Valorant Score Alert đã được tạo ngoài Desktop với Icon chính thức!"
