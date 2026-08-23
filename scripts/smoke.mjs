#!/usr/bin/env node
/**
 * Startprobe: fährt die App wirklich hoch?
 *
 * Bis hierher liefen über hundert Tests grün, ohne dass jemals jemand die
 * Anwendung gestartet hätte. Sie prüfen Logik und Verdrahtung - aber nicht,
 * ob Electron das Fenster öffnet, der Renderer lädt und jedes konfigurierte
 * Modul tatsächlich erscheint.
 *
 * Ablauf: Electron mit --smoke starten, auf die Ergebniszeile warten,
 * auswerten. Braucht einen Bildschirm - unter Linux also `xvfb-run`.
 *
 *   npm run smoke
 *   xvfb-run -a npm run smoke      # in CI
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const TIMEOUT_MS = parseInt(process.env.MM_SMOKE_TIMEOUT || '60000', 10);

let cleanup = () => {};

function fail(message, detail) {
  cleanup();
  console.error(`\nStartprobe fehlgeschlagen: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

let electronPath;
try {
  electronPath = require('electron');
} catch {
  fail('Electron ist nicht installiert. Zuerst `npm ci` ausführen.');
}

if (typeof electronPath !== 'string' || !existsSync(electronPath)) {
  fail(
    'Die Electron-Binärdatei fehlt.',
    'Das passiert, wenn das postinstall-Skript beim Installieren übersprungen wurde\n'
    + '(etwa durch ELECTRON_SKIP_BINARY_DOWNLOAD=1).'
  );
}

/**
 * Baut eine eigene Konfiguration, in der JEDES vorhandene Modul aktiv ist.
 *
 * Gegen die echte config.json zu testen hiesse, nur die Module zu pruefen, die
 * gerade jemand aktiviert hat - ein kaputtes, aber abgeschaltetes Modul fiele
 * erst beim Einschalten auf.
 */
function writeSmokeConfig() {
  const modulesDir = path.join(ROOT, 'modules');
  const names = readdirSync(modulesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(path.join(modulesDir, name, 'module.json')))
    .sort();

  const columns = 3;
  const rows = Math.max(1, Math.ceil(names.length / columns));

  const config = {
    language: 'de',
    theme: process.env.MM_SMOKE_THEME || 'default',
    gridSettings: {
      columns,
      rows,
      gap: 12,
      padding: 12,
      columnSizes: Array(columns).fill('1fr'),
      rowSizes: Array(rows).fill('1fr')
    },
    modules: names.map((name, index) => {
      const manifest = JSON.parse(readFileSync(path.join(modulesDir, name, 'module.json'), 'utf8'));

      // Standardwerte aus dem Schema uebernehmen - ein Modul soll mit dem
      // starten, was es selbst als sinnvoll angibt.
      const moduleConfig = {};
      for (const [key, field] of Object.entries(manifest.config || {})) {
        if (field.default !== undefined) moduleConfig[key] = field.default;
      }

      return {
        module: name,
        enabled: true,
        position: {
          column: (index % columns) + 1,
          row: Math.floor(index / columns) + 1,
          columnSpan: 1,
          rowSpan: 1
        },
        config: moduleConfig
      };
    })
  };

  const dir = path.join(ROOT, 'config/instances');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'smoke.json');
  writeFileSync(file, JSON.stringify(config, null, 2));

  return { file, names };
}

const { file: smokeConfigPath, names: moduleNames } = writeSmokeConfig();

cleanup = () => {
  try {
    rmSync(smokeConfigPath, { force: true });
  } catch {
    // Aufraeumen darf den Ausgang der Probe nicht beeinflussen.
  }
};

console.log(`Starte die App als Startprobe mit ${moduleNames.length} Modulen: ${moduleNames.join(', ')}`);

const child = spawn(
  electronPath,
  [ROOT, '--smoke', `--smoke-timeout=${TIMEOUT_MS - 5000}`, '--no-sandbox'],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      // Nicht in die echte .env schreiben und keine Anmeldung erzwingen:
      // die Probe prüft das Hochfahren, nicht die Zugangskontrolle.
      MM_AUTH: 'off',
      // Eigener Port, damit eine laufende Instanz nicht stört.
      CONFIG_PORT: process.env.MM_SMOKE_PORT || '31730',
      DEFAULT_INSTANCE: 'smoke'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  }
);

let stdout = '';
let stderr = '';
let resultLine = null;

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  stdout += text;

  for (const line of text.split('\n')) {
    if (line.startsWith('MM4_SMOKE_RESULT ')) {
      resultLine = line.slice('MM4_SMOKE_RESULT '.length).trim();
    }
  }
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const killTimer = setTimeout(() => {
  child.kill('SIGKILL');
  fail(
    `Die App hat sich nach ${TIMEOUT_MS} ms nicht gemeldet.`,
    `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
  );
}, TIMEOUT_MS);

child.on('error', (error) => {
  clearTimeout(killTimer);
  fail(`Electron liess sich nicht starten: ${error.message}`);
});

child.on('exit', (code, signal) => {
  clearTimeout(killTimer);

  if (!resultLine) {
    fail(
      `Die App endete ohne Ergebnis (Code ${code}, Signal ${signal}).`,
      `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`
    );
  }

  let result;
  try {
    result = JSON.parse(resultLine);
  } catch (error) {
    fail(`Ergebniszeile ist kein gültiges JSON: ${error.message}`, resultLine);
  }

  if (!result.ok) {
    const details = (result.failed || [])
      .map(entry => `  - ${entry.module}: ${entry.error}`)
      .join('\n');

    fail(
      result.message || `Grund: ${result.reason}`,
      `${details}\n\n--- stderr ---\n${stderr}`
    );
  }

  const missing = moduleNames.filter(name => !result.mounted.includes(name));
  if (missing.length > 0) {
    fail(
      `Diese Module sind gar nicht erst erschienen: ${missing.join(', ')}`,
      `--- stderr ---\n${stderr}`
    );
  }

  cleanup();
  console.log(`\nApp gestartet, Theme "${result.theme}".`);
  console.log(`Gemountete Module (${result.mounted.length}): ${result.mounted.join(', ')}`);
  console.log('Startprobe bestanden.');
});
