# Installer for Valorant Score Alert (portable payload + this script).
#
# PowerShell, not a compiled setup.exe — the same shape ValorantTweaks ships
# (tools/installer/Install-ValorantTweaks.App.ps1). Reasons it stays a script:
#   * Per-user install to %LOCALAPPDATA%\Programs, so no UAC prompt and no
#     admin rights. A machine-wide installer would need elevation for a tool that
#     only ever runs as the logged-in user.
#   * Zero new build dependencies. Windows PowerShell 5.1 is already present on
#     every supported target, so nothing has to be installed to produce or run it.
#   * The payload is a self-contained folder. There is no registry state, no
#     service, and no shared runtime to reference-count, so an installer's real
#     job here is: copy, stop the old instance, make shortcuts.
#
# Refuses rather than guesses: an unsafe target, a missing payload, or a running
# instance it cannot stop all stop the install with a message instead of leaving a
# half-copied folder behind.

[CmdletBinding()]
param(
    [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\ValorantAlert'),
    [switch] $NoDesktopShortcut,
    [switch] $NoStartMenuShortcut,
    [switch] $Launch
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This file is UTF-8 WITH a BOM, and it has to stay that way: Windows PowerShell 5.1
# assumes the ANSI code page for a .ps1 with no BOM, which turns every Vietnamese
# string below into mojibake and — because one of them lands on a quote character —
# stops the file parsing at all. The BOM is asserted by test/release-artifacts.test.js.
#
# Parsing right is only half of it: a console left on code page 437/850 prints those
# same strings as '?'. Purely cosmetic, so a host that refuses the assignment must not
# take the install down with it.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$AppDisplayName = 'Valorant Score Alert'
$ShortcutFileName = 'Valorant Score Alert.lnk'

function Write-Step {
    param([string] $Message)
    Write-Host "  $Message"
}

# The shortcut must launch scripts\launcher.vbs through wscript, NOT the exe.
# launcher.vbs does four things the exe alone does not: frees port 3000 from a
# stale instance, keeps the desktop shortcut current, starts the server hidden,
# and starts scripts\tray.ps1. A shortcut pointing straight at
# ValorantScoreAlert.exe therefore produces an app with no tray icon — running,
# but with no way to reach it.
function New-AppShortcut {
    param(
        [Parameter(Mandatory = $true)][string] $ShortcutPath,
        [Parameter(Mandatory = $true)][string] $TargetDir
    )

    $shell = New-Object -ComObject WScript.Shell
    try {
        $link = $shell.CreateShortcut($ShortcutPath)
        $link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
        $link.Arguments = '//nologo "{0}"' -f (Join-Path $TargetDir 'scripts\launcher.vbs')
        $link.WorkingDirectory = $TargetDir
        # 7 = minimized. launcher.vbs starts everything hidden, so a normal window
        # would flash an empty console on every launch.
        $link.WindowStyle = 7
        $link.IconLocation = '{0},0' -f (Join-Path $TargetDir 'assets\icon.ico')
        $link.Description = 'Valorant Realtime Score Alert'
        $link.Save()
    } finally {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
    }
}

# Stops what is holding the install directory's files open. Two processes, found
# by identity rather than by name alone: the server exe, and the tray script
# hosted inside a powershell.exe. Matching "powershell" by name would kill the
# user's own shells, so the tray is located by its command line instead.
function Stop-RunningInstance {
    param([Parameter(Mandatory = $true)][string] $TargetDir)

    $stopped = 0
    foreach ($proc in @(Get-Process -Name 'ValorantScoreAlert' -ErrorAction SilentlyContinue)) {
        try { $null = $proc.CloseMainWindow() } catch { }
        $stopped++
    }

    $trayPattern = '*tray.ps1*'
    foreach ($row in @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue)) {
        if ($row.CommandLine -and $row.CommandLine -like $trayPattern) {
            try { Stop-Process -Id $row.ProcessId -Force -ErrorAction Stop; $stopped++ } catch { }
        }
    }

    if ($stopped -gt 0) {
        Start-Sleep -Milliseconds 1200
        foreach ($proc in @(Get-Process -Name 'ValorantScoreAlert' -ErrorAction SilentlyContinue)) {
            try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { }
        }
        Write-Step "Đã dừng $stopped tiến trình đang chạy."
    }
}

Write-Host ''
Write-Host "=== Cài đặt $AppDisplayName ===" -ForegroundColor Cyan
Write-Host ''

# --- 1. locate and validate the payload --------------------------------------

$sourceDir = Join-Path $PSScriptRoot 'app'
if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
    throw "Không tìm thấy thư mục 'app' cạnh script này. Hãy giải nén TOÀN BỘ file zip rồi chạy lại — chạy trực tiếp trong zip sẽ không thấy payload."
}

