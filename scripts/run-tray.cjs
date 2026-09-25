'use strict';

// VSCode (y otros hosts basados en Electron) inyectan ELECTRON_RUN_AS_NODE=1
// en las terminales que abren. Si esa variable existe (con cualquier valor,
// incluso vacío), Electron arranca en modo "Node puro" en vez de como app GUI,
// y require('electron') devuelve solo la ruta del binario. Por eso hay que
// eliminarla (no solo vaciarla) antes de lanzar Electron.
delete process.env.ELECTRON_RUN_AS_NODE;

const path = require('path');
const { spawnSync } = require('child_process');
const electronPath = require('electron');

const result = spawnSync(electronPath, [path.join(__dirname, '..', 'src', 'tray.cjs')], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 0);
