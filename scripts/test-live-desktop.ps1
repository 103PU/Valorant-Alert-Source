$ErrorActionPreference = 'Continue'

Write-Host "=== 1. LAUNCHING DASHBOARD WINDOW ==="
$cmd = '"C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\Users\Administrator\.chrome-dashboard" --app=http://localhost:3000/dashboard.html?token=A966B0'
$chromePid = & "E:\PROJECT\Valorant-Alert-Source\scripts\launch-app.ps1" -CommandLine $cmd
Write-Host "Launched Chrome PID: $chromePid"

Start-Sleep -Seconds 3

Write-Host "=== 2. LIST WINDOWS AND GET CHROME WINDOW ID ==="
$listOutput = & "E:\PROJECT\Valorant-Alert-Source\scripts\run-agent-desktop.ps1" list-windows
Write-Host $listOutput
$json = $listOutput | ConvertFrom-Json
$chromeWin = $json.data | Where-Object { $_.app_name -eq 'chrome.exe' }
$winId = $chromeWin.id
Write-Host "Target Chrome Window ID: $winId"

Write-Host "=== 3. CAPTURE ACCESSIBILITY SNAPSHOT OF CHROME ==="
$snapOutput = & "E:\PROJECT\Valorant-Alert-Source\scripts\run-agent-desktop.ps1" snapshot --app chrome.exe -i --compact
Write-Host "Snapshot length: $($snapOutput.Length)"
$snapPath = "C:\Users\Administrator\.gemini\antigravity-cli\brain\93fcb17d-e7f8-4507-8217-63018d0f405e\dashboard_snapshot.json"
$snapOutput | Out-File -FilePath $snapPath -Encoding utf8

Write-Host "=== 4. CAPTURE CHROME WINDOW SCREENSHOT ==="
$shot1 = "C:\Users\Administrator\.gemini\antigravity-cli\brain\93fcb17d-e7f8-4507-8217-63018d0f405e\dashboard_chrome_window.png"
if ($winId) {
    $res1 = & "E:\PROJECT\Valorant-Alert-Source\scripts\run-agent-desktop.ps1" screenshot --window-id $winId $shot1
    Write-Host "Window screenshot result: $res1"
}

Write-Host "=== 5. SIMULATE SCORE 5 - 3 (ROUND CHANGE) ==="
$body1 = @{
    alliedScore = 5
    enemyScore = 3
    inGame = $true
    status = "IN_MATCH"
    mapName = "Bind"
} | ConvertTo-Json
$resSim1 = Invoke-RestMethod -Uri "http://localhost:3000/api/simulator" -Method Post -Body $body1 -ContentType "application/json"
Write-Host "Sim 1 Result: $(ConvertTo-Json $resSim1 -Compress)"

Start-Sleep -Seconds 2

Write-Host "=== 6. SIMULATE MATCH POINT 12 - 11 ==="
$body2 = @{
    alliedScore = 12
    enemyScore = 11
    inGame = $true
    status = "MATCH_POINT"
    mapName = "Bind"
} | ConvertTo-Json
$resSim2 = Invoke-RestMethod -Uri "http://localhost:3000/api/simulator" -Method Post -Body $body2 -ContentType "application/json"
Write-Host "Sim 2 Result: $(ConvertTo-Json $resSim2 -Compress)"

Start-Sleep -Seconds 2

Write-Host "=== 7. VERIFY SETTINGS ON SERVER ==="
$settings = Invoke-RestMethod -Uri "http://localhost:3000/api/settings" -Method Get
Write-Host "Settings: $(ConvertTo-Json $settings -Compress)"

Write-Host "=== 8. CAPTURE MATCH POINT SCREENSHOT ==="
if ($winId) {
    $shot2 = "C:\Users\Administrator\.gemini\antigravity-cli\brain\93fcb17d-e7f8-4507-8217-63018d0f405e\dashboard_chrome_matchpoint.png"
    $res2 = & "E:\PROJECT\Valorant-Alert-Source\scripts\run-agent-desktop.ps1" screenshot --window-id $winId $shot2
    Write-Host "Window matchpoint screenshot result: $res2"
}

Write-Host "=== TEST SEQUENCE COMPLETED ==="
