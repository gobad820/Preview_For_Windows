# Launches an exe on the Windows host, screenshots its main window after a delay, then stops it.
# Usage: powershell -File smoke-windows.ps1 -Exe C:\path\Preview.exe [-Pdf C:\path\doc.pdf] [-WaitMs 3000] [-Out C:\path\shot.png]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Pdf = "",
  [int]$WaitMs = 3000,
  [string]$Out = "C:\Users\Public\pfw-smoke\shot.png",
  [string]$Frames = "",  # optional comma-separated extra capture times in ms, e.g. "700,1500"
  [switch]$Focus         # bring the window to the foreground before the final capture (steals focus!)
)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PfwNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
"@
[PfwNative]::SetProcessDPIAware() | Out-Null

function Capture-Window($proc, $path) {
  $hwnd = [IntPtr]::Zero
  try { $proc.Refresh(); $hwnd = $proc.MainWindowHandle } catch {}
  $r = New-Object PfwNative+RECT
  $ok = $false
  if ($hwnd -ne [IntPtr]::Zero) { $ok = [PfwNative]::GetWindowRect($hwnd, [ref]$r) }
  if (-not $ok -or ($r.Right - $r.Left) -le 0) {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $r.Left = $b.Left; $r.Top = $b.Top; $r.Right = $b.Right; $r.Bottom = $b.Bottom
  }
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $printed = $false
  if ($hwnd -ne [IntPtr]::Zero) {
    # PW_RENDERFULLCONTENT (2) renders the window's own surface even when other windows cover it,
    # so the capture never includes anything else on the desktop.
    $hdc = $g.GetHdc()
    try { $printed = [PfwNative]::PrintWindow($hwnd, $hdc, 2) } finally { $g.ReleaseHdc($hdc) }
  }
  if (-not $printed) {
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
  }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return "{0}x{1}{2}" -f $w, $h, $(if ($printed) { "" } else { " (screen copy)" })
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
if ($Pdf -ne "") { $p = Start-Process -FilePath $Exe -ArgumentList ('"' + $Pdf + '"') -PassThru }
else { $p = Start-Process -FilePath $Exe -PassThru }

$frameTimes = @()
if ($Frames -ne "") { $frameTimes = $Frames.Split(",") | ForEach-Object { [int]$_ } }
$i = 0
foreach ($t in $frameTimes) {
  $delay = $t - $sw.ElapsedMilliseconds
  if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
  $i++
  $framePath = [System.IO.Path]::ChangeExtension($Out, $null).TrimEnd('.') + "-" + $i + ".png"
  $size = Capture-Window $p $framePath
  Write-Output ("frame {0} at {1}ms -> {2} ({3})" -f $i, $sw.ElapsedMilliseconds, $framePath, $size)
}
$delay = $WaitMs - $sw.ElapsedMilliseconds
if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }

$alive = -not $p.HasExited
$title = ""; $hwnd = [IntPtr]::Zero
try { $p.Refresh(); $title = $p.MainWindowTitle; $hwnd = $p.MainWindowHandle } catch {}
if ($Focus -and $hwnd -ne [IntPtr]::Zero) { [PfwNative]::SetForegroundWindow($hwnd) | Out-Null; Start-Sleep -Milliseconds 400 }
$size = Capture-Window $p $Out
$w = $size.Split("x")[0]; $h = $size.Split("x")[1]

if ($alive) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Write-Output ("alive={0} title={1} window={2}x{3} elapsedMs={4}" -f $alive, $title, $w, $h, $sw.ElapsedMilliseconds)
