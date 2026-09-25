import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'win-activity.ps1');

// Sin teclado ni ratón por este tiempo, la ventana sigue abierta pero nadie
// está trabajando en ella.
const IDLE_THRESHOLD_SECONDS = Number(process.env.IDLE_THRESHOLD_SECONDS) || 120;

export async function captureWindow() {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
    { timeout: 15000, windowsHide: true }
  );

  const { process: processName, title, idle } = JSON.parse(stdout);
  const idleSeconds = Number(idle) || 0;

  return {
    capturedAt: new Date().toISOString(),
    app: processName || 'Unknown',
    task: (title || '').trim() || 'Sin título',
    idleSeconds,
    active: idleSeconds < IDLE_THRESHOLD_SECONDS,
  };
}
