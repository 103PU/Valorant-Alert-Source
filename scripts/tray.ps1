Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

# Auto-kill old node holding port 3000
$portCheck = netstat -aon | findstr :3000 | findstr LISTENING
if ($portCheck) {
    $parts = $portCheck.Trim() -split '\s+'
    $oldPid = $parts[-1]
    if ($oldPid -and $oldPid -ne '0') {
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    }
}

# Start Node Server in Background
$serverProcess = Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $rootDir -WindowStyle Hidden -PassThru

# Wait briefly for server to initialize
Start-Sleep -Milliseconds 1500

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

# Create NotifyIcon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$iconPath = Join-Path $rootDir "assets\icon.ico"
if (Test-Path $iconPath) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$notifyIcon.Text = "Valorant Score Alert (Running)"
$notifyIcon.Visible = $true

# Balloon Tip on Start
$notifyIcon.BalloonTipTitle = "Valorant Realtime Score Alert"
$notifyIcon.BalloonTipText = "Server đang chạy ngầm. Nhấp đôi vào icon này để mở PC Dashboard!"
$notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notifyIcon.ShowBalloonTip(3000)

# Double Click Handler: Open Dashboard
$notifyIcon.add_DoubleClick({
    try {
        Start-Process "msedge.exe" -ArgumentList "--app=`"$dashboardUrl`"" -ErrorAction Stop
    } catch {
        Start-Process $dashboardUrl
    }
})

# Create Context Menu (Right-Click)
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

# 1. Open PC Dashboard
$itemDashboard = $contextMenu.Items.Add("🖥️  Mở PC Dashboard")
$itemDashboard.Font = New-Object System.Drawing.Font($itemDashboard.Font, [System.Drawing.FontStyle]::Bold)
$itemDashboard.add_Click({
    try {
        Start-Process "msedge.exe" -ArgumentList "--app=`"$dashboardUrl`"" -ErrorAction Stop
    } catch {
        Start-Process $dashboardUrl
    }
})

# 2. Copy LAN URL for Mobile
$itemCopyLan = $contextMenu.Items.Add("📱  Copy Link Cho Điện Thoại (LAN URL)")
$itemCopyLan.add_Click({
    if ($lanUrl) {
        [System.Windows.Forms.Clipboard]::SetText($lanUrl)
        $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
        $notifyIcon.BalloonTipText = "Đã copy link LAN vào Clipboard: $lanUrl"
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.ShowBalloonTip(2000)
    }
})

$contextMenu.Items.Add("-") | Out-Null

# 3. Create Desktop Shortcut
$itemShortcut = $contextMenu.Items.Add("📌  Tạo Shortcut Ngoài Desktop")
$itemShortcut.add_Click({
    $vbsPath = Join-Path $rootDir "Create-Desktop-Shortcut.vbs"
    Start-Process "cscript" -ArgumentList "//nologo `"$vbsPath`"" -NoNewWindow
    $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
    $notifyIcon.BalloonTipText = "Đã tạo Icon Shortcut ngoài Desktop!"
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notifyIcon.ShowBalloonTip(2000)
})

# 4. Open Config.json
$itemConfig = $contextMenu.Items.Add("⚙️  Chỉnh Sửa File Cấu Hình (config.json)")
$itemConfig.add_Click({
    $cfgPath = Join-Path $rootDir "config.json"
    Start-Process "notepad.exe" -ArgumentList "`"$cfgPath`""
})

# 5. Open Logs Folder
$itemLogs = $contextMenu.Items.Add("📁  Mở Thư Mục Logs")
$itemLogs.add_Click({
    $logDir = Join-Path $rootDir "logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    Start-Process "explorer.exe" -ArgumentList "`"$logDir`""
})

$contextMenu.Items.Add("-") | Out-Null

# 6. Exit Application
$itemExit = $contextMenu.Items.Add("❌  Thoát Ứng Dụng (Exit)")
$itemExit.ForeColor = [System.Drawing.Color]::Red
$itemExit.add_Click({
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()

    # Kill server process
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    # Also clean up any lingering node on port 3000
    Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    
    [System.Windows.Forms.Application]::Exit()
    [System.Environment]::Exit(0)
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Run Message Loop
[System.Windows.Forms.Application]::Run()
