#!/usr/bin/env node
/**
 * Baut native Module für Electrons ABI neu.
 *
 * `serialport` wird im **Hauptprozess** geladen (`modules/mmwave-presence/backend.js`).
 * Dort läuft Electrons eigenes Node mit einer anderen ABI-Version als das
 * System-Node — ein für System-Node gebautes Binding lässt sich dort nicht
 * laden.
 *
 * Das ist besonders tückisch, weil das Backend den Ladefehler abfängt und nur
 * eine Warnung schreibt: der Spiegel läuft weiter, der Sensor tut einfach
 * nichts. Vor dem Electron-Upgrade hat das nur durch ABI-Zufall funktioniert.
 *
 * Läuft als postinstall und darf die Installation nie zum Scheitern bringen:
 * auf einem Rechner ohne Build-Werkzeuge ist ein fehlendes serialport in
 * Ordnung — es ist eine optionale Abhängigkeit.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// In CI-Läufen, die nur Lint und Tests brauchen, ist Electron gar nicht da.
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1' || process.env.MM_SKIP_REBUILD === '1') {
  console.log('rebuild-native: übersprungen (ELECTRON_SKIP_BINARY_DOWNLOAD/MM_SKIP_REBUILD gesetzt).');
  process.exit(0);
}

if (!existsSync(path.join(ROOT, 'node_modules/serialport'))) {
  console.log('rebuild-native: serialport ist nicht installiert - nichts zu tun.');
  process.exit(0);
}

let rebuild;
let electronVersion;
try {
  ({ rebuild } = await import('@electron/rebuild'));
  electronVersion = require('electron/package.json').version;
} catch (error) {
  console.warn(`rebuild-native: übersprungen (${error.message}).`);
  process.exit(0);
}

console.log(`rebuild-native: baue serialport für Electron ${electronVersion} …`);

try {
  await rebuild({
    buildPath: ROOT,
    electronVersion,
    onlyModules: ['serialport', '@serialport/bindings-cpp'],
    force: true
  });
  console.log('rebuild-native: fertig.');
} catch (error) {
  // Bewusst kein Fehlerabbruch: ohne Build-Werkzeuge ist das erwartbar, und
  // der Spiegel läuft auch ohne Sensor.
  console.warn('rebuild-native: fehlgeschlagen -', error.message);
  console.warn('Der mmWave-Sensor bleibt dann stumm. Auf dem Pi hilft:');
  console.warn('  sudo apt-get install -y build-essential python3');
  console.warn('  npm rebuild && node scripts/rebuild-native.mjs');
}
