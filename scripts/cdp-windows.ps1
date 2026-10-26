# Drives the real Preview.exe on the Windows host through WebView2's DevTools protocol.
# Launches the exe with remote debugging on a loopback port, runs JavaScript steps in the app
# page (each may return a promise), prints one JSON line per step, optionally captures the page,
# then closes the app. Nothing is clicked or typed, so the user's desktop input is untouched.
#
# Usage:
#   powershell -File cdp-windows.ps1 -Exe C:\path\Preview.exe -Steps C:\path\steps.json
#     [-Pdf C:\path\doc.pdf] [-Port 9333] [-Shot C:\path\page.png] [-KeepOpen]
# steps.json: [ { "name": "label", "eval": "expression", "waitMs": 300 }, ... ]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Steps,
  [string]$Pdf = "",
  [int]$Port = 9333,
  [string]$Shot = "",
  [switch]$KeepOpen,
  # Separate WebView2 profile: a Preview window the user already has open keeps its own browser
  # process, and WebView2 refuses different launch arguments on a profile that is in use.
  [string]$DataDir = (Join-Path $env:TEMP 'pfw-cdp-profile')
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
$env:WEBVIEW2_USER_DATA_FOLDER = $DataDir
if ($Pdf -ne "") { $proc = Start-Process -FilePath $Exe -ArgumentList ('"' + $Pdf + '"') -PassThru }
else { $proc = Start-Process -FilePath $Exe -PassThru }

$page = $null
for ($i = 0; $i -lt 100 -and -not $page; $i++) {
  Start-Sleep -Milliseconds 150
  try {
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 1
    $page = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
  } catch { }
}
if (-not $page) { Write-Output '{"error":"no DevTools target"}'; Stop-Process -Id $proc.Id -Force; exit 1 }

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(30)
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
$script:id = 0

function Send-Cdp([string]$method, $params) {
  $script:id++
  $json = (@{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 20 -Compress)
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList (, $bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
  $buf = New-Object byte[] 1048576
  while ($true) {
    $ms = New-Object System.IO.MemoryStream
    do {
      $rseg = New-Object System.ArraySegment[byte] -ArgumentList (, $buf)
      $r = $ws.ReceiveAsync($rseg, [Threading.CancellationToken]::None).Result
      $ms.Write($buf, 0, $r.Count)
    } while (-not $r.EndOfMessage)
    $msg = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
    if ($msg.id -eq $script:id) { return $msg }
  }
}

# Wait until the app object exists.
for ($i = 0; $i -lt 100; $i++) {
  $ready = Send-Cdp 'Runtime.evaluate' @{ expression = '!!(window.__pfw && window.__pfw.app)'; returnByValue = $true }
  if ($ready.result.result.value -eq $true) { break }
  Start-Sleep -Milliseconds 100
}

$list = Get-Content -Raw -Encoding UTF8 -Path $Steps | ConvertFrom-Json
foreach ($step in $list) {
  $res = Send-Cdp 'Runtime.evaluate' @{ expression = $step.eval; awaitPromise = $true; returnByValue = $true }
  $out = @{ step = $step.name }
  if ($res.result.exceptionDetails) {
    $out.error = [string]($res.result.exceptionDetails.exception.description)
    if (-not $out.error) { $out.error = [string]$res.result.exceptionDetails.text }
  } else {
    $out.value = $res.result.result.value
  }
  Write-Output ($out | ConvertTo-Json -Depth 20 -Compress)
  if ($step.waitMs) { Start-Sleep -Milliseconds ([int]$step.waitMs) }
}

if ($Shot -ne "") {
  $cap = Send-Cdp 'Page.captureScreenshot' @{ format = 'png' }
  [IO.File]::WriteAllBytes($Shot, [Convert]::FromBase64String($cap.result.data))
  Write-Output ('{"shot":"' + ($Shot -replace '\\', '\\') + '"}')
}

$ws.Dispose()
if (-not $KeepOpen) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
