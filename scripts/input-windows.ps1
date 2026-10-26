# Real mouse and keyboard input against a Preview window, for checks that only native input can
# exercise (OLE file drops, title-bar dragging, edge resizing, snapping). Every action first checks
# that the window under the cursor belongs to the expected process and backs out otherwise, and the
# cursor is put back where it was.
#
#   input-windows.ps1 -Action drop -Pid <id> -X <screen x> -Y <screen y> -File <path>
#   input-windows.ps1 -Action drag -Pid <id> -X <x> -Y <y> -DX <dx> -DY <dy>
#   input-windows.ps1 -Action dblclick -Pid <id> -X <x> -Y <y>
#   input-windows.ps1 -Action keys -Pid <id> -Keys 'win+left'
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [int]$X = 0, [int]$Y = 0, [int]$DX = 0, [int]$DY = 0,
  [string]$File = '', [string]$Keys = ''
)
$ErrorActionPreference = 'Stop'
if (-not ('PfwInput' -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class PfwInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  static int vx, vy, vw, vh;
  static void Init() { vx = GetSystemMetrics(76); vy = GetSystemMetrics(77); vw = GetSystemMetrics(78); vh = GetSystemMetrics(79); }
  static void Mouse(uint flags, int x, int y) {
    Init();
    var i = new INPUT { type = 0 };
    i.u.mi.dx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1));
    i.u.mi.dy = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    i.u.mi.dwFlags = flags | 0x8000 | 0x4000; // ABSOLUTE | VIRTUALDESK
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void MoveTo(int x, int y) { Mouse(0x0001, x, y); }
  public static void Down(int x, int y) { Mouse(0x0001 | 0x0002, x, y); }
  public static void Up(int x, int y) { Mouse(0x0001 | 0x0004, x, y); }
  public static void Glide(int x0, int y0, int x1, int y1, int steps, int ms) {
    for (int s = 1; s <= steps; s++) { MoveTo(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps); Thread.Sleep(ms); }
  }
  public static void Key(ushort vk, bool up) {
    var i = new INPUT { type = 1 };
    i.u.ki.wVk = vk; i.u.ki.dwFlags = up ? 2u : 0u;
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static bool Dropped;
  static Thread driver;
  /// Presses on the drag source, glides to (x, y) and releases there only if the window under
  /// the cursor belongs to targetPid; otherwise cancels the drag with Esc.
  public static void StartDrop(int sx, int sy, int x, int y, uint targetPid) {
    driver = new Thread(() => {
      Thread.Sleep(700);
      MoveTo(sx, sy); Thread.Sleep(120);
      Down(sx, sy); Thread.Sleep(120);
      Glide(sx, sy, sx + 24, sy, 6, 20);
      Glide(sx + 24, sy, x, y, 24, 25);
      Thread.Sleep(600);
      if (OwnerAt(x, y) == targetPid) { Dropped = true; Up(x, y); }
      else { Dropped = false; Key(0x1B, false); Key(0x1B, true); Up(x, y); }
    });
    driver.IsBackground = true;
    driver.Start();
  }
  public static void JoinDrop() { if (driver != null) driver.Join(5000); }
  public static uint OwnerAt(int x, int y) {
    var p = new POINT { X = x, Y = y };
    var root = GetAncestor(WindowFromPoint(p), 2);
    uint pid; GetWindowThreadProcessId(root, out pid); return pid;
  }
}
"@
}
[PfwInput]::SetProcessDPIAware() | Out-Null
$start = New-Object PfwInput+POINT
[PfwInput]::GetCursorPos([ref]$start) | Out-Null
$result = ''
try {
  switch ($Action) {
    'drop' {
      # A small topmost window is the drag source; a timer on it drives the cursor.
      Add-Type -AssemblyName System.Windows.Forms
      $form = New-Object System.Windows.Forms.Form
      $form.TopMost = $true; $form.FormBorderStyle = 'None'; $form.ShowInTaskbar = $false
      $form.StartPosition = 'Manual'; $form.Size = New-Object Drawing.Size(80, 80)
      $form.Location = New-Object Drawing.Point(([Math]::Max(0, $X - 360)), $Y - 40)
      $form.BackColor = [Drawing.Color]::SteelBlue
      $script:effect = 'none'
      $form.Add_MouseDown({
        $data = New-Object System.Windows.Forms.DataObject
        $list = New-Object System.Collections.Specialized.StringCollection
        [void]$list.Add($File)
        $data.SetFileDropList($list)
        $script:effect = [string]$form.DoDragDrop($data, [System.Windows.Forms.DragDropEffects]::Copy)
        $form.Close()
      })
      $sx = $form.Location.X + 40; $sy = $form.Location.Y + 40
      $form.Add_Shown({ [PfwInput]::StartDrop($sx, $sy, $X, $Y, [uint32]$TargetPid) })
      $timer = New-Object System.Windows.Forms.Timer; $timer.Interval = 15000; $timer.Add_Tick({ $form.Close() }); $timer.Start()
      [System.Windows.Forms.Application]::Run($form)
      [PfwInput]::JoinDrop()
      $script:dropped = [PfwInput]::Dropped
      $result = "dropped=$($script:dropped) effect=$($script:effect)"
    }
    'drag' {
      if ([PfwInput]::OwnerAt($X, $Y) -ne $TargetPid) { throw 'start point is not on the target window' }
      [PfwInput]::MoveTo($X, $Y); Start-Sleep -Milliseconds 150
      [PfwInput]::Down($X, $Y); Start-Sleep -Milliseconds 150
      [PfwInput]::Glide($X, $Y, $X + $DX, $Y + $DY, 20, 25)
      Start-Sleep -Milliseconds 200
      [PfwInput]::Up($X + $DX, $Y + $DY); Start-Sleep -Milliseconds 300
      $result = 'dragged'
    }
    'dblclick' {
      if ([PfwInput]::OwnerAt($X, $Y) -ne $TargetPid) { throw 'point is not on the target window' }
      [PfwInput]::MoveTo($X, $Y); Start-Sleep -Milliseconds 150
      [PfwInput]::Down($X, $Y); [PfwInput]::Up($X, $Y); Start-Sleep -Milliseconds 60
      [PfwInput]::Down($X, $Y); [PfwInput]::Up($X, $Y); Start-Sleep -Milliseconds 600
      $result = 'double-clicked'
    }
    'keys' {
      if ($Keys -eq 'win+left') {
        [PfwInput]::Key(0x5B, $false); [PfwInput]::Key(0x25, $false); [PfwInput]::Key(0x25, $true); [PfwInput]::Key(0x5B, $true)
        Start-Sleep -Milliseconds 700
        [PfwInput]::Key(0x1B, $false); [PfwInput]::Key(0x1B, $true) # dismiss Snap Assist
        Start-Sleep -Milliseconds 300
        $result = 'win+left'
      }
    }
  }
} finally {
  [PfwInput]::MoveTo($start.X, $start.Y)
}
$result
