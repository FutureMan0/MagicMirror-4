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
