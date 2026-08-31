// Der Konfigurator dreht sich mit der Anzeige.
//
// Steht das Panel hochkant an der Wand, zeigten die Vorschauen trotzdem ein
// liegendes Feld: man schob Module in eine Fläche, deren Form mit dem Spiegel
// nichts zu tun hatte, und sah das Ergebnis erst an der Wand.
//
// Gedreht wird dabei NICHT die Fläche. Der Renderer setzt den Inhalt bei 90
// und 270 Grad in ein hochkantes Feld und kippt erst dieses in den liegenden
// Bildspeicher; die Koordinaten sind damit schon Wandkoordinaten. Die
// Oberfläche muss sie nur im richtigen Format zeigen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** screen.js in einem eigenen Fenster laden - es hängt sich an `window`. */
function ladeOberflaeche(config) {
  const zuhoerer = new Map();
  const dok = {
    documentElement: global.document.documentElement,
    createElement: (tag) => global.document.createElement(tag),
    getElementById: () => null,
    addEventListener(name, fn) {
      if (!zuhoerer.has(name)) zuhoerer.set(name, []);
      zuhoerer.get(name).push(fn);
    },
    dispatchEvent(ereignis) {
      for (const fn of zuhoerer.get(ereignis.type) || []) fn(ereignis);
      return true;
    }
  };

  const fenster = { currentConfig: config, currentInstance: 'display1' };
  new Function('window', 'document', lies('src/webui/public/screen.js'))(fenster, dok);

  return { fenster, dok };
}

const MIT_DREHUNG = (grad) => ({
  display: { rotation: grad },
  gridSettings: { columns: 3, rows: 3 },
  modules: []
});

test('nur die vier rechten Winkel gelten, auch in der Oberfläche', () => {
  const { fenster } = ladeOberflaeche(MIT_DREHUNG(0));
  const { drehung } = fenster.Bildschirm;

  assert.equal(drehung(MIT_DREHUNG(90)), 90);
  assert.equal(drehung(MIT_DREHUNG(270)), 270);

  // Genau dieselbe Annahme wie im Renderer. Träfe die Oberfläche eine andere,
  // zeigte sie ein anderes Format als der Spiegel.
  assert.equal(drehung(MIT_DREHUNG(45)), 0, 'ein krummer Winkel fällt auf 0 zurück');
  assert.equal(drehung(MIT_DREHUNG('quer')), 0);
  assert.equal(drehung({}), 0, 'ohne Angabe wird nicht gedreht');
});

test('bei 90 und 270 Grad ist die Fläche hochkant', () => {
  for (const grad of [90, 270]) {
    const { fenster } = ladeOberflaeche(MIT_DREHUNG(grad));
    const v = fenster.Bildschirm.vorschau('display1');

    assert.equal(v.hochkant, true, `${grad}°: steht liegend`);
    assert.equal(v.format, '9 / 16');
    assert.equal(v.breite, 1080);
    assert.equal(v.hoehe, 1920);
  }
});

// 180 Grad sieht aus wie 0 Grad - und das ist richtig: ein um 180 Grad
// gedrehtes Panel mit um 180 Grad gedrehtem Inhalt steht wieder aufrecht.
test('bei 0 und 180 Grad bleibt die Fläche liegend', () => {
  for (const grad of [0, 180]) {
    const { fenster } = ladeOberflaeche(MIT_DREHUNG(grad));
    const v = fenster.Bildschirm.vorschau('display1');

    assert.equal(v.hochkant, false, `${grad}°: steht hochkant`);
    assert.equal(v.format, '16 / 9');
  }
});

test('eine geänderte Drehung erreicht die Editoren sofort', () => {
  const screenQuelle = lies('src/webui/public/screen.js');
  const freiQuelle = lies('src/webui/public/free-editor.js');
  const appQuelle = lies('src/webui/public/app.js');

  // Gemeldet wird vor dem Speichern: die Fläche soll sich sofort drehen und
  // nicht erst, wenn der Server geantwortet hat.
  const speichern = screenQuelle.slice(screenQuelle.indexOf('async function speichereDrehung'));
  assert.ok(
    speichern.indexOf('meldeDrehung()') < speichern.indexOf('await speichere'),
    'die Meldung kommt erst nach der Antwort des Servers'
  );

  assert.match(freiQuelle, /addEventListener\('mm:drehung'/);
  assert.match(appQuelle, /addEventListener\('mm:drehung'/);
});

test('jede Vorschau zeigt die Wand, nicht den Bildspeicher', () => {
  const screenQuelle = lies('src/webui/public/screen.js');
  const rendererQuelle = lies('src/renderer/renderer.js');

  // Eine Rechnung für alle Vorschauen. Vorher rechnete jede für sich mit
  // festen 1920×1080 - und zwei davon wurden beim Umbau schlicht vergessen.
  assert.match(screenQuelle, /breite: hoch \? 1080 : 1920/);
  assert.match(screenQuelle, /hoehe: hoch \? 1920 : 1080/);
  assert.match(screenQuelle, /format: hoch \? '9 \/ 16' : '16 \/ 9'/);
  assert.match(screenQuelle, /rotate=off/);

  // Der Renderer lässt seine eigene Drehung dort weg. Beides zugleich wäre die
  // zweite Drehung, und der Text läge quer.
  assert.match(rendererQuelle, /params\.get\('rotate'\) === 'off'/);
  assert.match(rendererQuelle, /drehungAus\s*\n?\s*\?\s*'0'/);
});

test('keine Vorschau rechnet mehr mit festen 1920 Pixeln', () => {
  for (const datei of [
    'src/webui/public/module-browser.js',
    'src/webui/public/zone-editor.js',
    'src/webui/public/free-editor.js',
    'src/webui/public/app.js'
  ]) {
    const quelle = lies(datei);
    assert.match(
      quelle,
      /Bildschirm\?\.(vorschau|richteVorschauAus)|Bildschirm\.richteVorschauAus/,
      `${datei} benutzt die gemeinsame Rechnung nicht`
    );
  }
});
