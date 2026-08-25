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

// Der Fehler, der das schon einmal unbemerkt liess: die Zonen-Abfrage sass im
// Renderer in der falschen Funktion und wurde nie erreicht. Die Module
// standen dann automatisch nebeneinander - von aussen sah es aus, als kaeme
// die Zone nicht an.
test('eine Zone ergibt eine vollstaendige Platzierung', () => {
  const p = zonen.platzierung('oben-rechts');

  assert.ok(p, 'keine Platzierung');
  assert.equal(p.type, 'grid');
  // Mit Spannweite: eine Zone kann seit der Groessenwahl mehrere Felder
  // belegen, deshalb steht dort '3 / span 1' und nicht mehr nur '3'.
  assert.equal(p.gridColumn, '3 / span 1');
  assert.equal(p.gridRow, '1 / span 1');
  assert.equal(p.justifySelf, 'stretch', 'der Container muss seine Zone ausfüllen');
  assert.equal(p.zone, 'oben-rechts');
});

test('jede Zone laesst sich platzieren, und keine landet auf auto', () => {
  for (const z of zonen.ZONEN) {
    const p = zonen.platzierung(z.id);
    assert.ok(p, `${z.id}: keine Platzierung`);
    assert.notEqual(p.gridColumn, 'auto', `${z.id}: landet in der automatischen Reihe`);
    assert.notEqual(p.gridRow, 'auto', `${z.id}: landet in der automatischen Reihe`);
  }
});

test('Rasterangaben ergeben keine Zonen-Platzierung', () => {
  assert.equal(zonen.platzierung({ column: 2, row: 3 }), null);
  assert.equal(zonen.platzierung(undefined), null);
});

test('der Renderer benutzt die gemeinsame Platzierung', () => {
  const fs = require('node:fs');
  const quelle = fs.readFileSync(path.join(ROOT, 'src/renderer/renderer.js'), 'utf8');

  assert.match(quelle, /zonen\.platzierung\(position\)/,
    'der Renderer rechnet wieder selbst - dann kann es erneut in der falschen Funktion landen');
});

// Drehung: gehört zur Anzeige, nicht zum Inhalt.
test('nur die vier rechten Winkel sind erlaubt', () => {
  const fs = require('node:fs');
  const quelle = fs.readFileSync(path.join(ROOT, 'src/renderer/renderer.js'), 'utf8');

  assert.match(quelle, /\[0, 90, 180, 270\]/, 'die Liste der erlaubten Winkel fehlt');
  // Ein unbekannter Wert darf nicht als Drehung durchgereicht werden - sonst
  // steht der Spiegel schief und niemand weiss warum.
  assert.match(quelle, /erlaubt\.includes\(grad\) \? grad : 0/);
});

test('bei 90 und 270 Grad tauschen Breite und Hoehe', () => {
  const fs = require('node:fs');
  const css = fs.readFileSync(path.join(ROOT, 'src/renderer/styles/main.css'), 'utf8');

  const block = css.slice(css.indexOf('data-rotate="90"'));
  assert.match(block, /width:\s*100vh/, 'die Breite folgt nicht der Bildschirmhoehe');
  assert.match(block, /height:\s*100vw/, 'die Hoehe folgt nicht der Bildschirmbreite');
});

// Größe: sie darf nie über den Rand hinauswachsen, sonst ist das Modul
// teilweise oder ganz unsichtbar.
test('eine Groesse waechst nie ueber das Raster hinaus', () => {
  const p = zonen.platzierung({ zone: 'rechts', colSpan: 9, rowSpan: 9 });

  assert.equal(p.gridColumn, '3 / span 1', 'die rechte Spalte kann nicht breiter werden');
  assert.equal(p.gridRow, '2 / span 2', 'nach unten bleiben zwei Zeilen');
});

test('unsinnige Groessen werden zurechtgebogen statt uebernommen', () => {
  assert.deepEqual(zonen.groesse({ colSpan: 0, rowSpan: -3 }), { colSpan: 1, rowSpan: 1 });
  assert.deepEqual(zonen.groesse({ colSpan: 'zwei' }), { colSpan: 1, rowSpan: 1 });
  assert.deepEqual(zonen.groesse(undefined), { colSpan: 1, rowSpan: 1 });
});
