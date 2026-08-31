// Einbrennschutz für OLED-Panels.
//
// Ein Spiegel zeigt rund um die Uhr fast dasselbe Bild. Auf einem OLED heißt
// das ein bleibendes Nachbild - deshalb wandert der Inhalt, und deshalb lässt
// er sich nachts absenken.
//
// Geprüft wird hier vor allem, was man am Gerät erst nach Monaten sähe: dass
// der Versatz wirklich streut, dass er die Drehung nicht zerstört, und dass er
// nichts über den Rand schiebt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const schutz = require(path.join(ROOT, 'src/renderer/burnIn.js'));

const um = (stunde, minute = 0) => new Date(2026, 0, 15, stunde, minute, 0);

// --- Bildversatz ------------------------------------------------------------

test('der Versatz bleibt innerhalb der eingestellten Weite', () => {
  for (let schritt = 0; schritt < 40; schritt += 1) {
    const { x, y } = schutz.versatz(schritt, 8);
    assert.ok(Math.abs(x) <= 8, `x=${x} liegt außerhalb`);
    assert.ok(Math.abs(y) <= 8, `y=${y} liegt außerhalb`);
  }
});

test('der Versatz streut über die Fläche und bleibt im Mittel mittig', () => {
  const punkte = [];
  for (let schritt = 0; schritt < 12; schritt += 1) punkte.push(schutz.versatz(schritt, 8));

  const verschieden = new Set(punkte.map(p => `${p.x}:${p.y}`));
  assert.ok(verschieden.size >= 8, `nur ${verschieden.size} verschiedene Stellen - das streut nicht`);

  // Läge der Schwerpunkt daneben, wanderte das Bild insgesamt in eine Ecke.
  const mx = punkte.reduce((s, p) => s + p.x, 0) / punkte.length;
  const my = punkte.reduce((s, p) => s + p.y, 0) / punkte.length;
  assert.ok(Math.abs(mx) < 1, `Schwerpunkt x = ${mx}`);
  assert.ok(Math.abs(my) < 1, `Schwerpunkt y = ${my}`);
});

test('ohne Weite steht das Bild still', () => {
  assert.deepEqual(schutz.versatz(5, 0), { x: 0, y: 0 });
});

// Der Spiegel wird nach jedem Update neu gestartet. Ein mitgezählter Schritt
// finge dann wieder bei null an - bei mehreren Updates am Tag stünde der Inhalt
// öfter auf Schritt 0 als irgendwo sonst, also genau die Ungleichverteilung,
// gegen die der Versatz antritt.
test('der Schritt kommt aus der Uhrzeit und übersteht einen Neustart', () => {
  assert.equal(schutz.schrittFuer(um(9, 12), 5), schutz.schrittFuer(um(9, 12), 5));
  assert.notEqual(schutz.schrittFuer(um(9, 12), 5), schutz.schrittFuer(um(9, 22), 5));

  // Innerhalb desselben Takts bleibt es stehen.
  assert.equal(schutz.schrittFuer(um(9, 10), 5), schutz.schrittFuer(um(9, 14), 5));
});

// --- Nachtabsenkung ---------------------------------------------------------

test('ein Zeitraum über Mitternacht wird als einer erkannt', () => {
  assert.equal(schutz.istNacht(um(23, 30), '23:00', '06:30'), true);
  assert.equal(schutz.istNacht(um(2, 0), '23:00', '06:30'), true);
  assert.equal(schutz.istNacht(um(6, 29), '23:00', '06:30'), true);
  assert.equal(schutz.istNacht(um(6, 30), '23:00', '06:30'), false, 'die Grenze gehört zum Tag');
  assert.equal(schutz.istNacht(um(12, 0), '23:00', '06:30'), false);
});

test('ein Zeitraum innerhalb eines Tages funktioniert auch', () => {
  assert.equal(schutz.istNacht(um(14, 0), '13:00', '15:00'), true);
  assert.equal(schutz.istNacht(um(23, 0), '13:00', '15:00'), false);
});

test('unbrauchbare Zeiten senken nicht ab, statt zu raten', () => {
  // Gleiche Zeiten heißen nicht "immer" und nicht "nie" - sie heißen, dass
  // niemand etwas eingestellt hat. Ein Spiegel, der deshalb dauerhaft dunkel
  // wäre, sähe defekt aus.
  assert.equal(schutz.istNacht(um(3, 0), '23:00', '23:00'), false);
  assert.equal(schutz.istNacht(um(3, 0), 'abends', '06:30'), false);
  assert.equal(schutz.istNacht(um(3, 0), '25:00', '06:30'), false);
  assert.equal(schutz.istNacht(um(3, 0), null, undefined), false);
});

test('abgesenkt wird nur, wenn es eingeschaltet ist', () => {
  const e = schutz.einstellungen({
    display: { burnIn: { brightness: 1, night: false, nightBrightness: 0.4, nightFrom: '23:00', nightTo: '06:30' } }
  });

  assert.equal(schutz.helligkeitFuer(um(3, 0), e), 1, 'ausgeschaltet und trotzdem dunkel');
  assert.equal(schutz.helligkeitFuer(um(3, 0), { ...e, night: true }), 0.4);
  assert.equal(schutz.helligkeitFuer(um(12, 0), { ...e, night: true }), 1);
});

