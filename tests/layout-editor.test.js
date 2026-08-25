const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
const QUELLE = fs.readFileSync(
  path.join(ROOT, 'src/webui/public/visual-editor.js'), 'utf8'
);

/**
 * Der Fehler, den erst das Gerät zeigte:
 *
 * Der Layout-Reiter war am Handy leer. Nicht schlecht gestaltet — leer.
 * Ursache war ein einziges Modul ohne `position`: der Editor las
 * `position.column`, warf „Cannot read properties of undefined" und brach
 * mitten im Aufbau ab. Ein frisch aktiviertes Modul hat noch keine Position,
 * das ist der Normalfall — hier legte es die ganze Ansicht lahm.
 *
 * Der Editor läuft im Browser und hängt an vielen DOM-Teilen. Geprüft wird
 * deshalb die eine Stelle, an der es zerbrach: die Positionsberechnung.
 */

function ladeEditor() {
  const exportiert = {};
  new Function('window', 'document', 'exports',
    QUELLE + '\nexports.VisualGridEditor = window.VisualGridEditor;'
  )(globalThis.window, globalThis.document, exportiert);

  return exportiert.VisualGridEditor;
}

function editorMitConfig(config) {
  const Klasse = ladeEditor();
  // Ohne Konstruktor: der zieht das halbe DOM heran. Geprüft wird die
  // Berechnung, nicht das Zeichnen.
  const editor = Object.create(Klasse.prototype);
  editor.config = config;
  editor.getGridSettings = () => config.gridSettings;
  return editor;
}

const RASTER = { columns: 8, rows: 10, gap: 12, padding: 16 };

test('ein Modul ohne Position bringt den Editor nicht zum Absturz', () => {
  const editor = editorMitConfig({
    gridSettings: RASTER,
    modules: [
      { module: 'clock', position: { column: 1, row: 1, columnSpan: 6, rowSpan: 2 } },
      { module: 'spotify' }   // genau der Fall vom Gerät: gar keine Position
    ]
  });

  const platz = editor.calculateModulePosition(undefined);

  assert.ok(platz, 'es kam keine Position zurück');
  assert.ok(platz.col >= 1 && platz.col <= RASTER.columns, 'Spalte außerhalb des Rasters');
  assert.ok(platz.row >= 1 && platz.row <= RASTER.rows, 'Zeile außerhalb des Rasters');
});

test('der freie Platz überlappt nichts Belegtes', () => {
  const editor = editorMitConfig({
    gridSettings: RASTER,
    // Die erste Zeile ist komplett belegt.
    modules: [{ module: 'clock', position: { column: 1, row: 1, columnSpan: 8, rowSpan: 1 } }]
  });

  const platz = editor.calculateModulePosition(null);
  assert.notEqual(platz.row, 1, 'das neue Modul landet auf einem belegten Feld');
});

test('ein volles Raster liefert trotzdem eine Position', () => {
  const module = [];
  for (let row = 1; row <= RASTER.rows; row++) {
    for (let col = 1; col <= RASTER.columns; col++) {
      module.push({ module: `m${row}-${col}`, position: { column: col, row } });
    }
  }

  const editor = editorMitConfig({ gridSettings: RASTER, modules: module });
  const platz = editor.calculateModulePosition(undefined);

  // Sichtbar und verschiebbar schlaegt unsichtbar - auch wenn es sich
  // ueberlappt.
  assert.ok(platz && platz.col === 1 && platz.row === 1);
});

test('vorhandene Positionen bleiben unangetastet', () => {
  const editor = editorMitConfig({ gridSettings: RASTER, modules: [] });
  const platz = editor.calculateModulePosition({
    column: 3, row: 4, columnSpan: 2, rowSpan: 3
  });

  assert.equal(platz.col, 3);
  assert.equal(platz.row, 4);
  assert.equal(platz.colSpan, 2);
  assert.equal(platz.rowSpan, 3);
});

test('der Editor speichert stretch, nicht start', () => {
  // Er zeichnet einen ausgefuellten Block. Mit 'start' schrumpfte das Modul
  // am Spiegel auf seinen Inhalt und sass in dessen Ecke.
  assert.doesNotMatch(
    QUELLE, /align:\s*'start'/,
    'der Editor speichert wieder start - dann stimmt der Spiegel nicht mehr mit ihm überein'
  );
  assert.match(QUELLE, /align:\s*'stretch'/);
});

