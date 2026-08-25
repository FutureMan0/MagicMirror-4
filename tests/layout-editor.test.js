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
