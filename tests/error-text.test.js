const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { humanError } = require(path.join(ROOT, 'src/renderer/errorText.js'));

/**
 * Der Anlass: auf dem Spiegel stand „FEHLER: FETCH FAILED".
 *
 * Das ist die Meldung, die undici wirft, wenn ein `fetch` scheitert - roh
 * durchgereicht, englisch, in einer deutschen Oberfläche, an einer Wand im
 * Bad. Sie sagt niemandem, was los ist, und niemandem, was zu tun wäre.
 */

test('technische Meldungen werden zu Sätzen', () => {
  const faelle = [
    ['fetch failed', 'Keine Verbindung'],
    ['TypeError: Failed to fetch', 'Keine Verbindung'],
    ['getaddrinfo ENOTFOUND api.example.com', 'Keine Verbindung'],
    ['ConnectTimeoutError: Connect Timeout Error', 'Zeitüberschreitung'],
    ['AbortError', 'Zeitüberschreitung'],
    ['HTTP 401', 'Zugangsdaten abgelehnt'],
    ['HTTP 404', 'Nicht gefunden'],
    ['HTTP 429', 'Zu viele Anfragen'],
    ['HTTP 503', 'Dienst gestört']
  ];

  for (const [roh, erwartet] of faelle) {
    assert.equal(humanError(roh), erwartet, `"${roh}" wurde nicht übersetzt`);
  }
});

test('Unbekanntes wird nicht geraten', () => {
  // Eine erfundene Ursache wäre schlimmer als eine vage. Vage und wahr
  // schlägt konkret und falsch.
  assert.equal(humanError('Xyzzy 0x8004005'), 'Vorübergehend nicht verfügbar');
  assert.equal(humanError(''), 'Vorübergehend nicht verfügbar');
  assert.equal(humanError(null), 'Vorübergehend nicht verfügbar');
  assert.equal(humanError(undefined), 'Vorübergehend nicht verfügbar');
});

test('nichts Technisches sickert je durch', () => {
  const roh = [
    'fetch failed', 'ECONNREFUSED 10.0.0.1:443', 'AbortError: The operation was aborted',
    'TypeError: Cannot read properties of undefined', 'HTTP 500 Internal Server Error',
    'ETIMEDOUT', 'Xyzzy 0x8004005', 'undici socket hang up'
  ];

  for (const eingabe of roh) {
    const satz = humanError(eingabe);
    assert.doesNotMatch(
      satz, /HTTP|TypeError|Error:|[A-Z]{4,}|0x|:\d{2,}/,
      `"${eingabe}" -> "${satz}" enthält noch Technisches`
    );
    assert.ok(satz.length > 3, 'leerer Text hilft niemandem');
  }
});

test('Objekte, Fehler und Umschläge werden gleich behandelt', () => {
  assert.equal(humanError(new Error('fetch failed')), 'Keine Verbindung');
  assert.equal(humanError({ message: 'fetch failed' }), 'Keine Verbindung');
  assert.equal(humanError({ code: 'NOT_CONFIGURED' }), 'Noch nicht eingerichtet');
  assert.equal(humanError({ status: 401 }), 'Zugangsdaten abgelehnt');
});

test('Englisch bleibt möglich', () => {
  assert.equal(humanError('fetch failed', 'en'), 'No connection');
  assert.equal(humanError('Xyzzy', 'en'), 'Temporarily unavailable');
});

// Der eigentliche Wächter: kein Modul darf eine rohe Meldung anzeigen.
test('kein Modul schreibt error.message in die Anzeige', () => {
  const verdaechtig = [];

  for (const name of fs.readdirSync(path.join(ROOT, 'modules'))) {
    const datei = path.join(ROOT, 'modules', name, 'index.js');
    if (!fs.existsSync(datei)) continue;

    const quelle = fs.readFileSync(datei, 'utf8');
    for (const zeile of quelle.split('\n')) {
      // Anzeige heisst: in den DOM schreiben. In die Konsole darf alles.
      if (/console\./.test(zeile)) continue;
      if (!/innerHTML|textContent|insertAdjacentHTML/.test(zeile)) continue;
      if (/\$\{[^}]*\b(lastError|error\.message|err\.message|error\b)[^}]*\}/.test(zeile)) {
        verdaechtig.push(`  ${name}: ${zeile.trim().slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    verdaechtig, [],
    'Diese Stellen schreiben eine rohe Fehlermeldung in die Anzeige.\n'
    + 'Stattdessen humanError() benutzen:\n' + verdaechtig.join('\n')
  );
});
