Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Terminate any duplicate previous tray process
$currentPid = $PID
try {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { 
        $_.ProcessId -ne $currentPid -and $_.CommandLine -like "*tray.ps1*" 
    } | ForEach-Object { 
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue 
    }
} catch {}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $scriptDir) { $scriptDir = $PSScriptRoot }
$rootDir = Split-Path -Parent $scriptDir
if (-not (Test-Path "$rootDir\server") -and -not (Test-Path "$rootDir\config.json")) { $rootDir = $scriptDir }
Set-Location $rootDir

# Read Config for dynamic port
$configPort = 3000
$configPath = Join-Path $rootDir "config.json"
if (Test-Path $configPath) {
    try {
        $cfgJson = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($cfgJson.port) { $configPort = $cfgJson.port }
    } catch {}
}

# Global URL State
$global:token = ""
$global:dashboardUrl = "http://localhost:$configPort/dashboard.html"
$global:lanUrl = ""

# Quick non-blocking server probe function
function Probe-Server-Info {
    try {
        $info = Invoke-RestMethod -Uri "http://localhost:$configPort/api/info" -Method Get -TimeoutSec 1 -ErrorAction Stop
        if ($info) {
            $global:token = $info.token
            $global:dashboardUrl = $info.dashboardUrl
            $global:lanUrl = $info.lanUrl
            return $true
        }
    } catch {}
    return $false
}

# Initial probe
Probe-Server-Info | Out-Null

# Create System Tray NotifyIcon
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$iconPath = Join-Path $rootDir "assets\icon.ico"
if (Test-Path $iconPath) {
    try {
        $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
    } catch {
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
    }
} else {
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$notifyIcon.Text = "Valorant Score Alert (Online)"
$notifyIcon.Visible = $true

# Show confirmation balloon tip on startup
try {
    $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
    $notifyIcon.BalloonTipText = "Dang chay ngam! Nhap doi vao icon de mo PC Dashboard."
    $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notifyIcon.ShowBalloonTip(3000)
} catch {}

# Instant Open Dashboard Function with Multi-Browser Support (Chrome, Edge, Brave, or System Default)
function Open-Dashboard {
    $targetUrl = if ($global:dashboardUrl) { $global:dashboardUrl } else { "http://localhost:$configPort/dashboard.html" }
    
    $progFiles = ${env:ProgramFiles}
    $progFilesX86 = ${env:ProgramFiles(x86)}
    $localApp = $env:LOCALAPPDATA

    $browserPaths = @(
        # 1. Google Chrome
        (Join-Path $progFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path $progFilesX86 "Google\Chrome\Application\chrome.exe"),
        (Join-Path $localApp "Google\Chrome\Application\chrome.exe"),
        # 2. Microsoft Edge
        (Join-Path $progFilesX86 "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $progFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path $localApp "Microsoft\Edge\Application\msedge.exe"),
        # 3. Brave Browser
        (Join-Path $progFiles "BraveSoftware\Brave-Browser\Application\brave.exe"),
        (Join-Path $localApp "BraveSoftware\Brave-Browser\Application\brave.exe")
    )

    $foundBrowser = $null
    foreach ($b in $browserPaths) {
        if ($b -and (Test-Path $b)) {
            $foundBrowser = $b
            break
        }
    }

    if ($foundBrowser) {
        try {
            Start-Process -FilePath $foundBrowser -ArgumentList "--app=`"$targetUrl`"" -ErrorAction Stop
        } catch {
            Start-Process "explorer.exe" -ArgumentList "`"$targetUrl`""
        }
    } else {
        # Open in Windows default browser (Firefox, Opera, Cốc Cốc, etc.)
        Start-Process "explorer.exe" -ArgumentList "`"$targetUrl`""
    }
}

# Double Click Handler: Instant Open
$notifyIcon.add_DoubleClick({
    Open-Dashboard
})

# Create Right-Click Context Menu
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
    Probe-Server-Info | Out-Null
    if ($global:lanUrl) {
        [System.Windows.Forms.Clipboard]::SetText($global:lanUrl)
        $notifyIcon.BalloonTipTitle = "Valorant Score Alert"
        $notifyIcon.BalloonTipText = "Da copy link LAN: $global:lanUrl"
        $notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notifyIcon.ShowBalloonTip(2000)
    } else {
        [System.Windows.Forms.Clipboard]::SetText("http://localhost:$configPort")
    }
})

$contextMenu.Items.Add("-") | Out-Null

# Option 3: Create Desktop Shortcut
$itemShortcut = $contextMenu.Items.Add("[3] Tao Shortcut Desktop")
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

    Get-Process -Name node, ValorantScoreAlert -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    [System.Windows.Forms.Application]::Exit()
    [System.Environment]::Exit(0)
})

$notifyIcon.ContextMenuStrip = $contextMenu

# Non-blocking Background Health Probe Timer (Checks every 6s without UI freeze)
$global:healthFailCount = 0
$healthTimer = New-Object System.Windows.Forms.Timer
$healthTimer.Interval = 6000
$healthTimer.add_Tick({
    $alive = Probe-Server-Info
    if ($alive) {
        $global:healthFailCount = 0
    } else {
        $global:healthFailCount++
        if ($global:healthFailCount -ge 4) {
            $global:healthFailCount = 0
            if (Test-Path "$rootDir\ValorantScoreAlert.exe") {
                Start-Process -FilePath "$rootDir\ValorantScoreAlert.exe" -WorkingDirectory $rootDir -WindowStyle Hidden
            } else {
                Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $rootDir -WindowStyle Hidden
            }
        }
    }
})
$healthTimer.Start()

# Keep Windows Forms Message Loop running
[System.Windows.Forms.Application]::Run()
