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
  const dateien = ['app.js', 'control.js', 'privacy.js', 'free-editor.js'];
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

/**
 * Englisch ist die Vorgabe, Deutsch bleibt wählbar.
 *
 * Wer schon eine Sprache gespeichert hat, behält sie - sonst stünde nach dem
 * Update eine deutsche Oberfläche plötzlich auf Englisch, ohne dass jemand
 * etwas eingestellt hätte.
 */
function spracheBeimStart(gespeichert) {
  const quelle = fs.readFileSync(path.join(WEBUI, 'i18n.js'), 'utf8');
  const exportiert = {};
  const stubStorage = { getItem: () => gespeichert, setItem: () => {} };
  const stubDocument = { querySelectorAll: () => [], addEventListener: () => {} };

  new Function('exports', 'localStorage', 'window', 'document',
    quelle + '\nexports.sprache = currentLanguage; exports.t = t;'
  )(exportiert, stubStorage, {}, stubDocument);

  return exportiert;
}

test('ohne gespeicherte Wahl startet die Oberfläche auf Englisch', () => {
  assert.equal(spracheBeimStart(null).sprache, 'en');
  assert.equal(spracheBeimStart('').sprache, 'en');
  assert.equal(spracheBeimStart('klingonisch').sprache, 'en', 'eine unbekannte Sprache fällt auf Englisch');
});

test('eine gespeicherte Sprache bleibt', () => {
  assert.equal(spracheBeimStart('de').sprache, 'de');
  assert.equal(spracheBeimStart('en').sprache, 'en');
});

test('Platzhalter werden eingesetzt, ein fehlender Schlüssel fällt auf Englisch', () => {
  const { t } = spracheBeimStart('de');
  assert.equal(t('moduleAdded', { name: 'Wetter' }), '✓ Wetter wurde hinzugefügt!');
  assert.equal(t('updateCommitsMany', { n: 3 }), '3 neue Commits');
  assert.equal(t('gibtEsNicht'), 'gibtEsNicht');
});

/**
 * Das Koppelfenster ist das Erste, was ein neues Gerät sieht - und lief
 * vollständig an der Übersetzung vorbei: „Spiegel koppeln", „Kopplung am
 * Spiegel starten", „Code vom Spiegel" standen fest in auth.js, auch in einer
 * englischen Oberfläche. Die Prüfung oben deckte nur index.html ab.
 */
test('das Koppelfenster zeigt keinen festen Text', () => {
  const quelle = fs.readFileSync(path.join(WEBUI, 'auth.js'), 'utf8');
  const vorlage = quelle.match(/root\.innerHTML = `([\s\S]*?)`;/);
  assert.ok(vorlage, 'die Vorlage des Koppelfensters ist nicht zu finden');

  // Was nach Entfernen aller Tags und eingesetzten Ausdrücke übrig bleibt,
  // ist sichtbarer Text, der an der Übersetzung vorbeiläuft.
  const rest = vorlage[1]
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter(wort => /[A-Za-zÄÖÜäöü]{3}/.test(wort));

  assert.deepEqual(rest, [], 'fester Text im Koppelfenster: ' + rest.join(' '));
});

test('jede Fehlerkennung der Anmeldung wird in der Oberfläche übersetzt', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src/main/auth.js'), 'utf8');
  const client = fs.readFileSync(path.join(WEBUI, 'auth.js'), 'utf8');
  const { de, en } = woerterbuecher();

  const kennungen = [...server.matchAll(/error\.code = '([A-Z_]+)'/g)].map(m => m[1]);
  assert.ok(kennungen.length >= 5, 'die Anmeldung meldet keine Kennungen mehr');

  for (const kennung of kennungen) {
    const zuordnung = client.match(new RegExp(`${kennung}: '([A-Za-z]+)'`));
    assert.ok(zuordnung, `${kennung} hat in src/webui/public/auth.js keinen Text`);
    assert.ok(de[zuordnung[1]] && en[zuordnung[1]], `${zuordnung[1]} fehlt in einem Wörterbuch`);
  }

  // Die Routen müssen die Kennung auch ausliefern.
  const main = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
  for (const route of ['/api/auth/pair/start', '/api/auth/pair/claim', '/api/auth/login']) {
    const start = main.indexOf(`'${route}'`);
    assert.ok(start > -1, `${route} fehlt`);
    const block = main.slice(start, main.indexOf('expressApp.', start));
    assert.match(block, /code: error\.code/, `${route} liefert die Kennung nicht aus`);
  }
});

/**
 * Ein Schlüssel, der in keinem Wörterbuch steht, fällt nicht auf: t() gibt
 * dann den Schlüssel selbst zurück, und auf dem Handy steht „authStartHint".
 */
