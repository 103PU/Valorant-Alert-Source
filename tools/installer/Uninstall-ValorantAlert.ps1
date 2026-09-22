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

function Stop-RunningInstance {
    param([Parameter(Mandatory = $true)][string] $TargetDir)

    $currentPid = $PID
    $pidsToKill = New-Object 'System.Collections.Generic.HashSet[int]'
    $normTarget = [System.IO.Path]::GetFullPath($TargetDir).TrimEnd('\', '/')

    foreach ($proc in @(Get-Process -Name 'ValorantScoreAlert' -ErrorAction SilentlyContinue)) {
        if ($proc.Id -ne $currentPid) {
            try { $null = $proc.CloseMainWindow() } catch { }
            [void]$pidsToKill.Add($proc.Id)
        }
    }

    $allProcs = @(try { Get-CimInstance Win32_Process -ErrorAction SilentlyContinue } catch { Get-WmiObject Win32_Process -ErrorAction SilentlyContinue })
    foreach ($proc in $allProcs) {
        $procId = [int]$proc.ProcessId
        if ($procId -le 4 -or $procId -eq $currentPid) { continue }

        $cmd = if ($proc.CommandLine) { $proc.CommandLine } else { '' }
        $exe = if ($proc.ExecutablePath) { $proc.ExecutablePath } else { '' }
        $name = if ($proc.Name) { $proc.Name.ToLowerInvariant() } else { '' }

        $shouldKill = $false

        if ($exe -and $exe.StartsWith($normTarget, [System.StringComparison]::OrdinalIgnoreCase)) {
            $shouldKill = $true
        } elseif (($name -eq 'powershell.exe' -or $name -eq 'pwsh.exe') -and $cmd -like '*tray.ps1*') {
            $shouldKill = $true
        } elseif (($name -eq 'wscript.exe' -or $name -eq 'cscript.exe') -and $cmd -like '*launcher.vbs*') {
            $shouldKill = $true
        } elseif ($name -eq 'node.exe' -and ($cmd -like '*ValorantScoreAlert*' -or $cmd -like '*server/index.js*' -or $cmd -like '*server\index.js*' -or ($cmd -like ('*' + $normTarget + '*')))) {
            $shouldKill = $true
        } elseif ($cmd -like '*ValorantScoreAlert*' -and $cmd -notlike '*Install-ValorantAlert*' -and $cmd -notlike '*Uninstall-ValorantAlert*') {
            $shouldKill = $true
        }

        if ($shouldKill) {
            [void]$pidsToKill.Add($procId)
        }
    }

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
        foreach ($pidToKill in $pidsToKill) {
            try {
                if (Get-Process -Id $pidToKill -ErrorAction SilentlyContinue) {
                    Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
                }
            } catch { }
        }
        Start-Sleep -Milliseconds 400
        Write-Host "  Đã dừng $stoppedCount tiến trình đang chạy."
    }
}

if (-not (Test-Path -LiteralPath $installDirFullPath -PathType Container)) {
    Write-Host "Không có gì để gỡ ở: $installDirFullPath" -ForegroundColor Yellow
} elseif (-not $looksLikeOurs) {
    throw "'$installDirFullPath' không giống thư mục cài của Valorant Score Alert (không thấy ValorantScoreAlert.exe hay install-info.txt). Dừng để tránh xoá sai."
} else {
    Stop-RunningInstance -TargetDir $installDirFullPath

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