# Two files, not one: the exe is the server and launcher.vbs is what the shortcut
# actually invokes. A payload missing either one installs and then fails at first
# launch, which is a much worse failure than refusing here. The same list is checked
# again after the copy, before anything irreversible happens.
$RequiredPayloadFiles = @('ValorantScoreAlert.exe', 'scripts\launcher.vbs')

foreach ($required in $RequiredPayloadFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDir $required) -PathType Leaf)) {
        throw "Payload thiếu '$required'. File zip có thể tải chưa xong hoặc giải nén thiếu."
    }
}

$sourceFullPath = (Resolve-Path -LiteralPath $sourceDir).ProviderPath

# --- 2. validate the target ---------------------------------------------------

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    throw '-InstallDir rỗng.'
}

$installDirFullPath = [System.IO.Path]::GetFullPath($InstallDir.TrimEnd('\', '/'))

# A drive root would make uninstall delete the whole drive.
if ($installDirFullPath -match '^[A-Za-z]:\\?$') {
    throw "Không cài vào gốc ổ đĩa ('$installDirFullPath'). Chọn một thư mục con."
}

# Installing into the extracted folder makes the source and the destination the
# same tree: the staged copy would recurse and the cleanup would delete the payload.
$comparableSource = $sourceFullPath.TrimEnd('\')
$comparableTarget = $installDirFullPath.TrimEnd('\')
if ($comparableTarget -eq $comparableSource -or
    $comparableTarget.StartsWith($comparableSource + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Không cài vào bên trong thư mục vừa giải nén ('$comparableSource'). Chọn thư mục khác."
}

Write-Step "Nguồn : $sourceFullPath"
Write-Step "Đích  : $installDirFullPath"

# --- 3. clear Mark-of-the-Web -------------------------------------------------

# Windows tags every file inside a zip downloaded from the internet. Left in
# place, wscript and powershell refuse or warn on launcher.vbs and tray.ps1, so
# the app appears to do nothing when the shortcut is clicked. Unblocking the
# payload before it is copied means the installed tree is clean.
Write-Step 'Xoá cờ Mark-of-the-Web trên payload...'
Get-ChildItem -LiteralPath $sourceFullPath -Recurse -File -ErrorAction SilentlyContinue |
    Unblock-File -ErrorAction SilentlyContinue

# --- 4. stop the old instance -------------------------------------------------

Stop-RunningInstance -TargetDir $installDirFullPath

# --- 5. staged copy, then one atomic move -------------------------------------

# Copy into a sibling temp folder first and Move-Item it into place. Copying
# straight over a live install leaves a mix of old and new files if anything fails
# halfway; a move is close enough to atomic on one volume that the app is either
# fully old or fully new.
$installParent = Split-Path -Parent $installDirFullPath
if (-not (Test-Path -LiteralPath $installParent -PathType Container)) {
    New-Item -ItemType Directory -Path $installParent -Force | Out-Null
}

$stagingDir = Join-Path $installParent (".ValorantAlert.installing-" + [Guid]::NewGuid().ToString('N'))

try {
    Write-Step 'Sao chép file...'
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

    # Copy the payload's children, enumerated literally. Both wildcard spellings of
    # this look correct and both copy NOTHING without raising an error:
    #   Copy-Item -LiteralPath "$src\*"  — '*' is a literal file name, matches nothing
    #   Copy-Item -Path        "$src\*"  — globs, but a browser-produced folder such as
    #                                      'Valorant-Alert [1]\app' turns '[1]' into a
    #                                      character class that matches nothing either
    # Both were reproduced before this line was written. Enumerating the children keeps
    # literal semantics for the parent path and still copies the contents rather than
    # the folder itself.
    $payloadItems = @(Get-ChildItem -LiteralPath $sourceFullPath -Force)
    if ($payloadItems.Count -eq 0) {
        throw "Thư mục payload '$sourceFullPath' rỗng — giải nén lại file zip."
    }
    Copy-Item -LiteralPath $payloadItems.FullName -Destination $stagingDir -Recurse -Force

    # Re-check the staged tree before the point of no return. The copy is the step that
    # can fail quietly; everything below deletes the working install the user already
    # has, so it must not run on the strength of "Copy-Item did not complain".
    foreach ($required in $RequiredPayloadFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $stagingDir $required) -PathType Leaf)) {
            throw "Bản sao tạm thiếu '$required'. Huỷ cài đặt — bản đang dùng chưa bị xoá."
        }
    }

    if (Test-Path -LiteralPath $installDirFullPath) {
        Write-Step 'Xoá bản cũ...'
        Remove-Item -LiteralPath $installDirFullPath -Recurse -Force
    }

    Move-Item -LiteralPath $stagingDir -Destination $installDirFullPath -Force
} catch {
    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
}

# --- 6. shortcuts -------------------------------------------------------------

if (-not $NoDesktopShortcut) {
    # Same name and same target as Create-Desktop-Shortcut.vbs in the payload, so
    # launcher.vbs sees the shortcut it expects and does not create a second one.
    $desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) $ShortcutFileName
    New-AppShortcut -ShortcutPath $desktopLink -TargetDir $installDirFullPath
    Write-Step "Shortcut Desktop : $desktopLink"
}

if (-not $NoStartMenuShortcut) {
    $startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Valorant Score Alert'
    if (-not (Test-Path -LiteralPath $startMenuDir -PathType Container)) {
        New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
    }
    $startLink = Join-Path $startMenuDir $ShortcutFileName
    New-AppShortcut -ShortcutPath $startLink -TargetDir $installDirFullPath
    Write-Step "Shortcut Start Menu : $startLink"
}

# --- 7. record what was installed --------------------------------------------

# Plain text on purpose: the uninstaller reads nothing from it, so there is no
# registry key or state file to go stale. It exists for a human diagnosing
# "which build is this and where did it come from".
$installInfo = @(
    "AppName      = $AppDisplayName",
    "InstalledAt  = $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "InstallDir   = $installDirFullPath",
    "SourceDir    = $sourceFullPath"
) -join [Environment]::NewLine

Set-Content -LiteralPath (Join-Path $installDirFullPath 'install-info.txt') -Value $installInfo -Encoding UTF8

Write-Host ''
Write-Host "Cài đặt xong: $installDirFullPath" -ForegroundColor Green
# Stated explicitly because it is the one thing an uninstall does NOT remove, and
# it is why reinstalling does not ask the user to log in again.
Write-Host "Dữ liệu người dùng (đăng nhập, license, device id) nằm ở: $(Join-Path $env:APPDATA 'ValorantAlert')" -ForegroundColor DarkGray
Write-Host ''

if ($Launch) {
    Write-Step 'Đang khởi động...'
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') `
        -ArgumentList @('//nologo', (Join-Path $installDirFullPath 'scripts\launcher.vbs')) `
        -WorkingDirectory $installDirFullPath
}
