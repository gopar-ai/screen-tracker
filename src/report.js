import { getSnapshotsForDate, saveDailyReport } from './db.js';
import { openDailyReportInBrowser } from './report-html.js';
import { aggregate, labelsFor } from './aggregate.js';
import 'dotenv/config';

const hhmm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min`;

export async function generateDailyReport(dateStr) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const snapshots = getSnapshotsForDate(today);
  if (!snapshots.length) { console.log(`📭  Sin capturas para ${today}`); return null; }

  const data = aggregate(snapshots);
  if (!data.count) { console.log(`📭  Sin capturas utilizables para ${today}`); return null; }
  const label = labelsFor(data.engine);

  const appLines = data.apps
    .map((a) => `  • ${a.name}: ${hhmm(a.minutes)} (${a.activePct}% ${label.active.toLowerCase()})`)
    .join('\n');
  const catLines = data.categories
    .filter((c) => c.name !== 'sin categoria')
    .map((c) => `  • ${c.name}: ${hhmm(c.minutes)}`)
    .join('\n');
  const taskLines = data.tasks.slice(0, 5)
    .map((t) => `  • ${t.name} (${hhmm(t.minutes)})`)
    .join('\n');

  const summary = [
    `📊 *Screen Tracker — ${today}*`, '',
    `🕐 *Tiempo registrado:* ${hhmm(data.totalMinutes)} (${data.count} capturas)`,
    `⚡ *${label.active}:* ${hhmm(data.activeMinutes)} (${data.pct}%)`,
    `💤 *${label.inactive}:* ${hhmm(data.idleMinutes)} (${100 - data.pct}%)`,
    `📐 *${label.ratio}* medida por ${label.note}.`,
    data.discarded ? `🗑️ ${data.discarded} capturas descartadas (analisis fallido).` : '',
    '',
    '*🖥️ Por App:*', appLines,
    catLines ? `\n*🗂️ Por Categoria:*\n${catLines}` : '',
    '', '*📝 En que estuviste:*', taskLines,
  ].filter((line) => line !== '').join('\n');

  saveDailyReport({
    report_date: today,
    total_minutes: data.totalMinutes,
    prod_minutes: data.activeMinutes,
    summary,
    sent_to_slack: 0,
  });
  console.log('\n' + summary + '\n');
  return { today, totalMinutes: data.totalMinutes, prodMinutes: data.activeMinutes, pct: data.pct, summary };
}

if (process.argv[1].endsWith('report.js')) {
  const result = await generateDailyReport(process.argv[2]);
  if (result) await openDailyReportInBrowser(process.argv[2], true); // true = emailMode
}
