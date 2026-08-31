// Größe und Schriftgröße je Modul.
//
// Beides sind Darstellungswerte des Kerns und liegen deshalb neben `config`,
// nicht darin. Läge es darin, entschiede onConfigChange darüber - und ohne
// onConfigChange hieße das Neuaufbau: die Uhr würde ihre Zeitzone neu holen,
// weil jemand am Schriftgrößen-Regler gezogen hat.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { diff, isEmpty } = require(path.join(ROOT, 'src/renderer/reconciler.js'));

const BASIS = {
  theme: 'minimal',
  language: 'de',
  gridSettings: { columns: 3, rows: 3 },
  modules: [
    { id: 'uhr', module: 'clock', enabled: true, config: { showDate: true }, position: { column: 1, row: 1 } },
    { id: 'wetter', module: 'weather', enabled: true, config: { city: 'Wien' }, position: { column: 2, row: 1 } }
  ]
};
const kopie = (wert) => JSON.parse(JSON.stringify(wert));

test('eine geänderte Größe baut kein Modul neu auf', () => {
  const next = kopie(BASIS);
  next.modules[0].appearance = { scale: 1.4, fontScale: 1 };

  const abgleich = diff(BASIS, next);

  assert.equal(isEmpty(abgleich), false, 'die Änderung darf nicht unter den Tisch fallen');
  assert.deepEqual(abgleich.restyled.map(r => r.key), ['uhr']);
  assert.equal(abgleich.patched.length, 0, 'das Modul selbst wird nicht angefasst');
  assert.deepEqual(abgleich.unchanged.map(u => u.key), ['wetter']);
});

test('Größe und Position ändern sich unabhängig voneinander', () => {
  const next = kopie(BASIS);
  next.modules[0].appearance = { scale: 1, fontScale: 0.8 };
  next.modules[0].position = { column: 3, row: 1 };

  const abgleich = diff(BASIS, next);

  // Verschoben UND umgefärbt: der Renderer muss beides tun, deshalb steht die
  // Darstellung als Merkmal am verschobenen Eintrag.
  assert.equal(abgleich.moved.length, 1);
  assert.equal(abgleich.moved[0].restyled, true);
  assert.equal(abgleich.restyled.length, 0, 'nicht doppelt melden');
});

test('unsinnige Faktoren werden zurechtgebogen statt übernommen', () => {
  const quelle = lies('src/renderer/renderer.js');

  // Die Konfiguration lässt sich auch von Hand schreiben. Ein Modul mit
  // Faktor 40 wäre nicht groß, sondern weg.
  assert.match(quelle, /function darstellungsFaktor/);
  assert.match(quelle, /Math\.min\(3, Math\.max\(0\.5,/);
  assert.match(quelle, /Number\.isFinite\(zahl\) \|\| zahl <= 0\) return 1/);
});

test('der Renderer setzt beide Faktoren am Rahmen', () => {
  const quelle = lies('src/renderer/renderer.js');

  assert.match(quelle, /setProperty\(\s*'--mm-modul-scale'/);
  assert.match(quelle, /setProperty\('--mm-font-scale'/);

  // Bei freier Platzierung ist die gezogene Fläche die Fläche: ein Zoom darauf
  // würde sie vergrößern und das Modul aus seiner Position schieben.
  assert.match(quelle, /freiPlatziert \? '1' :/);
  // Auch beim punktuellen Abgleich, nicht nur beim Komplettaufbau: sonst
  // wirkt der Regler erst nach einem Neustart des Spiegels.
  assert.match(quelle, /for \(const \{ key, entry \} of \(changes\.restyled \|\| \[\]\)\)/);
});

test('ein vergrößertes Modul tritt nicht aus seiner Rasterfläche heraus', () => {
  const css = lies('src/renderer/styles/main.css');

  assert.match(css, /zoom:\s*var\(--mm-modul-scale, 1\)/, 'die Größe läuft nicht über zoom');
  // Ohne die Division bezöge sich 100% auf die Rasterfläche in ungezoomten
  // Pixeln - ein vergrößertes Modul läge dann über seinem Nachbarn.
  assert.match(css, /max-height:\s*calc\(100% \/ var\(--mm-modul-scale, 1\)\)/);
  assert.match(css, /max-width:\s*calc\(100% \/ var\(--mm-modul-scale, 1\)\)/);
});

test('jede Schriftgröße lässt sich je Modul verstellen', () => {
  const tokens = lies('src/renderer/styles/tokens.css');
  const main = lies('src/renderer/styles/main.css');

  const stufen = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];

  for (const stufe of stufen) {
    assert.match(
      tokens,
      new RegExp(`--mm-size-${stufe}-quelle:`),
      `--mm-size-${stufe}-quelle fehlt - ohne Grundwert lässt sich nichts multiplizieren`
    );
    assert.match(
      main,
      new RegExp(`--mm-size-${stufe}:\\s*calc\\(var\\(--mm-size-${stufe}-quelle\\)\\s*\\* var\\(--mm-font-scale, 1\\)\\)`),
      `--mm-size-${stufe} wird am Modulrahmen nicht mit dem Faktor belegt`
    );
  }
});

// Der Faktor erreicht rem-Angaben nicht von selbst: rem hängt an der
// Wurzelschrift, nicht am Modul. Wer eine feste Größe schreibt, muss sie
// deshalb durchrechnen - sonst bleibt genau die große Uhrzeit stehen, die man
// eigentlich verstellen wollte.
test('kein Modul schreibt eine feste Schriftgröße am Faktor vorbei', () => {
  const modulordner = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true })
    .filter(e => e.isDirectory());

  const suender = [];

  for (const ordner of modulordner) {
    const datei = path.join('modules', ordner.name, 'styles.css');
    if (!fs.existsSync(path.join(ROOT, datei))) continue;

    const css = lies(datei);
    for (const zeile of css.split('\n')) {
      // em und % erben den bereits skalierten Wert des Elternteils - sie
      // dürfen den Faktor gerade NICHT noch einmal anwenden.
      if (/font-size:\s*[0-9.]+(rem|px|pt)\s*;/.test(zeile)) {
        suender.push(`${datei}: ${zeile.trim()}`);
      }
    }
  }

  assert.deepEqual(
    suender,
    [],
    'feste Schriftgrößen gehören in calc(… * var(--mm-font-scale, 1)) oder auf ein --mm-size-Token'
  );
});
