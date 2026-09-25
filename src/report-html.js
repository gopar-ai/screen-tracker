import { getSnapshotsForDate } from './db.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { sendReportByEmail } from './email.js';
import { aggregate, labelsFor } from './aggregate.js';
import 'dotenv/config';

const hhmm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min`;
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

export async function openDailyReportInBrowser(dateStr, emailMode = false) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const WORK_START = Number(process.env.WORK_START_HOUR) || 9;
  const WORK_END = Number(process.env.WORK_END_HOUR) || 18;

  let snapshots = getSnapshotsForDate(today);

  if (emailMode) {
    // Filtrar solo horario laboral para el reporte por email
    snapshots = snapshots.filter(s => {
      const hour = new Date(s.captured_at).getHours();
      return hour >= WORK_START && hour < WORK_END;
    });
  } else {
    // Reporte ahora: desde las 9am hasta ahorita
    const now = new Date();
    snapshots = snapshots.filter(s => {
      const hour = new Date(s.captured_at).getHours();
      return hour >= WORK_START && new Date(s.captured_at) <= now;
    });
  }

  if (!snapshots.length) {
    console.log(`📭  No snapshots para ${today}`);
    return;
  }

  const data = aggregate(snapshots);
  if (!data.count) {
    console.log(`📭  Sin capturas utilizables para ${today}`);
    return;
  }
  const label = labelsFor(data.engine);
  const { totalMinutes, activeMinutes, idleMinutes, pct } = data;

  const appRows = data.apps.map((a) => `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${hhmm(a.minutes)}</td>
        <td><span class="badge ${a.activePct >= 50 ? 'prod' : 'dist'}">${a.activePct}% ${escapeHtml(label.active.toLowerCase())}</span></td>
      </tr>`).join('');

  const catRows = data.categories
    .filter((c) => c.name !== 'sin categoria')
    .map((c) => `
      <tr><td>${escapeHtml(c.name)}</td><td>${hhmm(c.minutes)}</td></tr>`).join('');

  const taskRows = data.tasks.slice(0, 8).map((t) => `
      <tr><td>${escapeHtml(t.name)}</td><td>${hhmm(t.minutes)}</td></tr>`).join('');

  const topApp = data.apps[0];
  const msg = topApp
    ? `Donde mas estuviste: ${escapeHtml(topApp.name)} — ${hhmm(topApp.minutes)}`
    : 'Sin actividad registrada';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Screen Tracker — ${today}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f13; color: #e2e8f0; min-height: 100vh; padding: 40px 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 4px; }
    .date { color: #64748b; margin-bottom: 32px; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
    .stat { background: #1e1e2e; border-radius: 12px; padding: 20px; text-align: center; }
    .stat .value { font-size: 2rem; font-weight: 700; color: #818cf8; }
    .stat .label { font-size: 0.85rem; color: #64748b; margin-top: 4px; }
    .card { background: #1e1e2e; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 16px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 10px 8px; border-bottom: 1px solid #2d2d3e; font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    .badge { padding: 2px 10px; border-radius: 99px; font-size: 0.8rem; }
    .badge.prod { background: #14532d; color: #86efac; }
    .badge.dist { background: #3b0764; color: #d8b4fe; }
    .conclusion { background: #1e1e2e; border-radius: 12px; padding: 24px; text-align: center; font-size: 1.2rem; font-weight: 600; }
    .progress { background: #2d2d3e; border-radius: 99px; height: 8px; margin-top: 16px; overflow: hidden; }
    .progress-bar { height: 100%; border-radius: 99px; background: linear-gradient(90deg, #818cf8, #a78bfa); transition: width 1s; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🖥️ Screen Tracker</h1>
    <p class="date">Reporte del ${today}</p>

    <div class="stats">
      <div class="stat">
        <div class="value">${hhmm(totalMinutes)}</div>
        <div class="label">Tiempo registrado</div>
      </div>
      <div class="stat">
        <div class="value">${pct}<span style="font-size:1rem">%</span></div>
        <div class="label">${label.ratio}</div>
      </div>
      <div class="stat">
        <div class="value">${data.count}</div>
        <div class="label">Capturas</div>
      </div>
    </div>

    <div class="card">
      <h2>${label.ratio}</h2>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.9rem;">
        <span>⚡ ${hhmm(activeMinutes)} ${label.active.toLowerCase()}</span>
        <span>💤 ${hhmm(idleMinutes)} ${label.inactive.toLowerCase()}</span>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      <p style="margin-top:12px; font-size:0.8rem; color:#64748b;">
        Medido por ${label.note}. El tiempo sale de la distancia real entre capturas, no del conteo.${data.discarded ? ` Se descartaron ${data.discarded} capturas con analisis fallido.` : ''}
      </p>
    </div>

    <div class="card">
      <h2>🖥️ Por App</h2>
      <table>${appRows}</table>
    </div>

    <div class="card">
      <h2>🗂️ Por Categoría</h2>
      <table>${catRows}</table>
    </div>

    <div class="card">
      <h2>📝 En qué estuviste</h2>
      <table>${taskRows}</table>
    </div>

    <div class="conclusion">${msg}</div>
  </div>
</body>
</html>`;

  if (emailMode) {
    await sendReportByEmail(html, today);
  } else {
    const outPath = join('data', `report-${today}.html`);
    writeFileSync(outPath, html, 'utf8');
    const cmd = process.platform === 'win32'
      ? `start "" "${outPath}"`
      : process.platform === 'darwin'
      ? `open "${outPath}"`
      : `xdg-open "${outPath}"`;
    execSync(cmd);
    console.log(`📊  Reporte abierto en browser: ${outPath}`);
  }
}
