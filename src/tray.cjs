const { app, Tray, Menu, nativeImage, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { setupAutoStart } = require('./auto-start.cjs');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// Raíz de la app: en dev es el proyecto, en producción es resources/app
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');

// Carpeta de datos y configuración del usuario (escribible sin permisos de
// administrador). En producción la app vive en Program Files, que es de solo
// lectura para usuarios normales, así que la base de datos, capturas y .env
// se guardan aquí en vez de junto al ejecutable.
const USER_DIR = app.isPackaged ? app.getPath('userData') : APP_ROOT;
mkdirSync(USER_DIR, { recursive: true });

// Carga las credenciales (.env) desde la carpeta de usuario. En dev, si no
// existe ahí, usa el .env del proyecto para no cambiar el flujo habitual.
function loadUserEnv() {
  const userEnvPath = path.join(USER_DIR, '.env');
  if (existsSync(userEnvPath)) return dotenv.parse(readFileSync(userEnvPath));
  if (!app.isPackaged) {
    const devEnvPath = path.join(APP_ROOT, '.env');
    if (existsSync(devEnvPath)) return dotenv.parse(readFileSync(devEnvPath));
  }
  return {};
}

// Buscar el ejecutable de node en el sistema
function findNode() {
  try {
    const result = execSync('where node', { encoding: 'utf8', stdio: 'pipe' });
    return result.trim().split('\n')[0].trim();
  } catch {
    const candidates = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    return 'node';
  }
}

const NODE_BIN = findNode();

let tray = null;
let trackerProcess = null;
let stopRequested = false;
let restartAttempts = 0;
let restartTimer = null;

const RESTART_DELAYS_MS = [5000, 15000, 60000];
// Si aguantó corriendo este rato, la siguiente caída se trata como nueva y no
// arrastra la espera larga de una racha vieja de fallos.
const HEALTHY_AFTER_MS = 5 * 60 * 1000;
// A partir de aquí, "corriendo" sin escribir en la base significa que algo se
// rompió río arriba (API, permisos, disco) aunque el proceso siga vivo.
const STALE_AFTER_MIN = 5;

function dbFilePath() {
  const configured = loadUserEnv().DB_PATH || './data/tracker.db';
  return path.resolve(USER_DIR, configured);
}

// Minutos desde la última escritura en la base, o null si aún no existe.
function minutesSinceLastWrite() {
  try {
    return Math.floor((Date.now() - statSync(dbFilePath()).mtimeMs) / 60000);
  } catch {
    return null;
  }
}

function createTrayIcon() {
  const size = 16;
  const data = Buffer.alloc(size * size * 4, 0);

  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = a;
  };

  const eyePixels = [
    [4,5],[5,4],[6,4],[7,4],[8,4],[9,4],[10,4],[11,5],
    [4,10],[5,11],[6,11],[7,11],[8,11],[9,11],[10,11],[11,10],
    [3,7],[3,8],[12,7],[12,8],
    [4,6],[11,6],[4,9],[11,9]
  ];
  eyePixels.forEach(([x, y]) => set(x, y, 255, 255, 255));

  const pupilPixels = [
    [7,7],[8,7],[7,8],[8,8],
    [6,7],[9,7],[7,6],[8,6],[7,9],[8,9],[6,8],[9,8]
  ];
  pupilPixels.forEach(([x, y]) => set(x, y, 255, 255, 255));

  return nativeImage.createFromBitmap(data, { width: size, height: size });
}

function isTrackerRunning() { return trackerProcess !== null; }

function startTracker() {
  if (isTrackerRunning()) return;
  clearTimeout(restartTimer);
  restartTimer = null;
  stopRequested = false;

  const script = path.join(APP_ROOT, 'src', 'index.js');
  const startedAt = Date.now();
  trackerProcess = spawn(NODE_BIN, [script], {
    cwd: USER_DIR,
    env: { ...process.env, ...loadUserEnv() },
    stdio: 'inherit',
    // Sin esto Windows abre una consola que roba el foco, y el propio tracker
    // se registra a sí mismo como la ventana activa.
    windowsHide: true,
  });
  trackerProcess.on('error', (err) => console.error('Error al iniciar tracker:', err.message));
  trackerProcess.on('exit', (code, signal) => {
    trackerProcess = null;
    if (Date.now() - startedAt > HEALTHY_AFTER_MS) restartAttempts = 0;
    if (stopRequested) {
      restartAttempts = 0;
      updateMenu();
      return;
    }
    scheduleRestart(code, signal);
  });
  updateMenu();
}

// Sin esto, una caída del tracker dejaba el tray vivo en la bandeja y la captura
// muerta en silencio: parecía encendido durante semanas sin guardar nada.
function scheduleRestart(code, signal) {
  const delay = RESTART_DELAYS_MS[Math.min(restartAttempts, RESTART_DELAYS_MS.length - 1)];
  restartAttempts += 1;
  console.warn(`[tray] Tracker terminó (code=${code}, signal=${signal}). Reinicio #${restartAttempts} en ${delay / 1000}s.`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startTracker();
  }, delay);
  updateMenu();
}

function stopTracker() {
  stopRequested = true;
  restartAttempts = 0;
  clearTimeout(restartTimer);
  restartTimer = null;
  if (isTrackerRunning()) {
    trackerProcess.kill();
    trackerProcess = null;
  }
  updateMenu();
}

function statusLabel() {
  if (restartTimer) return '🟠 Reiniciando…';
  if (!isTrackerRunning()) return '🔴 Pausado';
  const stale = minutesSinceLastWrite();
  if (stale !== null && stale >= STALE_AFTER_MIN) {
    return `⚠️ Activo, sin guardar (${stale} min)`;
  }
  return '🟢 Activo';
}

function updateMenu() {
  const running = isTrackerRunning();
  const status = statusLabel();
  tray.setToolTip(`Screen Tracker — ${status.replace(/^\S+\s/, '')}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: '▶ Iniciar', enabled: !running, click: startTracker },
    { label: '⏹ Detener', enabled: running || Boolean(restartTimer), click: stopTracker },
    { type: 'separator' },
    {
      label: '📊 Reporte ahora',
      click: () => {
        const dataDir = path.join(USER_DIR, 'data');
        mkdirSync(dataDir, { recursive: true });
        const reportHtmlPath = path.join(APP_ROOT, 'src', 'report-html.js').replace(/\\/g, '/');
        const scriptPath = path.join(dataDir, 'run-report.mjs');
        const script = `import { openDailyReportInBrowser } from 'file:///${reportHtmlPath}';\nawait openDailyReportInBrowser();\n`;
        writeFileSync(scriptPath, script, 'utf8');
        const proc = spawn(NODE_BIN, [scriptPath], {
          cwd: USER_DIR,
          env: { ...process.env, ...loadUserEnv() },
          stdio: 'inherit',
          shell: false
        });
        proc.on('error', (err) => console.error('Error reporte:', err.message));
        proc.on('exit', (code) => console.log('Reporte exit:', code));
      }
    },
    {
      label: '📁 Abrir carpeta de datos y config',
      click: () => shell.openPath(USER_DIR)
    },
    { type: 'separator' },
    { label: '❌ Salir', click: () => { stopTracker(); app.quit(); } },
  ]));
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.hide();
  tray = new Tray(createTrayIcon());
  await setupAutoStart();
  updateMenu();
  startTracker();
  // El aviso de "sin guardar" depende del reloj, no de un cambio de estado.
  setInterval(updateMenu, 60 * 1000);
});

app.on('window-all-closed', (e) => e.preventDefault());