test('jeder Schlüssel, den die Oberfläche benutzt, steht in beiden Wörterbüchern', () => {
  const { de, en } = woerterbuecher();
  const benutzt = new Map();
  const merke = (schluessel, wo) => { if (!benutzt.has(schluessel)) benutzt.set(schluessel, wo); };

  const html = fs.readFileSync(path.join(WEBUI, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) merke(m[1], 'index.html');

  const dateien = fs.readdirSync(WEBUI).filter(name => name.endsWith('.js') && name !== 'i18n.js');
  for (const name of dateien) {
    const quelle = fs.readFileSync(path.join(WEBUI, name), 'utf8');

    for (const m of quelle.matchAll(/\b(?:t|text)\(\s*'([A-Za-z][A-Za-z0-9]*)'/g)) merke(m[1], name);
    for (const m of quelle.matchAll(/dataset\.i18n(?:Aria|Title) = '([A-Za-z]+)'/g)) merke(m[1], name);

    // Schlüssel, die über eine Tabelle laufen (Fehlerkennungen, Zustände,
    // Privatsphäre-Modi).
    for (const tabelle of quelle.matchAll(/const (?:FEHLER|ZUSTAENDE|MODES) = [[{]([\s\S]*?)[\]}];/g)) {
      for (const m of tabelle[1].matchAll(/(?:^|[,{\s])(?:[A-Z_]+|[a-z_]+|label|hint): '([a-z][A-Za-z0-9]+)'/g)) {
        if (/^[a-z]+$/.test(m[1])) continue; // Kennungen wie 'normal', keine Schlüssel
        merke(m[1], name);
      }
    }
  }

  const fehlen = [...benutzt]
    .filter(([schluessel]) => !(schluessel in de) || !(schluessel in en))
    .map(([schluessel, wo]) => `  ${wo}: ${schluessel}`);

  assert.ok(benutzt.size > 100, `nur ${benutzt.size} Schlüssel gefunden - die Suche greift nicht mehr`);
  assert.deepEqual(fehlen, [], 'Diese Schlüssel stehen nicht in beiden Wörterbüchern:\n' + fehlen.join('\n'));
});

/**
 * Die Prüfung oben fängt nur `textContent = '…'`. Deutsche Sätze standen aber
 * auch in Vorlagen, in alert(), in Platzhaltern und in Tabellen. Diese hier
 * sucht nach dem, was man sieht: deutschen Wörtern in einer Zeichenkette.
 */
// Kurze Wörter wie „an", „aus", „zu" fehlen absichtlich: sie sind Englisch
// oder Klassennamen (classList.add('aus')).
const DEUTSCH = /[äöüÄÖÜß]|\b(?:der|die|das|und|nicht|nichts|ist|wird|wurde|keine?|kein|bitte|noch|jetzt|nur|zum|beim|einen?|mit|von|für|auf)\b/;

function deutscheZeichenketten(quelle) {
  const funde = [];
  let imKommentar = false;

  quelle.split('\n').forEach((roh, index) => {
    let zeile = roh;

    if (imKommentar) {
      const ende = zeile.indexOf('*/');
      if (ende === -1) return;
      imKommentar = false;
      zeile = zeile.slice(ende + 2);
    }
    if (/^\s*\/\*/.test(zeile) && !zeile.includes('*/')) { imKommentar = true; return; }
    if (/^\s*(\/\/|\*)/.test(zeile)) return;
    if (/console\.|logError|throw new Error/.test(zeile)) return;   // nicht sichtbar
    zeile = zeile.replace(/\s\/\/\s.*$/, '');                          // Kommentar am Zeilenende

    for (const m of zeile.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)) {
      const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
      if (/[A-Za-zäöü]{3}/.test(text) && DEUTSCH.test(text)) {
        funde.push(`${index + 1}  ${text.trim().slice(0, 60)}`);
      }
    }
  });

  return funde;
}

test('kein deutscher Text steht fest im JavaScript der Oberfläche', () => {
  const dateien = fs.readdirSync(WEBUI).filter(name => name.endsWith('.js') && name !== 'i18n.js');
  const offen = [];

  for (const name of dateien) {
    const quelle = fs.readFileSync(path.join(WEBUI, name), 'utf8');
    for (const fund of deutscheZeichenketten(quelle)) offen.push(`  ${name}:${fund}`);
  }

  assert.deepEqual(
    offen, [],
    'Diese Texte stehen fest im Code und bleiben deutsch, auch wenn die\n'
    + 'Oberfläche auf Englisch steht. Über t(...) führen:\n' + offen.join('\n')
  );
});

test('Attribute, die man sieht oder vorgelesen bekommt, laufen über die Übersetzung', () => {
  const html = fs.readFileSync(path.join(WEBUI, 'index.html'), 'utf8');
  const offen = [];

  for (const m of html.matchAll(/<[a-z]+\b[^>]*>/g)) {
    const tag = m[0];
    for (const [attribut, i18n] of [['aria-label', 'data-i18n-aria'], ['title', 'data-i18n-title'], ['placeholder', 'data-i18n-placeholder']]) {
      const wert = tag.match(new RegExp(`\\s${attribut}="([^"]*)"`));
      if (!wert || !/[A-Za-zÄÖÜäöü]{4}/.test(wert[1])) continue;
      if (tag.includes(`${i18n}=`)) continue;
      // Eigennamen sind keine Übersetzungsfälle.
      if (/^(Live|MagicMirror)/.test(wert[1])) continue;
      offen.push(`  ${attribut}="${wert[1]}"`);
    }
  }

  assert.deepEqual(offen, [], 'Ohne data-i18n-* bleibt das Attribut in seiner Sprache:\n' + offen.join('\n'));
});

test('die Seite ohne Verbindung und das App-Manifest sind englisch', () => {
  const offline = fs.readFileSync(path.join(WEBUI, 'offline.html'), 'utf8');
  assert.match(offline, /lang="en"/, 'offline.html hat keine englische Fassung');
  assert.match(offline, /localStorage\.getItem\('language'\)/, 'offline.html folgt der gewählten Sprache nicht');

  const manifest = JSON.parse(fs.readFileSync(path.join(WEBUI, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.lang, 'en');
  const texte = [manifest.description, ...manifest.shortcuts.map(s => s.name)];
  assert.deepEqual(texte.filter(text => DEUTSCH.test(text)), [], 'deutscher Text im App-Manifest');
});
