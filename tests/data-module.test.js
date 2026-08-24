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

function build(envelope = null) {
  const module = new Demo({});
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

  const status = module.container.querySelector('.dm-status').textContent;
  assert.equal(status, 'Keine Verbindung');
  assert.doesNotMatch(status, /fetch|failed|error/i, 'die rohe Meldung ist durchgesickert');
  assert.ok(module.container.querySelector('.dm-error'));

  module.destroy();
});

test('auch ein unbekannter Fehler bleibt lesbar', () => {
  const module = build({ ok: false, error: { message: 'ECONNRESET xyz#42' } });

  const status = module.container.querySelector('.dm-status').textContent;
  assert.doesNotMatch(status, /ECONNRESET|#42/, 'Technisches ist durchgesickert');
  assert.ok(status.length > 0, 'es muss trotzdem etwas dastehen');

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
