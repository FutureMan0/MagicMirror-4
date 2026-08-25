const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WEBUI = path.join(ROOT, 'src/webui/public');

/**
 * Auf dem Handy stand „Modules" neben „Uhr & Datum", „Settings" neben
 * „Privat", „Edit Mode: ON" neben „Speichern".
 *
 * Die Ursache war nicht ein fehlendes Übersetzungssystem — das gibt es —,
 * sondern Texte, die daran vorbeiliefen: fest im Markup oder fest im
 * JavaScript. Sie blieben in ihrer Sprache stehen, egal worauf die
 * Oberfläche eingestellt war.
 */

function woerterbuecher() {
  const quelle = fs.readFileSync(path.join(WEBUI, 'i18n.js'), 'utf8');
  const exportiert = {};
  const stubStorage = { getItem: () => 'de', setItem: () => {} };
  const stubDocument = { querySelectorAll: () => [], addEventListener: () => {} };

  new Function('exports', 'localStorage', 'window', 'document',
    quelle + '\nexports.translations = translations;'
  )(exportiert, stubStorage, {}, stubDocument);

  return exportiert.translations;
}

test('beide Sprachen kennen dieselben Schlüssel', () => {
  const { de, en } = woerterbuecher();
  const nurDe = Object.keys(de).filter(k => !(k in en));
  const nurEn = Object.keys(en).filter(k => !(k in de));

  assert.deepEqual(nurDe, [], 'diese Schlüssel fehlen auf Englisch: ' + nurDe.join(', '));
  assert.deepEqual(nurEn, [], 'diese Schlüssel fehlen auf Deutsch: ' + nurEn.join(', '));
});

test('kein Schlüssel ist in beiden Sprachen gleich geblieben', () => {
  const { de, en } = woerterbuecher();

  // Eigennamen und Zeichen duerfen gleich sein.
  // In beiden Sprachen tatsaechlich dasselbe Wort - kein Versehen.
  const erlaubt = new Set([
    'appTitle', 'appStore', 'spotify', 'github', 'gitea', 'unraid',
    'position', 'layout', 'themeOled', 'themeCyberpunk'
  ]);
  const verdaechtig = Object.keys(de).filter(k =>
    !erlaubt.has(k) && de[k] === en[k] && /[a-zA-ZäöüÄÖÜ]{4}/.test(de[k])
  );

  assert.deepEqual(
    verdaechtig, [],
    'Diese Einträge sind in beiden Sprachen identisch — vermutlich vergessen:\n  '
    + verdaechtig.map(k => `${k}: "${de[k]}"`).join('\n  ')
  );
});

test('kein sichtbarer Text im Markup läuft an der Übersetzung vorbei', () => {
  const html = fs.readFileSync(path.join(WEBUI, 'index.html'), 'utf8');
  const offen = [];

  const muster = /<(button|span|h[1-6]|label|div|p)\b([^>]*)>([^<>{}]{3,60})<\/\1>/g;
  for (const treffer of html.matchAll(muster)) {
    const [, tag, attribute, roh] = treffer;
    const text = roh.trim();

    if (!text || attribute.includes('data-i18n')) continue;
    if (text.includes('${') || text.startsWith('&')) continue;
    // Eigennamen und reine Zahlen sind keine Uebersetzungsfaelle.
    if (/^(MagicMirror|Display \d|Deutsch|English|OLED)/.test(text)) continue;
    if (!/[A-Za-zÄÖÜäöü]{3}/.test(text)) continue;

    const zeile = html.slice(0, treffer.index).split('\n').length;
    offen.push(`  index.html:${zeile}  <${tag}> ${text.slice(0, 40)}`);
  }

  assert.deepEqual(
    offen, [],
    'Diese Texte stehen fest im Markup und bleiben in ihrer Sprache stehen.\n'
    + 'data-i18n="..." ergänzen und den Schlüssel in i18n.js eintragen:\n' + offen.join('\n')
  );
});