// --- Einstellungen ----------------------------------------------------------

test('ohne Angabe ist der Versatz an', () => {
  // Dieselbe Regel wie bei der Privatsphäre: die schützende Einstellung ist
  // die Vorgabe. Ein vergessenes Feld darf kein eingebranntes Panel ergeben.
  assert.equal(schutz.einstellungen(null).shift, true);
  assert.equal(schutz.einstellungen({}).shift, true);
  assert.equal(schutz.einstellungen({ display: { burnIn: { shift: false } } }).shift, false);
});

test('unsinnige Werte werden zurechtgebogen statt übernommen', () => {
  const e = schutz.einstellungen({
    display: { burnIn: { shiftRange: 900, shiftIntervalMinutes: 0, brightness: -3, nightBrightness: 'dunkel' } }
  });

  assert.equal(e.shiftRange, 24, 'ein Versatz von 900 Pixeln schöbe den halben Spiegel hinaus');
  assert.equal(e.shiftIntervalMinutes, 1, 'ein Takt von 0 wäre eine Endlosschleife');
  // Nie ganz dunkel: eine Anzeige, die aussieht wie ausgeschaltet, ist ein
  // Defekt und keine Einstellung.
  assert.equal(e.brightness, 0.15);
  assert.equal(e.nightBrightness, schutz.STANDARD.nightBrightness);
});

test('Oberfläche und Renderer gehen von denselben Vorgaben aus', () => {
  const zuhoerer = [];
  const dok = {
    documentElement: { dataset: {}, style: { setProperty() {} } },
    getElementById: () => null,
    addEventListener: (name, fn) => zuhoerer.push({ name, fn })
  };
  const fenster = {};
  new Function('window', 'document', lies('src/webui/public/screen.js'))(fenster, dok);

  assert.deepEqual(
    fenster.Bildschirm.SCHUTZ_STANDARD,
    schutz.STANDARD,
    'die Vorgaben in screen.js und burnIn.js sind auseinandergelaufen'
  );
});

// --- Verdrahtung ------------------------------------------------------------

test('der Versatz zerstört die Drehung nicht', () => {
  const css = lies('src/renderer/styles/main.css');
  const block = css.slice(css.indexOf('Einbrennschutz'), css.indexOf('Drehung des gesamten Spiegels'));

  // In transform sitzt bereits die Drehung. Eine zweite transform-Angabe würde
  // sie ersetzen - der Spiegel stünde wieder quer.
  assert.match(block, /translate:\s*var\(--mm-shift-x/, 'der Versatz läuft nicht über translate');
  assert.doesNotMatch(block, /transform:/, 'hier wird transform überschrieben');
});

test('der Versatz schiebt nichts über den Rand', () => {
  const css = lies('src/renderer/styles/main.css');

  // Ohne die Reserve schöbe der Versatz genau so viel Inhalt hinaus, wie er
  // wandert - am oberen Rand fehlten die obersten Pixel der Uhrzeit.
  assert.match(css, /padding:\s*calc\([^;]*--grid-padding[^;]*--mm-shift-reserve[^;]*\);/);

  const quelle = lies('src/renderer/burnIn.js');
  assert.match(quelle, /setze\(x, y, helligkeitFuer\(datum, aktuell\), weite\)/,
    'die Reserve folgt nicht der tatsächlichen Weite');
});

test('in der Vorschau wandert und dimmt nichts', () => {
  const quelle = lies('src/renderer/burnIn.js');

  // Ein wanderndes Bild sieht in der Vorschau nach einem Fehler aus, eine
  // nachts abgesenkte Vorschau nach einem kaputten Spiegel.
  assert.match(quelle, /dataset\.preview === '1'/);

  // Kein Versatz, keine Absenkung - aber die Randreserve bleibt. Sie gehört
  // zum Layout, und eine Vorschau, die anders umbricht als der Spiegel, ist
  // keine Vorschau.
  assert.match(quelle, /if \(inVorschau\(\)\) \{\s*\n\s*setze\(0, 0, 1, weite\);/);
});

test('der Einbrennschutz hängt am gemeinsamen Takt', () => {
  const quelle = lies('src/renderer/burnIn.js');
  const html = lies('src/renderer/index.html');

  // Kein eigener Timer: der Spiegel soll nicht ein zweites Mal aufwachen, nur
  // um alle fünf Minuten zwei Zahlen zu ändern.
  assert.doesNotMatch(quelle, /setInterval|setTimeout/);
  assert.match(quelle, /mmBus\.on\('tick:minute'/);

  // Nach clockTick.js geladen, sonst gibt es den Takt noch nicht.
  assert.ok(
    html.indexOf('burnIn.js') > html.indexOf('clockTick.js'),
    'burnIn.js wird vor clockTick.js geladen'
  );
});

test('der Renderer wendet den Schutz auch bei laufendem Spiegel an', () => {
  const quelle = lies('src/renderer/renderer.js');
  const treffer = quelle.match(/mmEinbrennschutz\?\.anwenden/g) || [];

  // Einmal im Komplettaufbau, einmal im Abgleich. Nur im Aufbau hieße: eine
  // Änderung wirkt erst nach einem Neustart des Spiegels.
  assert.equal(treffer.length, 2, 'der Schutz wird nicht an beiden Stellen angewandt');
});
