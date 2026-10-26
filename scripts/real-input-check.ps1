# Real-input checks against a running Preview window: an OLE file drop from a drag source onto a
# screen point, a title-bar drag, and Win+Left snapping. Safety rules:
#   - a topmost banner says a test is running and how to stop it;
#   - any physical mouse or keyboard input (not flagged as injected) aborts at once, releasing
#     the button and cancelling the drag;
#   - each press happens only if the window under the cursor belongs to the target process;
#   - the cursor goes back where it was.
# Prints one line of key=value results.
param(
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [Parameter(Mandatory = $true)][int]$DropX, [Parameter(Mandatory = $true)][int]$DropY,
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][int]$TitleX, [Parameter(Mandatory = $true)][int]$TitleY
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
if (-not ('PfwGuard' -as [type])) {
Add-Type -ReferencedAssemblies System.Windows.Forms @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class PfwGuard {
  // ---- input injection -----------------------------------------------------------------
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  static void Mouse(uint flags, int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    var i = new INPUT { type = 0 };
    i.u.mi.dx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1));
    i.u.mi.dy = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    i.u.mi.flags = flags | 0x8000 | 0x4000;
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  static void Key(ushort vk, bool up) {
    // The Windows key and the arrows are extended keys; without the flag Left arrives as
    // numpad 4 and the shell does not treat Win+Left as the snap shortcut.
    bool extended = vk == 0x5B || (vk >= 0x25 && vk <= 0x28);
    var i = new INPUT { type = 1 }; i.u.ki.vk = vk; i.u.ki.scan = (ushort)MapVirtualKey(vk, 0);
    i.u.ki.flags = (up ? 2u : 0u) | (extended ? 1u : 0u);
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  static bool down;
  static void MoveTo(int x, int y) { Mouse(1, x, y); }
  static void Down(int x, int y) { Mouse(1 | 2, x, y); down = true; }
  static void Up(int x, int y) { Mouse(1 | 4, x, y); down = false; }
  static uint OwnerAt(int x, int y) {
    uint pid; GetWindowThreadProcessId(GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2), out pid); return pid;
  }
  static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }

  // ---- abort on physical input --------------------------------------------------------------
  delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc p, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int c, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string n);
  [StructLayout(LayoutKind.Sequential)] struct MSLL { public int x, y; public uint data, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KBLL { public uint vk, scan, flags, time; public IntPtr extra; }
  static HookProc mouseHook, keyHook;
  static IntPtr mh, kh;
  public static volatile bool Abort;
  public static string AbortReason = "";
  public static void InstallHooks() {
    mouseHook = (c, w, l) => {
      if (c >= 0) { var m = (MSLL)Marshal.PtrToStructure(l, typeof(MSLL)); if ((m.flags & 3) == 0) { Abort = true; AbortReason = "physical mouse"; } }
      return CallNextHookEx(mh, c, w, l);
    };
    keyHook = (c, w, l) => {
      if (c >= 0) { var k = (KBLL)Marshal.PtrToStructure(l, typeof(KBLL)); if ((k.flags & 0x12) == 0) { Abort = true; AbortReason = "physical key"; } }
      return CallNextHookEx(kh, c, w, l);
    };
    IntPtr mod = GetModuleHandle(null);
    mh = SetWindowsHookEx(14, mouseHook, mod, 0);
    kh = SetWindowsHookEx(13, keyHook, mod, 0);
  }
  public static void RemoveHooks() { if (mh != IntPtr.Zero) UnhookWindowsHookEx(mh); if (kh != IntPtr.Zero) UnhookWindowsHookEx(kh); }

  // ---- the scenario ------------------------------------------------------------------------
  public static string Result = "";
  static void Pause(int ms) { for (int t = 0; t < ms; t += 20) { if (Abort) throw new OperationCanceledException(); Thread.Sleep(20); } }
  static void Glide(int x0, int y0, int x1, int y1, int steps, int ms) {
    for (int s = 1; s <= steps; s++) { if (Abort) throw new OperationCanceledException(); MoveTo(x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps); Thread.Sleep(ms); }
  }
  public static Thread Run(int sx, int sy, int dropX, int dropY, int titleX, int titleY, IntPtr hwnd, uint pid,
                           System.Windows.Forms.Form source, System.Windows.Forms.Form banner) {
    var t = new Thread(() => {
      POINT start; GetCursorPos(out start);
      var r = new System.Text.StringBuilder();
      try {
        // 1. OLE file drop from the drag source onto the gap between thumbnails.
        Pause(700);
        // Never press anywhere but on our own drag source (e.g. not on a lock screen).
        if (OwnerAt(sx, sy) != (uint)System.Diagnostics.Process.GetCurrentProcess().Id) throw new Exception("drag source not under the cursor");
        MoveTo(sx, sy); Pause(120); Down(sx, sy); Pause(120);
        Glide(sx, sy, sx + 24, sy, 6, 20);
        Glide(sx + 24, sy, dropX, dropY, 24, 25);
        Pause(600);
        if (OwnerAt(dropX, dropY) == pid) { Up(dropX, dropY); r.Append("drop=released-on-preview "); }
        else { Key(0x1B, false); Key(0x1B, true); Up(dropX, dropY); r.Append("drop=cancelled-not-over-preview "); }
        Pause(1500);
        // 2. Title-bar drag moves the window.
        RECT a; GetWindowRect(hwnd, out a);
        if (OwnerAt(titleX, titleY) != pid) throw new Exception("title point not on preview");
        MoveTo(titleX, titleY); Pause(150); Down(titleX, titleY); Pause(150);
        Glide(titleX, titleY, titleX + 160, titleY + 90, 20, 25);
        Pause(200); Up(titleX + 160, titleY + 90); Pause(400);
        RECT b; GetWindowRect(hwnd, out b);
        r.Append("titleDrag=" + (b.L - a.L) + "," + (b.T - a.T) + " ");
        // 3. Win+Left snaps the (now foreground) window to the left half.
        if (ForegroundPid() == pid) {
          Key(0x5B, false); Key(0x25, false); Key(0x25, true); Key(0x5B, true);
          Pause(800);
          Key(0x1B, false); Key(0x1B, true); // dismiss Snap Assist
          Pause(400);
          RECT c; GetWindowRect(hwnd, out c);
          r.Append("snapped=" + c.L + "," + c.T + "," + c.R + "," + c.B + " ");
        } else {
          r.Append("snapped=skipped-not-foreground ");
        }
      } catch (OperationCanceledException) {
        r.Append("ABORTED(" + AbortReason + ") ");
        Key(0x1B, false); Key(0x1B, true);
      } catch (Exception e) {
        r.Append("error=" + e.Message.Replace(' ', '_') + " ");
      } finally {
        if (down) { POINT p; GetCursorPos(out p); Up(p.X, p.Y); }
        MoveTo(start.X, start.Y);
        Result = r.ToString().Trim();
        try { source.BeginInvoke((Action)(() => { banner.Close(); source.Close(); })); } catch { }
      }
    });
    t.IsBackground = true;
    return t;
  }
}
"@
}
[PfwGuard]::SetProcessDPIAware() | Out-Null
$target = Get-Process -Id $TargetPid
$hwnd = $target.MainWindowHandle

