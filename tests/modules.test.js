const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'modules');

const moduleNames = fs.readdirSync(MODULES_DIR)
  .filter(name => fs.existsSync(path.join(MODULES_DIR, name, 'module.json')));

test('es werden ueberhaupt Module gefunden', () => {
  assert.ok(moduleNames.length > 0, 'modules/ enthaelt kein einziges module.json');
});

for (const name of moduleNames) {
  test(`${name}: module.json ist gueltig und passt zum Ordnernamen`, () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(MODULES_DIR, name, 'module.json'), 'utf8')
    );
    assert.equal(manifest.name, name, 'name im Manifest muss dem Ordnernamen entsprechen');
    assert.ok(manifest.displayName, 'displayName fehlt');

    // Das Config-Schema treibt das Formular in der Web-UI. Ein unbekannter
    // Typ erzeugt dort stillschweigend ein kaputtes Feld.
    for (const [key, field] of Object.entries(manifest.config || {})) {
      assert.ok(
        ['string', 'number', 'boolean', 'array', 'object'].includes(field.type),
        `${name}.${key}: unbekannter Typ "${field.type}"`
      );
      assert.ok(field.description, `${name}.${key}: description fehlt`);
    }
  });

  test(`${name}: registriert sich in window.MagicMirrorModules`, () => {
    const before = Object.keys(global.window.MagicMirrorModules);
    delete require.cache[require.resolve(path.join(MODULES_DIR, name, 'index.js'))];
    require(path.join(MODULES_DIR, name, 'index.js'));
    const registered = global.window.MagicMirrorModules[name];

    assert.ok(
      registered,
      `${name} hat sich nicht registriert (vorher vorhanden: ${before.join(', ')})`
    );
    assert.equal(typeof registered, 'function', 'Registrierung muss eine Klasse sein');
    assert.equal(
      typeof registered.prototype.render, 'function',
      `${name} hat keine render()-Methode - der Loader zeigt dafuer einen Fehlerplatzhalter`
    );
  });
}

// Alle Module aus config.json muessen auch wirklich existieren. Ein Eintrag
// ohne Ordner ist stiller Ballast, der bei Secrets-Mappings mitgeschleppt wird.
test('config.json verweist nur auf vorhandene Module', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/config.json'), 'utf8'));
  const missing = (config.modules || [])
    .map(entry => entry.module)
    .filter(moduleName => !moduleNames.includes(moduleName));
  assert.deepEqual(missing, [], `config.json nennt Module ohne Ordner: ${missing.join(', ')}`);
});

// Die Schallplatte darf sich nicht drehen, wenn nichts spielt - eine Platte,
// die bei pausierter Musik weiterlaeuft, ist schlimmer als keine Animation.
test('spotify: die Platte dreht sich nur bei laufender Wiedergabe', () => {
  const quelle = fs.readFileSync(path.join(MODULES_DIR, 'spotify/index.js'), 'utf8');
  const css = fs.readFileSync(path.join(MODULES_DIR, 'spotify/styles.css'), 'utf8');

  assert.match(quelle, /classList\.toggle\('laeuft', Boolean\(data\.isPlaying\)\)/,
    'der Zustand der Wiedergabe steuert die Drehung nicht');

  const block = css.slice(css.indexOf('.spotify-platte {'), css.indexOf('.spotify-platte.laeuft'));
  assert.match(block, /animation-play-state:\s*paused/,
    'die Platte dreht sich von Anfang an, statt zu warten');
});

test('spotify: die Schallplatte ist eine Einstellung, kein Zwang', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(MODULES_DIR, 'spotify/module.json'), 'utf8')
  );

  const stil = manifest.config.coverStyle;
  assert.ok(stil, 'coverStyle fehlt im Manifest');
  assert.equal(stil.default, 'square', 'die Platte darf nicht die Vorgabe sein');
  assert.deepEqual(stil.options, ['square', 'vinyl']);
});

test('spotify: der Tonarm folgt dem Fortschritt', () => {
  const quelle = fs.readFileSync(path.join(MODULES_DIR, 'spotify/index.js'), 'utf8');

  assert.match(quelle, /--tonarm-winkel/, 'der Winkel wird nicht gesetzt');
  // Der Fortschritt darf den Arm nicht ueber die Platte hinausdrehen.
  const zeile = quelle.split('\n').find(z => z.includes('const winkel'));
  assert.ok(zeile, 'der Winkel wird nicht gerechnet');

  const rechnen = new Function('percent', zeile.replace('const winkel', 'let winkel') + '; return winkel;');
  const start = rechnen(0);
  const ende = rechnen(100);

  assert.ok(start < ende, 'der Arm wandert in die falsche Richtung');
  assert.ok(Math.abs(start) < 90 && Math.abs(ende) < 90, 'der Arm dreht ueber die Platte hinaus');
});
