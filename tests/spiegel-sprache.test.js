const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
// Wie im Spiegel: errorText.js liegt vor den Modulen.
const { uiText } = require(path.join(ROOT, 'src/renderer/errorText.js'));

const HomeAssistant = require(path.join(ROOT, 'modules/home-assistant/index.js'));
const Unraid = require(path.join(ROOT, 'modules/unraid/index.js'));
const Spotify = require(path.join(ROOT, 'modules/spotify/index.js'));
const Github = require(path.join(ROOT, 'modules/github/index.js'));

/**
 * Was der Spiegel zeigt, folgt `language` aus der Konfiguration. Englisch ist
 * die Vorgabe; Deutsch bleibt wählbar.
 *
 * Vorher standen am Spiegel feste deutsche Texte, auch wenn er auf Englisch
 * eingestellt war: „Zuhause" über einer Home-Assistant-Kachel, „3 offen" an
 * einem Repository, „Gerät koppeln" über dem QR-Code.
 */

const DEUTSCH = /[äöüÄÖÜß]|\b(?:Zuhause|offen|laufen|Belegt|Keine|keine|Noch|nicht|Gerade|eingetragen|gefunden)\b/;

function anzeige(Modul, sprache, envelope) {
  const modul = new Modul({ language: sprache });
  modul.applyEnvelope(envelope);
  modul.render();
  const text = modul.container.textContent;
  modul.destroy();
  return text;
}

test('die mitgelieferte Konfiguration steht auf Englisch', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/config.json'), 'utf8'));
  assert.equal(config.language, 'en');

  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  assert.match(html, /<html lang="en">/, 'ohne Konfiguration gilt die Sprache am <html>');
});

test('Home Assistant spricht die Sprache des Spiegels', () => {
  const daten = {
    ok: true,
    data: {
      total: 2,
      entities: [
        { name: 'Lamp', domain: 'light', state: 'on', available: true },
        { name: 'Blind', domain: 'cover', state: 'closed', available: true }
      ]
    }
  };

  const en = anzeige(HomeAssistant, 'en', daten);
  assert.match(en, /Home/);
  // Ohne Leerraum aneinandergereiht: Name, dann Zustand.
  assert.match(en, /Lampon/);
  assert.match(en, /Blindclosed/);
  assert.doesNotMatch(en, DEUTSCH, `deutscher Text in englischer Anzeige: "${en}"`);

  const de = anzeige(HomeAssistant, 'de', daten);
  assert.match(de, /Zuhause/);
  assert.match(de, /Lampan/);
  assert.match(de, /Blindzu/);

  const leer = anzeige(HomeAssistant, 'en', { ok: true, data: { total: 0, entities: [] } });
  assert.match(leer, /No entities listed yet/);
});

test('Unraid spricht die Sprache des Spiegels', () => {
  const daten = {
    ok: true,
    data: {
      array: { state: 'STARTED', percent: 40, usedGb: 4096, totalGb: 10240, disks: [] },
      docker: { running: 3, total: 5 },
      unavailable: [{ section: 'vms' }]
    }
  };

  const en = anzeige(Unraid, 'en', daten);
  assert.match(en, /Used/);
  assert.match(en, /3 \/ 5 running/);
  assert.match(en, /Unavailable: vms/);
  assert.doesNotMatch(en, DEUTSCH, `deutscher Text in englischer Anzeige: "${en}"`);

  const de = anzeige(Unraid, 'de', daten);
  assert.match(de, /3 \/ 5 laufen/);
  assert.match(de, /Nicht verfügbar: vms/);
});

test('GitHub und Gitea sprechen die Sprache des Spiegels', () => {
  const daten = {
    ok: true,
    data: {
      showStars: true,
      showOpenIssues: true,
      repos: [{ name: 'a/b', shortName: 'b', stars: 12, openIssues: 3, commits: [] }]
    }
  };

  const en = anzeige(Github, 'en', daten);
  assert.match(en, /3 open/);
  assert.match(en, /No commits found/);
  assert.doesNotMatch(en, DEUTSCH, `deutscher Text in englischer Anzeige: "${en}"`);

  assert.match(anzeige(Github, 'de', daten), /3 offen/);
  assert.match(anzeige(Github, 'en', { ok: true, data: { repos: [] } }), /No repositories listed/);
});

test('Spotify sagt auch ohne Titel in der richtigen Sprache, dass nichts läuft', () => {
  // ok, Daten vorhanden, aber kein Titel - das ist der Weg über renderData().
  const en = anzeige(Spotify, 'en', { ok: true, data: { track: null } });
  assert.match(en, /Nothing playing/);
  assert.doesNotMatch(en, DEUTSCH);
});

/**
 * Der Rahmen um die Module: Kopplung, Privatsphäre-Band, Platzhalter für ein
 * Modul, das nicht lädt, und die Ansicht ohne Konfiguration. Ihre Texte
 * stehen in errorText.js; die Dateien selbst enthalten keine mehr.
 */
test('jeder Rahmentext steht in beiden Sprachen in errorText.js', () => {
  const benutzt = new Set();
  const quellen = {
    'pairing.js': /\btext\('([A-Za-z]+)'/g,
    'privacy.js': /^\s+(?:guest|off): '([A-Za-z]+)'/gm,
    'moduleLoader.js': /rahmenText\('([A-Za-z]+)'/g,
    'renderer.js': /mmUiText\('([A-Za-z]+)'/g
  };

  for (const [datei, muster] of Object.entries(quellen)) {
    const quelle = fs.readFileSync(path.join(ROOT, 'src/renderer', datei), 'utf8');
    const funde = [...quelle.matchAll(muster)].map(m => m[1]);
    assert.ok(funde.length > 0, `${datei}: keine Rahmentexte gefunden - die Suche greift nicht mehr`);
    funde.forEach(schluessel => benutzt.add(schluessel));
  }

  for (const schluessel of benutzt) {
    const en = uiText(schluessel, 'en', { n: 1 });
    const de = uiText(schluessel, 'de', { n: 1 });
    assert.ok(en && de, `${schluessel} fehlt in errorText.js`);
    assert.notEqual(en, de, `${schluessel} ist in beiden Sprachen gleich`);
  }
});

test('die Rahmendateien des Spiegels enthalten keinen deutschen Text mehr', () => {
  const offen = [];

  for (const datei of ['pairing.js', 'privacy.js', 'moduleLoader.js']) {
    const quelle = fs.readFileSync(path.join(ROOT, 'src/renderer', datei), 'utf8');
    quelle.split('\n').forEach((zeile, index) => {
      if (/^\s*(\/\/|\*)/.test(zeile)) return;
      if (/console\.|new Error\(/.test(zeile)) return;   // nicht sichtbar
      for (const m of zeile.matchAll(/'([^']*)'|`([^`]*)`/g)) {
        const text = m[1] ?? m[2] ?? '';
        if (/[äöüÄÖÜß]|\b(?:nicht|keine?|Gerät|koppeln|Anzeige)\b/.test(text)) {
          offen.push(`  ${datei}:${index + 1}  ${text.slice(0, 50)}`);
        }
      }
    });
  }

  assert.deepEqual(offen, [], 'Fester deutscher Text am Spiegel:\n' + offen.join('\n'));
});

test('eine unbekannte Sprache fällt auf Englisch', () => {
  assert.equal(uiText('privacyOff', 'fr'), 'Display off');
  assert.equal(uiText('privacyOff', 'de'), 'Anzeige aus');
});
