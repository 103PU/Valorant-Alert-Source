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

# Stops what is holding the install directory's files open.
# Checks:
#   1. ValorantScoreAlert named processes
#   2. Tray script (powershell with *tray.ps1*)
#   3. Launcher script (wscript/cscript with *launcher.vbs*)
#   4. Node server or caxa unpacker runtime (*server/index.js*, *ValorantScoreAlert*)
#   5. Any process executing from $TargetDir or locking files within it
#   6. Process holding the server port (default 3000 or from config.json)
function Stop-RunningInstance {
    param([Parameter(Mandatory = $true)][string] $TargetDir)

    $currentPid = $PID
    $pidsToKill = New-Object 'System.Collections.Generic.HashSet[int]'
    $normTarget = [System.IO.Path]::GetFullPath($TargetDir).TrimEnd('\', '/')

    # 1. Directly find ValorantScoreAlert named processes
    foreach ($proc in @(Get-Process -Name 'ValorantScoreAlert' -ErrorAction SilentlyContinue)) {
        if ($proc.Id -ne $currentPid) {
            try { $null = $proc.CloseMainWindow() } catch { }
            [void]$pidsToKill.Add($proc.Id)
        }
    }

    # 2. Inspect running processes for app identity, target directory, or helper scripts
    $allProcs = @(try { Get-CimInstance Win32_Process -ErrorAction SilentlyContinue } catch { Get-WmiObject Win32_Process -ErrorAction SilentlyContinue })
    foreach ($proc in $allProcs) {
        $procId = [int]$proc.ProcessId
        if ($procId -le 4 -or $procId -eq $currentPid) { continue }

        $cmd = if ($proc.CommandLine) { $proc.CommandLine } else { '' }
        $exe = if ($proc.ExecutablePath) { $proc.ExecutablePath } else { '' }
        $name = if ($proc.Name) { $proc.Name.ToLowerInvariant() } else { '' }

        $shouldKill = $false

        # Any process running from inside the install directory
        if ($exe -and $exe.StartsWith($normTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
            $shouldKill = $true
        }
        # Tray script hosted in powershell/pwsh
        elseif (($name -eq 'powershell.exe' -or $name -eq 'pwsh.exe') -and $cmd -like '*tray.ps1*') {
            $shouldKill = $true
        }
        # Launcher script hosted in wscript/cscript
        elseif (($name -eq 'wscript.exe' -or $name -eq 'cscript.exe') -and $cmd -like '*launcher.vbs*') {
            $shouldKill = $true
        }
        # Node server or caxa runtime for ValorantScoreAlert
        elseif ($name -eq 'node.exe' -and ($cmd -like '*ValorantScoreAlert*' -or $cmd -like '*server/index.js*' -or $cmd -like '*server\index.js*' -or ($cmd -like ('*' + $normTarget + '*')))) {
            $shouldKill = $true
        }
        # Any other process referencing ValorantScoreAlert (excluding current installer script)
        elseif ($cmd -like '*ValorantScoreAlert*' -and $cmd -notlike '*Install-ValorantAlert*' -and $cmd -notlike '*Uninstall-ValorantAlert*') {
            $shouldKill = $true
        }

        if ($shouldKill) {
            [void]$pidsToKill.Add($procId)
        }
    }

    # 3. Clean up process holding the server port (default 3000 or config.json)
    $portsToCheck = @(3000)
    $configPath = Join-Path $TargetDir 'config.json'
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        try {
            $rawCfg = Get-Content -LiteralPath $configPath -Raw -ErrorAction SilentlyContinue
            if ($rawCfg) {
                $parsed = $rawCfg | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($parsed -and $parsed.port) {
                    $p = [int]$parsed.port
                    if ($p -gt 0 -and -not ($portsToCheck -contains $p)) {
                        $portsToCheck += $p
                    }
                }
            }
        } catch { }
    }

    foreach ($port in $portsToCheck) {
        $foundOnPort = $false
        try {
            $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
            foreach ($conn in $conns) {
                $owPid = [int]$conn.OwningProcess
                if ($owPid -gt 4 -and $owPid -ne $currentPid) {
                    $listenerProc = $allProcs | Where-Object { [int]$_.ProcessId -eq $owPid } | Select-Object -First 1
                    if ($listenerProc) {
                        $lName = if ($listenerProc.Name) { $listenerProc.Name.ToLowerInvariant() } else { '' }
                        $lCmd = if ($listenerProc.CommandLine) { $listenerProc.CommandLine } else { '' }
                        if ($lName -eq 'node.exe' -or $lCmd -like '*Valorant*' -or $lCmd -like '*server*') {
                            [void]$pidsToKill.Add($owPid)
                            $foundOnPort = $true
                        }
                    } else {
                        [void]$pidsToKill.Add($owPid)
                        $foundOnPort = $true
                    }
                }
            }
        } catch { }

        if (-not $foundOnPort) {
            try {
                $lines = @(netstat -ano 2>$null | Select-String ":$port\s+.*LISTENING\s+(\d+)")
                foreach ($line in $lines) {
                    if ($line.Matches -and $line.Matches[0].Groups[1].Value) {
                        $owPid = [int]$line.Matches[0].Groups[1].Value
                        if ($owPid -gt 4 -and $owPid -ne $currentPid) {
                            $listenerProc = $allProcs | Where-Object { [int]$_.ProcessId -eq $owPid } | Select-Object -First 1
                            if ($listenerProc) {
                                $lName = if ($listenerProc.Name) { $listenerProc.Name.ToLowerInvariant() } else { '' }
                                $lCmd = if ($listenerProc.CommandLine) { $listenerProc.CommandLine } else { '' }
                                if ($lName -eq 'node.exe' -or $lCmd -like '*Valorant*' -or $lCmd -like '*server*') {
                                    [void]$pidsToKill.Add($owPid)
                                }
                            } else {
                                [void]$pidsToKill.Add($owPid)
                            }
                        }
                    }
                }
            } catch { }
        }
    }

    $stoppedCount = 0
    if ($pidsToKill.Count -gt 0) {
        foreach ($pidToKill in $pidsToKill) {
            try {
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
                $stoppedCount++
            } catch { }
        }
        Start-Sleep -Milliseconds 800
        # Second pass to ensure everything has exited
        foreach ($pidToKill in $pidsToKill) {
            try {
                if (Get-Process -Id $pidToKill -ErrorAction SilentlyContinue) {
                    Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
                }
            } catch { }
        }
        Start-Sleep -Milliseconds 400
        Write-Step "Đã dừng $stoppedCount tiến trình đang chạy."
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
        $removeSuccess = $false
        $removeAttempts = 0
        $maxRemoveAttempts = 5
        while (-not $removeSuccess) {
            $removeAttempts++
            try {
                Remove-Item -LiteralPath $installDirFullPath -Recurse -Force
                $removeSuccess = $true
            } catch {
                if ($removeAttempts -ge $maxRemoveAttempts) {
                    throw
                }
                Stop-RunningInstance -TargetDir $installDirFullPath
                Start-Sleep -Milliseconds (500 * $removeAttempts)
            }
        }
    }

    $moveSuccess = $false
    $moveAttempts = 0
    while (-not $moveSuccess) {
        $moveAttempts++
        try {
            Move-Item -LiteralPath $stagingDir -Destination $installDirFullPath -Force
            $moveSuccess = $true
        } catch {
            if ($moveAttempts -ge 5) {
                throw
            }
            Start-Sleep -Milliseconds (400 * $moveAttempts)
        }
    }
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
