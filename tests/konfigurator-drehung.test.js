// Der Konfigurator dreht sich mit der Anzeige.
//
// Steht das Panel hochkant an der Wand, zeigte der Layout-Editor trotzdem ein
// liegendes Feld: man schob Module in ein Raster, dessen Form mit dem Spiegel
// nichts zu tun hatte, und sah das Ergebnis erst an der Wand.
//
// Gedreht wird dabei NICHT die Leinwand. Der Renderer setzt den Inhalt bei 90
// und 270 Grad in ein hochkantes Feld (100vh breit, 100vw hoch) und kippt erst
// dieses Feld in den liegenden Bildspeicher - die Rasterkoordinaten sind damit
// schon Wandkoordinaten. Der Editor muss sie nur im richtigen Format zeigen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * screen.js und den Layout-Editor in einem eigenen Fenster laden.
 *
 * Beide sind gewöhnliche Skripte ohne Export - sie hängen sich an `window`.
 * Ein eigenes Fenster je Test hält sie auseinander.
 */
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

  const exportiert = {};
  new Function('window', 'document', 'exports',
    lies('src/webui/public/visual-editor.js') + '\nexports.VisualGridEditor = window.VisualGridEditor;'
  )(fenster, dok, exportiert);

  // Ohne Konstruktor: der zieht das halbe DOM heran. Geprüft wird das Format,
  // nicht das Zeichnen.
  const editor = Object.create(exportiert.VisualGridEditor.prototype);
  editor.config = config;

  return { fenster, dok, editor };
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
  // zeigte der Editor ein anderes Format als der Spiegel.
  assert.equal(drehung(MIT_DREHUNG(45)), 0, 'ein krummer Winkel fällt auf 0 zurück');
  assert.equal(drehung(MIT_DREHUNG('quer')), 0);
  assert.equal(drehung({}), 0, 'ohne Angabe wird nicht gedreht');
});

test('bei 90 und 270 Grad zeigt der Editor ein hochkantes Feld', () => {
  for (const grad of [90, 270]) {
    const { editor } = ladeOberflaeche(MIT_DREHUNG(grad));
    const format = editor.leinwandFormat();

    assert.match(format, /aspect-ratio:\s*9\s*\/\s*16/, `${grad}°: das Feld steht nicht hochkant`);

    // Die Breite muss ausgerechnet sein. Die Leinwand ist ein Block-Element:
    // width:auto hieße dort "so breit wie der Platz", und aspect-ratio käme
    // dagegen nicht an - das Feld wäre wieder liegend.
    assert.match(format, /width:\s*calc\(/, `${grad}°: die Breite ist nicht ausgerechnet`);
    assert.doesNotMatch(format, /width:\s*auto/, `${grad}°: width:auto füllt die volle Breite`);

    // Die 500 bzw. 600 Pixel aus dem Stylesheet würden das Seitenverhältnis
    // sonst wieder aufheben.
    assert.match(format, /min-height:\s*0/, `${grad}°: min-height hebt das Format auf`);
  }
});

test('bei 0 und 180 Grad bleibt das Feld liegend', () => {
  for (const grad of [0, 180]) {
    const { editor } = ladeOberflaeche(MIT_DREHUNG(grad));
    const format = editor.leinwandFormat();

    assert.match(format, /aspect-ratio:\s*16\s*\/\s*9/, `${grad}°: das Feld steht nicht liegend`);
  }
});

// 180 Grad sieht aus wie 0 Grad - und das ist richtig so: ein um 180 Grad
// gedrehtes Panel mit um 180 Grad gedrehtem Inhalt steht wieder aufrecht.
test('der Editor dreht die Leinwand nicht selbst', () => {
  const { editor } = ladeOberflaeche(MIT_DREHUNG(90));

  assert.doesNotMatch(
    editor.leinwandFormat(),
    /rotate\(/,
    'eine gedrehte Leinwand wäre die zweite Drehung auf denselben Inhalt'
  );
});

test('eine geänderte Drehung erreicht Editor und Live-Ansicht sofort', () => {
  const editorQuelle = lies('src/webui/public/visual-editor.js');
  const appQuelle = lies('src/webui/public/app.js');
  const screenQuelle = lies('src/webui/public/screen.js');

  // Gemeldet wird vor dem Speichern: der Editor soll sich sofort drehen und
  // nicht erst, wenn der Server geantwortet hat.
  const speichern = screenQuelle.slice(screenQuelle.indexOf('async function speichereDrehung'));
  assert.ok(
    speichern.indexOf('meldeDrehung()') < speichern.indexOf('await fetch'),
    'die Meldung kommt erst nach der Antwort des Servers'
  );

  assert.match(editorQuelle, /addEventListener\('mm:drehung'/);
  assert.match(appQuelle, /addEventListener\('mm:drehung'/);
});

test('die Live-Ansicht zeigt die Wand, nicht den Bildspeicher', () => {
  const appQuelle = lies('src/webui/public/app.js');
  const rendererQuelle = lies('src/renderer/renderer.js');

  // Der Rahmen bekommt das Format des gedrehten Panels ...
  assert.match(appQuelle, /const breite = hoch \? MIRROR_HEIGHT : MIRROR_WIDTH/);
  assert.match(appQuelle, /const hoehe = hoch \? MIRROR_WIDTH : MIRROR_HEIGHT/);

  // ... und der Renderer lässt seine eigene Drehung dort weg. Beides zugleich
  // wäre die zweite Drehung, und der Text läge quer.
  assert.match(appQuelle, /rotate=off/);
  assert.match(rendererQuelle, /params\.get\('rotate'\) === 'off'/);
  assert.match(rendererQuelle, /drehungAus\s*\n?\s*\?\s*'0'/);
});