test('kein sichtbarer Text wird fest aus JavaScript geschrieben', () => {
  const dateien = ['app.js', 'control.js', 'privacy.js', 'visual-editor.js'];
  const offen = [];

  for (const name of dateien) {
    const quelle = fs.readFileSync(path.join(WEBUI, name), 'utf8');

    quelle.split('\n').forEach((zeile, index) => {
      if (/^\s*(\/\/|\*)/.test(zeile)) return;          // Kommentare
      if (/console\.|logError|throw new Error/.test(zeile)) return;  // nicht sichtbar

      // Zuweisung an den DOM mit einem Literal, das echte Woerter enthaelt.
      const treffer = zeile.match(/(?:textContent|innerHTML)\s*=\s*'([^']{6,})'/);
      if (!treffer) return;

      const text = treffer[1];
      if (!/[A-Za-zÄÖÜäöü]{4}\s+[A-Za-zÄÖÜäöü]{3}/.test(text)) return; // mind. zwei Woerter
      if (/^\s*<(option|div|span)[^>]*>\s*$/.test(text)) return;        // reines Markup

      offen.push(`  ${name}:${index + 1}  "${text.slice(0, 50)}"`);
    });
  }

  assert.deepEqual(
    offen, [],
    'Diese Texte werden fest aus JavaScript geschrieben und folgen der\n'
    + 'eingestellten Sprache nicht. Über t(...) führen:\n' + offen.join('\n')
  );
});

/**
 * Der Fehler, den das Gerät zeigte: im Einstellungsdialog stand
 * „[object Object]" statt des Modulnamens.
 *
 * Ursache war die Zweisprachigkeit selbst — `displayName` darf seither
 * { de, en } sein, und sechs Stellen setzten das Objekt weiter direkt in
 * einen Text ein. JavaScript macht daraus wortwörtlich „[object Object]".
 */
test('kein Anzeigename wird ungefiltert in die Anzeige geschrieben', () => {
  const quelle = fs.readFileSync(path.join(WEBUI, 'app.js'), 'utf8');
  const offen = [];

  quelle.split('\n').forEach((zeile, index) => {
    if (/^\s*(\/\/|\*)/.test(zeile)) return;
    if (/function modulName/.test(zeile)) return;

    // Gemeint ist der Zugriff auf das Manifest (`.displayName`), nicht eine
    // Variable, die modulName() vorher schon aufgeloest hat.
    if (!/\.displayName\b/.test(zeile)) return;
    if (/modulName\(/.test(zeile)) return;

    const rendert = /(?:textContent|innerHTML)\s*=/.test(zeile)
      || /\$\{[^}]*\.displayName/.test(zeile)
      || /\.displayName\s*\|\|/.test(zeile);

    if (rendert) {
      offen.push(`  app.js:${index + 1}  ${zeile.trim().slice(0, 70)}`);
    }
  });

  assert.deepEqual(
    offen, [],
    'Hier landet displayName ungefiltert in der Anzeige. Ist es { de, en },\n'
    + 'steht dort „[object Object]". Über modulName(...) führen:\n' + offen.join('\n')
  );
});

/**
 * Der Fehler, der die halbe Oberfläche lahmlegte: nach einem Umbau des
 * Markups fehlte `save-settings-btn`. Der Aufruf
 * `getElementById(...).addEventListener(...)` warf, und alles danach im
 * Startpfad wurde nie verdrahtet — die Detailansicht ging deshalb nicht auf.
 */
test('keine Verdrahtung bricht an einem fehlenden Element ab', () => {
  const dateien = ['app.js', 'control.js', 'privacy.js', 'screen.js', 'module-browser.js'];
  const offen = [];

  for (const name of dateien) {
    const quelle = fs.readFileSync(path.join(WEBUI, name), 'utf8');
    quelle.split('\n').forEach((zeile, index) => {
      if (/getElementById\([^)]*\)\s*\.(addEventListener|style|value|classList)/.test(zeile)) {
        offen.push(`  ${name}:${index + 1}  ${zeile.trim().slice(0, 70)}`);
      }
    });
  }

  assert.deepEqual(
    offen, [],
    'Hier wird ohne Absicherung auf ein Element zugegriffen. Fehlt es nach\n'
    + 'einem Umbau, bricht der ganze Startpfad ab. ?. benutzen:\n' + offen.join('\n')
  );
});
