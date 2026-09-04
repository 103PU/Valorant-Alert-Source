# Uninstaller for Valorant Score Alert.
#
# Removes the program and its shortcuts. Does NOT remove user data unless asked:
# %APPDATA%\ValorantAlert holds the KLD session, the license entitlement and the
# device id. Deleting it turns a reinstall into "log in again, activate again, burn
# another device slot", which is a worse default than leaving a few KB behind.
# -PurgeUserData is there for the user who genuinely wants a clean slate.

[CmdletBinding()]
param(
    [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\ValorantAlert'),
    [switch] $PurgeUserData
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# UTF-8 WITH a BOM, for the reason spelled out in Install-ValorantAlert.ps1: without it
# Windows PowerShell 5.1 reads this file as ANSI and the Vietnamese below stops it
# parsing. Console encoding is cosmetic, so it must never abort an uninstall.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$ShortcutFileName = 'Valorant Score Alert.lnk'

Write-Host ''
Write-Host '=== Gỡ Valorant Score Alert ===' -ForegroundColor Cyan
Write-Host ''

if ([string]::IsNullOrWhiteSpace($InstallDir)) { throw '-InstallDir rỗng.' }
$installDirFullPath = [System.IO.Path]::GetFullPath($InstallDir.TrimEnd('\', '/'))

# Same guard as the installer, for the same reason but with worse consequences:
# here the path is what gets deleted recursively.
if ($installDirFullPath -match '^[A-Za-z]:\\?$') {
    throw "Từ chối xoá gốc ổ đĩa ('$installDirFullPath')."
}

# Refuse to delete a directory that is not ours. install-info.txt is written by the
# installer, so its absence means this path was never an install target — deleting
# it would be deleting whatever the user happened to point at.
$marker = Join-Path $installDirFullPath 'install-info.txt'
$looksLikeOurs = (Test-Path -LiteralPath (Join-Path $installDirFullPath 'ValorantScoreAlert.exe') -PathType Leaf) -or
                 (Test-Path -LiteralPath $marker -PathType Leaf)

if (-not (Test-Path -LiteralPath $installDirFullPath -PathType Container)) {
    Write-Host "Không có gì để gỡ ở: $installDirFullPath" -ForegroundColor Yellow
} elseif (-not $looksLikeOurs) {
    throw "'$installDirFullPath' không giống thư mục cài của Valorant Score Alert (không thấy ValorantScoreAlert.exe hay install-info.txt). Dừng để tránh xoá sai."
} else {
    foreach ($proc in @(Get-Process -Name 'ValorantScoreAlert' -ErrorAction SilentlyContinue)) {
        try { $null = $proc.CloseMainWindow() } catch { }
    }
    foreach ($row in @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue)) {
        if ($row.CommandLine -and $row.CommandLine -like '*tray.ps1*') {
            try { Stop-Process -Id $row.ProcessId -Force -ErrorAction Stop } catch { }
        }
    }
    Start-Sleep -Milliseconds 1200
    foreach ($proc in @(Get-Process -Name 'ValorantScoreAlert' -ErrorAction SilentlyContinue)) {
        try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { }
    }

    Remove-Item -LiteralPath $installDirFullPath -Recurse -Force
    Write-Host "Đã xoá: $installDirFullPath" -ForegroundColor Green
}

# Shortcuts are removed by path, and only the ones this installer creates.
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) $ShortcutFileName
if (Test-Path -LiteralPath $desktopLink -PathType Leaf) {
    Remove-Item -LiteralPath $desktopLink -Force -ErrorAction SilentlyContinue
    Write-Host "Đã xoá shortcut Desktop." -ForegroundColor Green
}

$startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Valorant Score Alert'
if (Test-Path -LiteralPath $startMenuDir -PathType Container) {
    Remove-Item -LiteralPath $startMenuDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Đã xoá shortcut Start Menu." -ForegroundColor Green
}

$userDataDir = Join-Path $env:APPDATA 'ValorantAlert'
if ($PurgeUserData) {
    if (Test-Path -LiteralPath $userDataDir -PathType Container) {
        Remove-Item -LiteralPath $userDataDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Đã xoá dữ liệu người dùng: $userDataDir" -ForegroundColor Green
    }
} elseif (Test-Path -LiteralPath $userDataDir -PathType Container) {
    Write-Host ''
    Write-Host "Giữ lại dữ liệu người dùng: $userDataDir" -ForegroundColor DarkGray
    Write-Host "Muốn xoá luôn thì chạy lại với -PurgeUserData." -ForegroundColor DarkGray
}

Write-Host ''
