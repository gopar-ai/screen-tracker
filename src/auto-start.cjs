'use strict';

const { app } = require('electron');
const AutoLaunch = require('auto-launch');

// Inicialización lazy: app.getPath('exe') solo está disponible después de app.ready
let _autoLauncher = null;
function getAutoLauncher() {
  if (!_autoLauncher) {
    _autoLauncher = new AutoLaunch({
      name: 'Screen Tracker',
      path: app.getPath('exe'),
      isHidden: true,
    });
  }
  return _autoLauncher;
}

async function setupAutoStart() {
  // En modo desarrollo, electron.exe sería lo que se registra — omitir
  if (!app.isPackaged) {
    console.log('[Screen Tracker] Modo desarrollo: auto-inicio omitido');
    return;
  }

  try {
    const launcher = getAutoLauncher();
    const isEnabled = await launcher.isEnabled();
    if (!isEnabled) {
      await launcher.enable();
      console.log('[Screen Tracker] Auto-inicio al encender habilitado');
    }
  } catch (err) {
    console.error('[Screen Tracker] No se pudo configurar auto-inicio:', err.message);
  }
}

async function disableAutoStart() {
  try {
    await getAutoLauncher().disable();
    console.log('[Screen Tracker] Auto-inicio deshabilitado');
  } catch (err) {
    console.error('[Screen Tracker] Error al deshabilitar auto-inicio:', err.message);
  }
}

async function isAutoStartEnabled() {
  if (!app.isPackaged) return false;
  try {
    return await getAutoLauncher().isEnabled();
  } catch {
    return false;
  }
}

module.exports = { setupAutoStart, disableAutoStart, isAutoStartEnabled };
