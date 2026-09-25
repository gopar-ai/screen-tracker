import sqlite from 'node-sqlite3-wasm';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import 'dotenv/config';

const DB_PATH = process.env.DB_PATH || './data/tracker.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new sqlite.Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at  TEXT    NOT NULL,
    screenshot   TEXT,
    app          TEXT,
    task         TEXT,
    productive   INTEGER NOT NULL DEFAULT 0,
    confidence   REAL,
    raw_analysis TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at ON snapshots(captured_at);
  CREATE TABLE IF NOT EXISTS daily_reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    report_date   TEXT NOT NULL UNIQUE,
    total_minutes INTEGER NOT NULL DEFAULT 0,
    prod_minutes  INTEGER NOT NULL DEFAULT 0,
    summary       TEXT,
    sent_to_slack INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Las filas anteriores a estas columnas vienen del motor de visión, donde
// `productive` era el juicio de un modelo. En el motor de ventanas significa
// "había teclado o ratón": son dos cosas distintas y no deben sumarse sin
// distinguirlas, de ahí `source`.
const existingColumns = new Set(db.all('PRAGMA table_info(snapshots)').map((c) => c.name));
if (!existingColumns.has('idle_seconds')) {
  db.exec('ALTER TABLE snapshots ADD COLUMN idle_seconds INTEGER');
}
if (!existingColumns.has('source')) {
  db.exec("ALTER TABLE snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'vision'");
}

const insertSnapshot = db.prepare(`
  INSERT INTO snapshots (captured_at, screenshot, app, task, productive, confidence, raw_analysis, idle_seconds, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getSnapshotsByDate = db.prepare(`
  SELECT * FROM snapshots WHERE date(captured_at) = ? ORDER BY captured_at ASC
`);
const upsertDailyReport = db.prepare(`
  INSERT INTO daily_reports (report_date, total_minutes, prod_minutes, summary, sent_to_slack)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(report_date) DO UPDATE SET
    total_minutes = excluded.total_minutes,
    prod_minutes  = excluded.prod_minutes,
    summary       = excluded.summary,
    sent_to_slack = excluded.sent_to_slack
`);
const getReport = db.prepare(`SELECT * FROM daily_reports WHERE report_date = ?`);

export const saveSnapshot = (d) => insertSnapshot.run([
  d.captured_at, d.screenshot, d.app, d.task, d.productive, d.confidence, d.raw_analysis,
  d.idle_seconds ?? null, d.source ?? 'vision',
]);
export const getSnapshotsForDate = (date) => getSnapshotsByDate.all([date]);
export const saveDailyReport = (d) => upsertDailyReport.run([
  d.report_date, d.total_minutes, d.prod_minutes, d.summary, d.sent_to_slack,
]);
export const getReportForDate = (date) => getReport.get([date]);
export default db;