# Notice banner, topmost, out of the way of the drop target.
$banner = New-Object System.Windows.Forms.Form
$banner.TopMost = $true; $banner.FormBorderStyle = 'None'; $banner.ShowInTaskbar = $false
$banner.StartPosition = 'Manual'; $banner.Size = New-Object Drawing.Size(560, 44)
$banner.Location = New-Object Drawing.Point(20, 20); $banner.BackColor = [Drawing.Color]::FromArgb(32, 32, 34)
$label = New-Object System.Windows.Forms.Label
$label.Dock = 'Fill'; $label.ForeColor = [Drawing.Color]::White; $label.TextAlign = 'MiddleCenter'
$label.Font = New-Object Drawing.Font('Segoe UI', 11)
$label.Text = 'Preview automated test running (about 15 s). Move the mouse to stop it.'
$banner.Controls.Add($label)

# Drag source with the PDF.
$source = New-Object System.Windows.Forms.Form
$source.TopMost = $true; $source.FormBorderStyle = 'None'; $source.ShowInTaskbar = $false
$source.StartPosition = 'Manual'; $source.Size = New-Object Drawing.Size(80, 80)
$fx = [Math]::Max(0, $DropX - 360); $fy = $DropY - 40
$source.Location = New-Object Drawing.Point($fx, $fy); $source.BackColor = [Drawing.Color]::SteelBlue
$script:effect = 'none'
$source.Add_MouseDown({
  $data = New-Object System.Windows.Forms.DataObject
  $list = New-Object System.Collections.Specialized.StringCollection
  [void]$list.Add($File)
  $data.SetFileDropList($list)
  $script:effect = [string]$source.DoDragDrop($data, [System.Windows.Forms.DragDropEffects]::Copy)
})
$sx = $fx + 40; $sy = $fy + 40
$runner = [PfwGuard]::Run($sx, $sy, $DropX, $DropY, $TitleX, $TitleY, $hwnd, [uint32]$TargetPid, $source, $banner)
$source.Add_Shown({ $banner.Show(); [PfwGuard]::InstallHooks(); $runner.Start() })
$watchdog = New-Object System.Windows.Forms.Timer; $watchdog.Interval = 30000
$watchdog.Add_Tick({ [PfwGuard]::Abort = $true; $source.Close() }); $watchdog.Start()
try {
  [System.Windows.Forms.Application]::Run($source)
} finally {
  [PfwGuard]::RemoveHooks()
}
$runner.Join(5000) | Out-Null
[PfwGuard]::Result + " dropEffect=$($script:effect)"
