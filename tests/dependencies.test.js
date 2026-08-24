const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * Der Fehler, gegen den das hier steht:
 *
 * Der In-App-Updater ruft `npm ci --omit=dev`. Electron stand in
 * devDependencies - obwohl pm2 die App mit `electron .` startet und nichts
 * gepackt wird. Ein Update über die Web-Oberfläche hätte damit die Laufzeit
 * gelöscht: `git pull` läuft durch, `npm ci --omit=dev` räumt Electron weg,
 * der Neustart findet nichts mehr. Auf dem Dev-Rechner fällt das nie auf,
 * weil dort niemand mit --omit=dev installiert.
 */

const BUILTIN = /^node:/;
const RELATIVE = /^[./]/;

function collectRequires(dir, found = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectRequires(full, found);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;

    const source = fs.readFileSync(full, 'utf8');
    for (const match of source.matchAll(/require\(\s*'([^']+)'\s*\)/g)) {
      const name = match[1];
      if (BUILTIN.test(name) || RELATIVE.test(name)) continue;
      // Nur der Paketname, nicht der Unterpfad: 'ws/lib/x' -> 'ws'
      const scoped = name.startsWith('@');
      found.add(name.split('/').slice(0, scoped ? 2 : 1).join('/'));
    }
  }
  return found;
}

test('der Updater raeumt nicht weg, was zum Starten gebraucht wird', () => {
  const updater = fs.readFileSync(path.join(ROOT, 'src/main/updater.js'), 'utf8');
  if (!updater.includes('--omit=dev')) return; // dann ist die Falle zu

  const runtime = [
    ...collectRequires(path.join(ROOT, 'src')),
    ...collectRequires(path.join(ROOT, 'modules'))
  ];

  const dependencies = Object.keys(pkg.dependencies || {});
  const dev = Object.keys(pkg.devDependencies || {});

  const misplaced = runtime.filter(name => dev.includes(name) && !dependencies.includes(name));

  assert.deepEqual(
    misplaced, [],
    'Diese Pakete werden zur Laufzeit geladen, stehen aber in devDependencies.\n'
    + '`npm ci --omit=dev` im Updater loescht sie - nach dem naechsten Update\n'
    + 'startet der Spiegel nicht mehr: ' + misplaced.join(', ')
  );
});

test('electron ist eine Laufzeitabhaengigkeit, keine Entwicklungsabhaengigkeit', () => {
  // Nicht aus require() ableitbar: pm2 ruft `electron .` ueber das
  // start-Skript auf, kein Quelltext laedt es.
  assert.ok(
    pkg.scripts.start.includes('electron'),
    'Startskript benutzt kein electron mehr - dann darf dieser Test weg'
  );
  assert.ok(
    (pkg.dependencies || {}).electron,
    'electron gehoert in dependencies: pm2 startet damit, --omit=dev wuerde es loeschen'
  );
});

test('keine ungenutzte Abhaengigkeit fuer natives Uebersetzen', () => {
  const alle = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  assert.ok(
    !alle['@electron/rebuild'] && !alle['serialport'],
    'serialport/@electron/rebuild sind zurueck - dann braucht der Pi wieder '
    + 'einen Uebersetzer und die ABI-Frage ist zurueck'
  );
});
