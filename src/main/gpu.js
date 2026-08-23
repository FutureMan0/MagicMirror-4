const os = require('os');

/**
 * Chromium-/GPU-Flags für den Electron-Hauptprozess.
 *
 * Muss aufgerufen werden, BEVOR app.whenReady() auflöst - danach sind die
 * Schalter wirkungslos, weil Chromium bereits initialisiert ist.
 *
 * Bislang setzte das Projekt überhaupt keine Flags, obwohl die README eine
 * "GPU-Optimierung" versprach.
 */

// Grobes Profil der Maschine. 'low' schaltet im Renderer zusätzlich
// dekorative Effekte ab (siehe html[data-perf="low"] in main.css).
function detectPerfProfile() {
  if (process.env.MM_PERF_PROFILE) return process.env.MM_PERF_PROFILE;

  const isArmLinux = process.platform === 'linux' && /^arm/.test(process.arch);
  if (isArmLinux) return 'low';

  // Sehr wenig RAM oder sehr wenige Kerne: ebenfalls sparsam fahren.
  const gib = os.totalmem() / 1024 ** 3;
  if (gib < 4 || os.cpus().length <= 2) return 'low';

  return 'normal';
}

function applyGpuFlags(app, { profile = detectPerfProfile(), disableGpu = false } = {}) {
  if (disableGpu) {
    // Notlauf nach wiederholten GPU-Abstürzen.
    app.disableHardwareAcceleration();
    return profile;
  }

  // Timer im Kiosk-Betrieb nicht drosseln. Ohne das fallen Uhr und Polling
  // auf 1 Hz zurück, sobald Chromium das Fenster für verdeckt hält.
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

  if (process.platform === 'linux') {
    // Der VideoCore-Treiber des Pi steht auf Chromiums Blockliste, obwohl er
    // brauchbar beschleunigt.
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  if (profile === 'low') {
    app.commandLine.appendSwitch('num-raster-threads', '2');
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
  }

  return profile;
}

module.exports = { applyGpuFlags, detectPerfProfile };
