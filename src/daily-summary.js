import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getSnapshotsForDate } from './db.js';
import { aggregate, labelsFor } from './aggregate.js';
import { sendSlackReport } from './slack.js';
import 'dotenv/config';

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_USER_ID = process.env.SLACK_USER_ID || '';
const CLAUDE_TIMEOUT_MS = 180000;

const MARK_START = '<!-- screen-tracker:inicio -->';
const MARK_END = '<!-- screen-tracker:fin -->';

const hhmm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min`;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

// Una sola llamada al dia: cabe de sobra en la suscripcion via Claude Code
// headless, que no consume credito de la API.
//
// Todo va por stdin y el unico argumento es "-p". Pasar el prompt como argumento
// con shell:true lo concatena sin escapar y se parte en el primer espacio.
// Y se corre fuera del repo: desde la carpeta del proyecto, Claude Code toma
// contexto del codigo y termina analizandolo en vez de resumir el dia.
function askClaude(prompt, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p'], {
      shell: true,
      windowsHide: true,
      cwd: tmpdir(),
      timeout: CLAUDE_TIMEOUT_MS,
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude -p salio con codigo ${code}: ${err.trim()}`));
      resolve(out.trim());
    });
    proc.stdin.write(`${prompt}\n\nDatos:\n${input}\n`);
    proc.stdin.end();
  });
}

function buildPrompt(label) {
  return [
    'Te paso el registro de actividad de un dia de trabajo, medido por titulo de ventana activa.',
    `El porcentaje de "${label.active}" se midio por ${label.note}.`,
    '',
    'Escribe en espanol un resumen corto para una bitacora personal:',
    '- 3 a 5 bullets con emoji, agrupando por tipo de trabajo, no app por app.',
    '- Usa los titulos de ventana para decir en QUE se trabajo (documento, pagina, cliente), no solo que app.',
    '- Menciona el cliente cuando el titulo lo revele.',
    '- Si el tiempo se fragmento mucho entre cosas distintas, dilo.',
    '- Sin preambulo, sin cierre motivacional, sin inventar nada que no este en los datos.',
  ].join('\n');
}

function upsertSection(filePath, fecha, bloque) {
  const seccion = [
    '## ⏱️ Tiempo por actividad',
    MARK_START,
    bloque,
    MARK_END,
  ].join('\n');

  if (!existsSync(filePath)) {
    writeFileSync(filePath, [
      '---', 'tipo: resumen', `fecha: ${fecha}`, 'fuente: screen-tracker', '---', '',
      `# 📋 Resumen — ${fechaLarga(fecha)}`, '', seccion, '',
    ].join('\n'), 'utf8');
    return 'creada';
  }

  const actual = readFileSync(filePath, 'utf8');
  const inicio = actual.indexOf(MARK_START);
  const fin = actual.indexOf(MARK_END);

  // Reemplaza solo lo que escribio el tracker: el resto de la nota (lo de
  // GitHub, Slack, pendientes) es de otra fuente y no se toca.
  if (inicio !== -1 && fin !== -1) {
    const nuevo = actual.slice(0, inicio) + MARK_START + '\n' + bloque + '\n' + actual.slice(fin);
    writeFileSync(filePath, nuevo, 'utf8');
    return 'actualizada';
  }

  writeFileSync(filePath, `${actual.trimEnd()}\n\n${seccion}\n`, 'utf8');
  return 'agregada';
}

async function sendDirectMessage(text) {
  if (!SLACK_BOT_TOKEN || !SLACK_USER_ID) return sendSlackReport(text);

  const open = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ users: SLACK_USER_ID }),
  }).then((r) => r.json());
  if (!open.ok) throw new Error(`conversations.open: ${open.error}`);

  const post = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify({ channel: open.channel.id, text, unfurl_links: false }),
  }).then((r) => r.json());
  if (!post.ok) throw new Error(`chat.postMessage: ${post.error}`);

  console.log('📨  Enviado al DM de Slack.');
}

export async function generateDailySummary(dateStr) {
  const fecha = dateStr || new Date().toLocaleDateString('sv-SE'); // sv-SE da YYYY-MM-DD local
  const snapshots = getSnapshotsForDate(fecha);
  if (!snapshots.length) { console.log(`📭  Sin capturas para ${fecha}`); return null; }

  const data = aggregate(snapshots);
  if (!data.count) { console.log(`📭  Sin capturas utilizables para ${fecha}`); return null; }
  const label = labelsFor(data.engine);

  const payload = JSON.stringify({
    fecha,
    tiempo_total_min: data.totalMinutes,
    tiempo_activo_min: data.activeMinutes,
    porcentaje_activo: data.pct,
    apps: data.apps.slice(0, 12),
    ventanas: data.tasks.slice(0, 20),
  }, null, 2);

  console.log('🤖  Pidiendo el resumen a Claude (suscripcion, sin API)...');
  const narrativa = await askClaude(buildPrompt(label), payload);

  const encabezado = `🕐 ${hhmm(data.totalMinutes)} registrados · ⚡ ${hhmm(data.activeMinutes)} de ${label.active.toLowerCase()} (${data.pct}%)`;
  const bloque = `${encabezado}\n\n${narrativa}`;

  let destinoNota = 'sin vault configurado';
  if (VAULT_PATH) {
    destinoNota = upsertSection(join(VAULT_PATH, `Resumen ${fecha}.md`), fecha, bloque);
  }

  await sendDirectMessage(`*⏱️ Tiempo por actividad — ${fechaLarga(fecha)}*\n\n${bloque}`);

  console.log(`📝  Nota de Obsidian: ${destinoNota}`);
  return { fecha, bloque };
}

if (process.argv[1]?.endsWith('daily-summary.js')) {
  await generateDailySummary(process.argv[2]);
}
