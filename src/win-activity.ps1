# Devuelve, en JSON, la ventana en primer plano y cuánto lleva el equipo sin
# recibir teclado/ratón. Sin esto último, una ventana abierta tres horas se
# contaría como tres horas de trabajo aunque nadie estuviera ahí.
$ErrorActionPreference = 'Stop'

# Sin esto PowerShell escribe en la codificacion de consola (CP850 en Windows en
# espanol) y Node lo lee como UTF-8: los titulos con acentos llegan rotos a la
# base, con caracteres de reemplazo en vez de "Bitacora" o "retencion".
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class WinActivity {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);

  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }

  [DllImport("user32.dll")]
  public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

  [DllImport("kernel32.dll")]
  public static extern uint GetTickCount();

  public static uint IdleSeconds() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return 0;
    return (GetTickCount() - info.dwTime) / 1000;
  }
}
"@

$handle = [WinActivity]::GetForegroundWindow()
$buffer = New-Object System.Text.StringBuilder 1024
[void][WinActivity]::GetWindowText($handle, $buffer, 1024)

$processId = 0
[void][WinActivity]::GetWindowThreadProcessId($handle, [ref]$processId)
$proc = Get-Process -Id $processId -ErrorAction SilentlyContinue

[pscustomobject]@{
  process = if ($proc) { $proc.ProcessName } else { $null }
  title   = $buffer.ToString()
  idle    = [int][WinActivity]::IdleSeconds()
} | ConvertTo-Json -Compress
