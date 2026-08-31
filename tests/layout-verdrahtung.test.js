// Kein Verweis auf einen Behälter, den es nicht gibt.
//
// Der Fehler, der monatelang unsichtbar blieb: der Layout-Editor suchte
// #visual-editor-container-desktop, das Markup hatte diesen Behälter nicht
// mehr. Der Zugriff war ordentlich mit `if (container)` abgesichert — und
// genau deshalb fiel nichts auf. Der Editor wurde nie gezeichnet, das
// Rasterformular in den Einstellungen schrieb Werte, die niemand las, und wer
// 6×12 einstellte, sah weiter sechs Zonen.
//
// Der bestehende Test „keine Verdrahtung bricht an einem fehlenden Element ab"
// prüft die andere Hälfte: dass ein fehlendes Element nicht den Startpfad
// abreißt. Beides zusammen deckt den Fall ab — abgesichert UND vorhanden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WEBUI = path.join(ROOT, 'src/webui/public');

const SKRIPTE = [
  'app.js', 'control.js', 'privacy.js', 'screen.js',
  'module-browser.js', 'zone-editor.js', 'visual-editor.js', 'pwa.js', 'auth.js'
];

function quellen() {
  return SKRIPTE.map(name => ({ name, text: fs.readFileSync(path.join(WEBUI, name), 'utf8') }));
}

/** Alle Kennungen, die irgendwo entstehen: im Markup oder zur Laufzeit. */
function vorhandeneIds() {
  const ids = new Set();

  const html = fs.readFileSync(path.join(WEBUI, 'index.html'), 'utf8');
  for (const treffer of html.matchAll(/\bid="([^"]+)"/g)) ids.add(treffer[1]);

  // Zur Laufzeit erzeugte Elemente zählen genauso - der Editor baut seine
  // Werkzeugleiste selbst.
  for (const { text } of quellen()) {
    for (const treffer of text.matchAll(/\.id\s*=\s*['"]([^'"]+)['"]/g)) ids.add(treffer[1]);
    for (const treffer of text.matchAll(/\bid="([^"${]+)"/g)) ids.add(treffer[1]);
    for (const treffer of text.matchAll(/\bid='([^'${]+)'/g)) ids.add(treffer[1]);
  }

  return ids;
}

test('jede gesuchte Kennung gibt es auch', () => {
  const ids = vorhandeneIds();
  const offen = [];

  for (const { name, text } of quellen()) {
    text.split('\n').forEach((zeile, index) => {
      if (/^\s*(\/\/|\*)/.test(zeile)) return;   // Kommentare

      for (const treffer of zeile.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const gesucht = treffer[1];
        if (ids.has(gesucht)) continue;
        offen.push(`  ${name}:${index + 1}  #${gesucht}`);
      }
    });
  }

  assert.deepEqual(
    offen, [],
    'Diese Behälter werden gesucht, aber nirgends angelegt. Der Zugriff ist\n'
    + 'vermutlich mit if (…) abgesichert und tut deshalb einfach nichts:\n'
    + offen.join('\n')
  );
});

test('der Layout-Editor hat einen Behälter im Markup', () => {
  const html = fs.readFileSync(path.join(WEBUI, 'index.html'), 'utf8');

  // Die beiden Ansichten des Layout-Reiters. Fehlt eine, ist der zugehörige
  // Modusknopf ein Knopf ohne Wirkung.
  assert.match(html, /id="visual-editor-container"/, 'das freie Raster hat keinen Behälter');
  assert.match(html, /id="zonen-editor"/, 'der Zonen-Editor hat keinen Behälter');

  for (const modus of ['zonen', 'raster']) {
    assert.match(
      html,
      new RegExp(`data-modus="${modus}"`),
      `der Schalter für "${modus}" fehlt`
    );
  }
});

test('das Rasterformular wirkt auf den Editor, den es meint', () => {
  const app = fs.readFileSync(path.join(WEBUI, 'app.js'), 'utf8');

  // Das Formular schrieb gridSettings, und niemand zeichnete danach neu.
  const speichern = app.slice(app.indexOf('save-grid-settings-btn'));
  assert.match(
    speichern.slice(0, 3000),
    /renderPreview\(\)/,
    'nach dem Speichern der Rastereinstellungen wird nicht neu gezeichnet'
  );
});


test('der Kanal haengt nicht am Cookie allein', () => {
  const client = fs.readFileSync(path.join(WEBUI, 'ws-client.js'), 'utf8');
  const hub = fs.readFileSync(path.join(ROOT, 'src/main/wsHub.js'), 'utf8');

  // iOS Safari schickt den Sitzungs-Cookie beim WebSocket-Upgrade nicht mit,
  // wenn die Oberfläche als App auf dem Startbildschirm liegt. Am Gerät hing
  // dann dauerhaft „Keine Verbindung zum Spiegel" und nichts ließ sich
  // speichern - während HTTP tadellos funktionierte.
  assert.match(client, /\/api\/auth\/ws-ticket/, 'der Client holt keine Eintrittskarte');
  assert.match(client, /\?ticket=/, 'die Karte landet nicht in der Adresse');
  assert.match(hub, /consumeWsTicket/, 'der Server nimmt keine Karte an');

  // Und eine Spur, wenn es trotzdem klemmt: vorher sah man nur das Band.
  assert.match(hub, /console\.warn\('\[ws\] abgewiesen/);
});

test('zwei Knoepfe heissen nicht gleich', () => {
  const zonenEditor = fs.readFileSync(path.join(WEBUI, 'zone-editor.js'), 'utf8');
  const html = fs.readFileSync(path.join(WEBUI, 'index.html'), 'utf8');

  // Im Layout-Reiter standen „Live Preview" und „Live Preview" nebeneinander:
  // einer blendet die Vorschau ein, der andere geht auf Vollbild.
  assert.match(html, /id="toggle-live-view"[^>]*data-i18n="livePreview"/s);
  assert.match(zonenEditor, /text\('fullscreen'/, 'der Vollbild-Knopf heisst noch anders');
});

test('der Kopf liegt nicht unter der Statusleiste', () => {
  const css = fs.readFileSync(path.join(WEBUI, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(WEBUI, 'index.html'), 'utf8');

  // viewport-fit=cover laesst die Seite unter die Statusleiste laufen. Ohne
  // Abstand lag die Ueberschrift auf dem iPhone auf der Uhrzeit.
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /padding-top:\s*calc\(15px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /padding-bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom\)\)/);
});
