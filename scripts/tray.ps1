Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

# 1. Clean up any lingering process on port 3000
$portCheck = netstat -aon | findstr :3000 | findstr LISTENING
if ($portCheck) {
    foreach ($line in $portCheck) {
        $parts = $line.Trim() -split '\s+'
        $oldPid = $parts[-1]
        if ($oldPid -and $oldPid -ne '0') {
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        }
    }
}

# 2. Start Node Server in Background
$serverProcess = Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $rootDir -WindowStyle Hidden -PassThru

# 3. Wait briefly for server initialization
Start-Sleep -Milliseconds 1800

$infoUrl = "http://localhost:3000/api/info"
$token = ""
$dashboardUrl = "http://localhost:3000/dashboard.html"
$lanUrl = ""

try {
    $info = Invoke-RestMethod -Uri $infoUrl -Method Get -TimeoutSec 3
    if ($info) {
        $token = $info.token
        $dashboardUrl = $info.dashboardUrl
        $lanUrl = $info.lanUrl
    }
} catch {}

# 4. Create System Tray NotifyIcon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$iconPath = Join-Path $rootDir "assets\icon.ico"
if (Test-Path $iconPath) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$notifyIcon.Text = "Valorant Score Alert (Online)"
$notifyIcon.Visible = $true

# Balloon Tip Notification on Startup
$notifyIcon.BalloonTipTitle = "Valorant Score Alert"
$notifyIcon.BalloonTipText = "Server đang chạy ngầm. Nhấp đôi vào icon để mở PC Dashboard!"
$notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notifyIcon.ShowBalloonTip(3000)

# Function to Open Dashboard Window
function Open-Dashboard {
    try {
        Start-Process "msedge.exe" -ArgumentList "--app=`"$dashboardUrl`"" -ErrorAction Stop
    } catch {
        Start-Process $dashboardUrl
    }
}

# Automatically open Dashboard on launch
Open-Dashboard

# Double Click Handler: Open Dashboard
$notifyIcon.add_DoubleClick({
    Open-Dashboard
})

# 5. Create Right-Click Context Menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

# Option 1: Open Dashboard
$itemDashboard = $contextMenu.Items.Add("[1] Mo PC Dashboard")
$itemDashboard.Font = New-Object System.Drawing.Font($itemDashboard.Font, [System.Drawing.FontStyle]::Bold)
$itemDashboard.add_Click({
    Open-Dashboard
})

# Option 2: Copy LAN URL for Mobile
$itemCopyLan = $contextMenu.Items.Add("[2] Copy Link Mobile (LAN URL)")
$itemCopyLan.add_Click({
    if ($lanUrl) {
        [System.Windows.Forms.Clipboard]::SetText($lanUrl)
        $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
        $notifyIcon.BalloonTipText = "Da copy link LAN: $lanUrl"
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.ShowBalloonTip(2000)
    }
})

$contextMenu.Items.Add("-") | Out-Null

# Option 3: Create Desktop Shortcut
$itemShortcut = $contextMenu.Items.Add("[3] Tao Shortcut Ngoai Desktop")
$itemShortcut.add_Click({
    $vbsPath = Join-Path $rootDir "Create-Desktop-Shortcut.vbs"
    Start-Process "cscript" -ArgumentList "//nologo `"$vbsPath`"" -NoNewWindow
    $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
    $notifyIcon.BalloonTipText = "Da tao shortcut ngoai Desktop!"
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notifyIcon.ShowBalloonTip(2000)
})

# Option 4: Open Config.json
$itemConfig = $contextMenu.Items.Add("[4] Chinh Sua Cau Hinh (config.json)")
$itemConfig.add_Click({
    $cfgPath = Join-Path $rootDir "config.json"
    Start-Process "notepad.exe" -ArgumentList "`"$cfgPath`""
})

# Option 5: Open Logs Folder
$itemLogs = $contextMenu.Items.Add("[5] Mo Thu Muc Logs")
$itemLogs.add_Click({
    $logDir = Join-Path $rootDir "logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Start-Process "explorer.exe" -ArgumentList "`"$logDir`""
})

$contextMenu.Items.Add("-") | Out-Null

# Option 6: Exit Application
$itemExit = $contextMenu.Items.Add("[X] Thoat Ung Dung (Exit)")
$itemExit.ForeColor = [System.Drawing.Color]::Red
$itemExit.add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()

    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    
    [System.Windows.Forms.Application]::Exit()
    [System.Environment]::Exit(0)
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Keep Windows Forms Message Loop running
[System.Windows.Forms.Application]::Run()