const ZONEN_EDITOR = fs.readFileSync(
  path.join(ROOT, 'src/webui/public/zone-editor.js'), 'utf8'
);

/**
 * Der Fehler, den erst das Gerät zeigte: Ziehen tat nichts.
 *
 * setPointerCapture lief erst, nachdem acht Pixel Bewegung erkannt waren.
 * Bewegungsereignisse kommen aber nur, solange der Finger über dem Element
 * bleibt — bei einem Chip von 60 Pixeln ist man nach zwei Zentimetern
 * darüber hinaus. Das Ziehen begann deshalb nie.
 */
test('der Zeiger wird beim Druecken eingefangen, nicht erst bei Bewegung', () => {
  const block = ZONEN_EDITOR.slice(
    ZONEN_EDITOR.indexOf("addEventListener('pointerdown'"),
    ZONEN_EDITOR.indexOf('const bewegen =')
  );

  assert.match(
    block, /setPointerCapture/,
    'der Zeiger wird nicht schon beim Druecken eingefangen - dann bricht das '
    + 'Ziehen ab, sobald der Finger das Element verlaesst'
  );
});

test('die Acht-Pixel-Schwelle bleibt, sonst wird jeder Wackler zum Verschieben', () => {
  assert.match(ZONEN_EDITOR, /weit < 8/);
});

test('das Abbild wird in jedem Fall wieder entfernt', () => {
  // Bleibt es haengen, klebt ein Chip fuer immer auf dem Bildschirm.
  // Gezielt im Ziehen, nicht im Groessengriff - der hat kein Abbild.
  const ziehen = ZONEN_EDITOR.slice(ZONEN_EDITOR.indexOf('macheZiehbar(element, modulName)'));
  const block = ziehen.slice(ziehen.indexOf('const loslassen ='));
  assert.match(block.slice(0, 400), /geist\?\.remove\(\)/);
});

// Umgekehrte Entscheidung, aus einem Grund: der Entwurf war der Fehler.
// Wer ein Modul zog und auf den Spiegel sah, sah nichts - weil die Aenderung
// auf den Speichern-Knopf wartete - und hielt das Ziehen fuer kaputt.
// Ein Ablegen ist eine Absicht, kein Wackler; es darf durchschlagen.
test('ein Zonenwechsel wirkt sofort', () => {
  assert.match(ZONEN_EDITOR, /async zoneGewaehlt\(id\)/,
    'zoneGewaehlt speichert nicht mehr - dann wirkt der Wechsel nicht sofort');
  assert.match(ZONEN_EDITOR, /await this\.uebernimm\(/,
    'die Position wird nicht uebernommen');
  assert.doesNotMatch(ZONEN_EDITOR, /this\.entwurf/,
    'die Entwurfs-Mechanik ist zurueck - dann passiert beim Ziehen wieder nichts');
});

test('Groesse laesst sich einstellen und wirkt ebenfalls sofort', () => {
  assert.match(ZONEN_EDITOR, /async setzeGroesse\(name, colSpan, rowSpan\)/);
  assert.match(ZONEN_EDITOR, /static GROESSEN/, 'es gibt keine Groessen zur Auswahl');
});

// Größe per Griff: die Spanne ergibt sich aus der Zone unter dem Finger.
test('der Groessengriff rechnet die Spanne aus der Zielzone', () => {
  const block = ZONEN_EDITOR.slice(
    ZONEN_EDITOR.indexOf('macheGroessenGriff(griff, modulName)'),
    ZONEN_EDITOR.indexOf('zeigeSpanne(ursprung, spanne)')
  );

  assert.match(block, /ziel\.col - ursprung\.col \+ 1/, 'die Breite wird nicht gerechnet');
  assert.match(block, /ziel\.row - ursprung\.row \+ 1/, 'die Hoehe wird nicht gerechnet');
  // Nach links oder oben ziehen darf nicht in eine Groesse von null laufen.
  assert.match(block, /Math\.max\(1,/, 'die Spanne kann kleiner als eins werden');
});

test('waehrend des Ziehens ist zu sehen, was belegt wuerde', () => {
  assert.match(ZONEN_EDITOR, /zeigeSpanne\(ursprung, s\)/,
    'die betroffenen Zonen werden nicht hervorgehoben - dann zieht man blind');
});
