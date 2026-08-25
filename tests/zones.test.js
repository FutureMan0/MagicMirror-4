const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const zonen = require(path.join(ROOT, 'src/shared/zones.js'));

/**
 * Zonen statt freiem Raster.
 *
 * Der Anlass: der Layout-Editor bot ein 8×10-Raster an. Auf einem 390 Pixel
 * breiten Telefon sind das Zellen von 35 Pixeln — nicht bedienbar. Sieben
 * Zonen decken ab, was ein Spiegel an der Wand braucht.
 */

test('jede Zone hat eine Fläche und beide Sprachen', () => {
  assert.ok(zonen.ZONEN.length >= 6, 'zu wenige Zonen');

  for (const z of zonen.ZONEN) {
    assert.ok(z.id, 'Zone ohne Kennung');
    assert.ok(z.gridColumn && z.gridRow, `${z.id}: keine Rasterfläche`);
    assert.ok(z.label.de && z.label.en, `${z.id}: fehlende Übersetzung`);
    assert.notEqual(z.label.de, z.id, `${z.id}: Kennung als Beschriftung`);
  }
});

test('Kennungen sind eindeutig', () => {
  const ids = zonen.ZONEN.map(z => z.id);
  assert.equal(new Set(ids).size, ids.length, 'doppelte Zonen-Kennung');
});

test('alte Positionsnamen funktionieren weiter', () => {
  // Wer "top_left" in seiner Konfiguration stehen hat, soll nicht in einem
  // leeren Spiegel aufwachen.
  assert.equal(zonen.alsZone('top_left'), 'oben-links');
  assert.equal(zonen.alsZone('middle_center'), 'mitte');
  assert.equal(zonen.alsZone('bottom_right'), 'unten');

  for (const alt of Object.keys(zonen.ALTE_NAMEN)) {
    const ziel = zonen.alsZone(alt);
    assert.ok(zonen.zone(ziel), `${alt} zeigt auf eine Zone, die es nicht gibt`);
  }
});

test('Rasterangaben bleiben Rasterangaben', () => {
  // Wer Spalte und Zeile von Hand gesetzt hat, behaelt das.
  assert.equal(zonen.alsZone({ column: 3, row: 2 }), null);
  assert.equal(zonen.alsZone(undefined), null);
  assert.equal(zonen.alsZone('irgendwas'), null);
});

test('das Zonen-Raster passt zu den Zonen', () => {
  const raster = zonen.ZONEN_RASTER;
  assert.equal(raster.columnSizes.length, raster.columns);
  assert.equal(raster.rowSizes.length, raster.rows);

  for (const z of zonen.ZONEN) {
    // "1 / -1" ist volle Breite und immer gueltig.
    if (z.gridColumn.includes('/')) continue;
    const spalte = Number(z.gridColumn);
    assert.ok(spalte >= 1 && spalte <= raster.columns, `${z.id}: Spalte außerhalb`);
    assert.ok(Number(z.gridRow) >= 1 && Number(z.gridRow) <= raster.rows, `${z.id}: Zeile außerhalb`);
  }
});

test('jede Zone ist erreichbar - keine liegt hinter einer anderen', () => {
  const belegt = new Map();
  for (const z of zonen.ZONEN) {
    if (z.gridColumn.includes('/')) continue;
    const feld = `${z.gridColumn}:${z.gridRow}`;
    assert.ok(!belegt.has(feld), `${z.id} liegt auf derselben Fläche wie ${belegt.get(feld)}`);
    belegt.set(feld, z.id);
  }
});

test('zonenLabel folgt der Sprache', () => {
  assert.equal(zonen.zonenLabel('oben-links', 'de'), 'Oben links');
  assert.equal(zonen.zonenLabel('oben-links', 'en'), 'Top left');
  // Unbekanntes gibt die Kennung zurueck statt zu werfen.
  assert.equal(zonen.zonenLabel('gibtsnicht', 'de'), 'gibtsnicht');
});
