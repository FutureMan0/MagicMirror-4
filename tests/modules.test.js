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
/**
 * Mein Test prüfte anfangs nur CSS und Manifest — der Zweig, der die Platte
 * tatsächlich baut, fehlte im Code, und niemand merkte es. Erst der Blick auf
 * den Spiegel zeigte es: umgestellt, gespeichert, weiter ein Quadrat.
 */
test('spotify baut die Platte wirklich', () => {
  const quelle = fs.readFileSync(path.join(MODULES_DIR, 'spotify/index.js'), 'utf8');

  assert.match(quelle, /coverStyle === 'vinyl'/,
    'es gibt keinen Zweig fuer die Schallplatte - die Einstellung waere wirkungslos');
  assert.match(quelle, /className = 'spotify-platte'/, 'die Platte wird nicht gebaut');
  assert.match(quelle, /className = 'spotify-tonarm'/, 'der Tonarm wird nicht gebaut');
  assert.match(quelle, /className = 'spotify-cover'/, 'das Quadrat ist verschwunden');
});

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

// Ein Modul soll genauer sagen koennen, was "leer" bedeutet.
test('spotify sagt, dass gerade nichts laeuft', () => {
  const quelle = fs.readFileSync(path.join(MODULES_DIR, 'spotify/index.js'), 'utf8');

  assert.match(quelle, /^\s*emptyText\(\)\s*\{/m,
    'emptyText ist keine Methode der Klasse - dann greift die Ueberschreibung nicht');
  assert.match(quelle, /Gerade läuft nichts/);
  assert.match(quelle, /Nothing playing/);
});

/**
 * Der Fehler, den die Live-Ansicht zeigte: „Cannot read properties of
 * undefined (reading 'temp')".
 *
 * Das Wetter-Modul holte seine Daten selbst aus dem Renderer, mit dem
 * API-Schlüssel in der URL. Über HTTP liefert der Server für Geheimnisse nur
 * „__SET__" — die Anfrage schlug fehl, und das Modul stolperte über die
 * Fehlerantwort. Deshalb blieb dort auch der Wetter-Effekt aus.
 */
test('weather fragt sein eigenes Backend, nicht OpenWeatherMap', () => {
  const frontend = fs.readFileSync(path.join(MODULES_DIR, 'weather/index.js'), 'utf8');

  assert.doesNotMatch(frontend, /api\.openweathermap\.org/,
    'der Renderer ruft wieder direkt bei OpenWeatherMap an - dann braucht er '
    + 'den Schluessel, und in der Live-Ansicht bleibt das Wetter leer');
  assert.match(frontend, /\/api\/weather\/data/, 'es fragt kein eigenes Backend');
});

test('weather: der Schluessel erreicht den Browser nicht', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(MODULES_DIR, 'weather/module.json'), 'utf8')
  );
  const schluessel = manifest.secrets.find(s => s.key === 'apiKey');

  assert.equal(schluessel.exposeToRenderer, false,
    'der API-Schluessel wird wieder an den Browser ausgeliefert');
});

test('kein Modul im Renderer ruft mehr fremde Hosts direkt an', () => {
  const offen = [];

  for (const name of fs.readdirSync(MODULES_DIR)) {
    const datei = path.join(MODULES_DIR, name, 'index.js');
    if (!fs.existsSync(datei)) continue;

    const quelle = fs.readFileSync(datei, 'utf8');
    for (const treffer of quelle.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
      // Verweise in Kommentaren sind in Ordnung - gemeint sind Abrufe.
      const zeile = quelle.slice(0, treffer.index).split('\n').pop();
      if (/^\s*(\/\/|\*)/.test(zeile)) continue;
      offen.push(`  ${name}: ${treffer[1]}`);
    }
  }

  assert.deepEqual(
    offen, [],
    'Diese Module rufen fremde Hosts direkt aus dem Browser an. Das braucht\n'
    + 'Geheimnisse im Renderer und scheitert in der Live-Ansicht:\n' + offen.join('\n')
  );
});

/**
 * Der Fehler, an dem die Schallplatte scheiterte: `coverStyle` stand in
 * `patchable`. Das heißt „lässt sich ohne Neuaufbau übernehmen" — das Modul
 * baut seinen Inhalt aber nur bei einem Titelwechsel auf. Umgestellt,
 * gespeichert, keine Wirkung.
 */
test('spotify erklaert keine Schluessel als patchable, die es nicht anwenden kann', () => {
  const quelle = fs.readFileSync(path.join(MODULES_DIR, 'spotify/index.js'), 'utf8');
  const treffer = quelle.match(/static patchable = \[([^\]]*)\]/);

  assert.ok(treffer, 'patchable fehlt');
  const schluessel = treffer[1].trim();

  assert.equal(schluessel, '',
    'Diese Schluessel aendern die Struktur der Anzeige. Ohne Neuaufbau '
    + 'passiert beim Umstellen nichts: ' + schluessel);
});
