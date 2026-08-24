const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
// Im Spiegel liegt errorText.js als <script> vor DataModule. Hier dasselbe,
// damit der Test die echte Uebersetzung prueft und nicht die Rueckfallebene.
require(path.join(ROOT, 'src/renderer/errorText.js'));
const { DataModule } = require(path.join(ROOT, 'src/renderer/lib/DataModule.js'));

class Demo extends DataModule {
  static moduleName = 'demo';

  renderData(data, root) {
    root.textContent = '';
    const line = document.createElement('div');
    line.className = 'demo-value';
    line.textContent = String(data.value);
    root.appendChild(line);
  }
}

function build(envelope = null, config = {}) {
  const module = new Demo(config);
  if (envelope) module.applyEnvelope(envelope);
  module.render();
  return module;
}

test('ohne Daten erscheint ein Skelett statt eines leeren Kastens', () => {
  const module = build();
  const skeleton = module.container.querySelector('.dm-skeleton');

  assert.ok(skeleton, 'ein leerer Kasten ist von "kaputt" nicht zu unterscheiden');
  module.destroy();
});

test('mit Daten wird gezeichnet, was das Modul vorgibt', () => {
  const module = build({ ok: true, data: { value: 'hallo' }, fetchedAt: Date.now(), stale: false });
  assert.equal(module.container.querySelector('.demo-value').textContent, 'hallo');
  module.destroy();
});

// Ein leerer Spiegel ist schlechter als leicht veraltete Werte.
test('ein Fehler behält die zuletzt bekannten Daten', () => {
  const module = build({ ok: true, data: { value: 'alt' }, fetchedAt: Date.now(), stale: false });

  module.applyEnvelope({
    ok: false,
    error: { message: 'Netz weg' },
    fetchedAt: Date.now() - 600000
  });
  module.update();

  assert.equal(module.container.querySelector('.demo-value').textContent, 'alt');

  const status = module.container.querySelector('.dm-status');
  assert.equal(status.hidden, false, 'der Fehler muss trotzdem sichtbar sein');
  assert.match(status.textContent, /Nicht erreichbar/);

  module.destroy();
});

// Frueher stand hier die rohe Meldung. Auf dem Spiegel las sich das als
// "FEHLER: FETCH FAILED" - englischer Jargon aus den Innereien von undici,
// in einer deutschen Oberflaeche, im Badezimmer.
test('ein Fehler wird als Satz angezeigt, nie als rohe Meldung', () => {
  const module = build({ ok: false, error: { message: 'fetch failed' } });

  // Ohne Daten traegt die Flaeche die Meldung, nicht die Statuszeile.
  const notiz = module.container.querySelector('.dm-error').textContent;
  assert.equal(notiz, 'Keine Verbindung');
  assert.doesNotMatch(notiz, /fetch|failed|error/i, 'die rohe Meldung ist durchgesickert');

  module.destroy();
});

test('auch ein unbekannter Fehler bleibt lesbar', () => {
  const module = build({ ok: false, error: { message: 'ECONNRESET xyz#42' } });

  const notiz = module.container.querySelector('.dm-error').textContent;
  assert.doesNotMatch(notiz, /ECONNRESET|#42/, 'Technisches ist durchgesickert');
  assert.ok(notiz.length > 0, 'es muss trotzdem etwas dastehen');

  module.destroy();
});

test('eine fehlende Einrichtung wird als solche benannt', () => {
  const module = build({ ok: false, error: { message: 'x', code: 'NOT_CONFIGURED' } });
  assert.match(module.container.querySelector('.dm-error').textContent, /eingerichtet/);
  module.destroy();
});

// Ohne Kennzeichnung hält man einen zwei Stunden alten Wert für aktuell.
test('veraltete Daten werden gekennzeichnet', () => {
  const module = build({
    ok: true,
    data: { value: 'alt' },
    fetchedAt: Date.now() - 3 * 3600 * 1000,
    stale: true
  });

  const status = module.container.querySelector('.dm-status');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Stand von vor 3 h/);

  module.destroy();
});

test('frische Daten zeigen keine Statuszeile', () => {
  const module = build({ ok: true, data: { value: 1 }, fetchedAt: Date.now(), stale: false });
  assert.equal(module.container.querySelector('.dm-status').hidden, true);
  module.destroy();
});

// Ein fehlerhaftes Modul darf den Spiegel nicht mitreissen.
test('ein Fehler in renderData bringt das Modul nicht zum Absturz', () => {
  class Broken extends DataModule {
    static moduleName = 'broken';
    renderData() { throw new Error('kaputt'); }
  }

  const module = new Broken({});
  module.applyEnvelope({ ok: true, data: { value: 1 }, fetchedAt: Date.now() });

  assert.doesNotThrow(() => module.render());
  assert.match(module.container.querySelector('.dm-error').textContent, /Anzeige fehlgeschlagen/);

  module.destroy();
});

test('Altersangaben sind lesbar', () => {
  const module = new Demo({});
  const now = Date.now();

  assert.equal(module.formatAge(now), 'gerade eben');
  assert.equal(module.formatAge(now - 5 * 60000), 'vor 5 min');
  assert.equal(module.formatAge(now - 2 * 3600000), 'vor 2 h');
  assert.equal(module.formatAge(now - 3 * 86400000), 'vor 3 Tagen');
  assert.equal(module.formatAge(null), 'unbekannt');
});

test('Endpunkt und Bus-Thema leiten sich aus dem Namen ab', () => {
  const module = new Demo({});
  assert.equal(module.endpoint, '/api/demo/data');
  assert.equal(module.topic, 'data:demo');
});

test('destroy() räumt auf', () => {
  const module = build({ ok: true, data: { value: 1 }, fetchedAt: Date.now() });
  module.destroy();

  assert.equal(module.root, null);
  assert.equal(module.container, null);
  assert.doesNotThrow(() => module.update());
});

// Auf dem Spiegel stand "Not set up yet" direkt ueber "Noch nicht
// eingerichtet." - der Statuszeile war die Sprache bekannt, dem Platzhalter
// darunter nicht. Zwei Sprachen uebereinander, im selben Modul.
test('eine englische Anzeige enthaelt nichts Deutsches', () => {
  const module = build(
    { ok: false, error: { code: 'NOT_CONFIGURED', message: 'no key' } },
    { language: 'en' }
  );

  const text = module.container.textContent;
  assert.doesNotMatch(
    text, /eingerichtet|Nicht erreichbar|Stand von|gerade eben|unbekannt|Vorübergehend/,
    `deutscher Text in englischer Anzeige: "${text}"`
  );
  assert.match(text, /set up/i, 'der englische Text fehlt');

  // Und nur einmal: die Meldung steht in der Flaeche, die Statuszeile
  // schweigt dann. Sonst stand derselbe Satz zweimal untereinander.
  assert.equal(text.match(/set up/gi).length, 1, 'die Meldung steht doppelt');

  module.destroy();
});

test('Altersangaben folgen der Sprache', () => {
  const vorZwoelfMinuten = Date.now() - 12 * 60000;

  const de = build({ ok: true, stale: true, fetchedAt: vorZwoelfMinuten }, { language: 'de' });
  assert.match(de.container.textContent, /vor 12 min/);
  de.destroy();

  const en = build({ ok: true, stale: true, fetchedAt: vorZwoelfMinuten }, { language: 'en' });
  assert.match(en.container.textContent, /12 min ago/);
  en.destroy();
});
