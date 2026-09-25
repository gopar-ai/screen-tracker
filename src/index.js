import cron from 'node-cron';
import 'dotenv/config';
import { captureScreen }      from './capture.js';
import { captureWindow }      from './capture-window.js';
import { analyzeScreenshot }  from './analyze.js';
import { saveSnapshot }       from './db.js';
import { generateDailyReport } from './report.js';
import { generateDailySummary } from './daily-summary.js';
import { openDailyReportInBrowser } from './report-html.js';

const INTERVAL    = Number(process.env.CAPTURE_INTERVAL_MINUTES) || 5;
const REPORT_HOUR = Number(process.env.REPORT_HOUR) || 18;
const CAPTURE_MODE = (process.env.CAPTURE_MODE || 'window').toLowerCase();

// El título de ventana identifica app, documento y hasta cliente sin costo ni
// API. La visión queda disponible para casos donde el título no dice nada.
async function captureFromWindow() {
  const w = await captureWindow();
  const estado = w.active ? '🟢' : '💤';
  const detalle = w.active ? '' : ` (inactivo ${w.idleSeconds}s)`;
  console.log(`${estado}  ${w.app} — ${w.task}${detalle}`);
  saveSnapshot({
    captured_at: w.capturedAt,
    screenshot: null,
    app: w.app,
    task: w.task,
    productive: w.active ? 1 : 0,
    confidence: 1,
    raw_analysis: null,
    idle_seconds: w.idleSeconds,
    source: 'window',
  });
}

async function captureFromVision() {
  const { base64, mediaType, capturedAt } = await captureScreen();
  console.log('🤖  Analizando con Claude Vision...');
  const a = await analyzeScreenshot({ base64, mediaType });
  if (!a) {
    console.warn('⏭️   Captura descartada: mejor un hueco que una fila falsa.');
    return;
  }
  console.log(`${a.productive ? '✅' : '🎮'}  ${a.app} — ${a.task} (${Math.round(a.confidence * 100)}%)`);
  saveSnapshot({
    captured_at: capturedAt,
    screenshot: null,
    app: a.app || 'Unknown',
    task: a.task || 'Unknown',
    productive: a.productive ? 1 : 0,
    confidence: a.confidence || 0,
    raw_analysis: a.rawAnalysis || null,
    source: 'vision',
  });
}

async function runCapture() {
  console.log(`\n🔄  [${new Date().toLocaleTimeString()}] Capturando...`);
  try {
    if (CAPTURE_MODE === 'vision') await captureFromVision();
    else await captureFromWindow();
    console.log('💾  Guardado.');
  } catch (err) {
    console.error('❌  Error en ciclo:', err.message);
  }
}

// Corre al cierre de la jornada, asi que resume las 24 horas que acaban de
// terminar, no la jornada que arranca en ese mismo instante.
async function runReport() {
  console.log('\n📊  Cierre de jornada...');
  try {
    const result = await generateDailyReport(null, { closing: true });
    if (result) await openDailyReportInBrowser(null, true); // true = emailMode
  } catch (err) {
    console.error('❌  Error en reporte:', err.message);
  }

  // Va aparte del reporte por correo: si el resumen narrativo falla, el reporte
  // de siempre ya se mando.
  try {
    await generateDailySummary(null, { closing: true });
  } catch (err) {
    console.error('❌  Error en resumen diario:', err.message);
  }
}

console.log('\n╔══════════════════════════════════════╗');
console.log('║      🖥️  Screen Tracker Iniciado      ║');
console.log('╚══════════════════════════════════════╝');
console.log(`📸  Captura cada ${INTERVAL} min (modo: ${CAPTURE_MODE}) | 📊  Reporte a las ${REPORT_HOUR}:00\n`);

await runCapture();
cron.schedule(`*/${INTERVAL} * * * *`, runCapture);
cron.schedule(`0 ${REPORT_HOUR} * * *`, runReport);
process.on('SIGINT', () => { console.log('\n👋  Screen Tracker detenido.'); process.exit(0); });
