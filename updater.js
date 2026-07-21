const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

autoUpdater.logger = log;
log.transports.file.level = 'info';

autoUpdater.autoDownload = true;
// Install stays user-driven via the "Restart now" button (installUpdateNow),
// never silently on quit.
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;

// Checks GitHub Releases once and wires the two states the toolbar/popup
// UI cares about. Safe to call multiple times but main.js only does so once
// per launch. No-ops entirely when running unpacked (npm start), since
// there's no update feed (app-update.yml) in dev.
function initAutoUpdater(hooks) {
  if (!app.isPackaged) {
    log.info('[updater] skipping auto-update check in dev (not packaged)');
    return;
  }

  autoUpdater.on('checking-for-update', () => log.info('[updater] checking for update'));
  autoUpdater.on('update-not-available', () => log.info('[updater] no update available'));
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] update available:', info.version);
    hooks.onUpdateAvailable && hooks.onUpdateAvailable(info);
  });
  autoUpdater.on('download-progress', (p) => {
    log.info(`[updater] download progress: ${p.percent.toFixed(1)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] update downloaded:', info.version);
    hooks.onUpdateReady && hooks.onUpdateReady(info);
  });
  // Failures (no internet, no releases published yet, rate limiting, etc.)
  // are expected in normal operation -- log only, never surface to the user.
  autoUpdater.on('error', (err) => log.error('[updater] error:', err));

  autoUpdater.checkForUpdates().catch((err) => log.error('[updater] checkForUpdates failed:', err));
}

function installUpdateNow() {
  autoUpdater.quitAndInstall();
}

module.exports = { initAutoUpdater, installUpdateNow };
