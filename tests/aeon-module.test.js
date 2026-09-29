const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const aeon = require(path.join(ROOT, 'modules/aeon/backend.js'));

const { defaults, buildRequests, transform } = aeon._definition;
const config = (extra = {}) => ({ ...defaults, ...extra });

test('ohne gültige Adresse wird nichts angefragt', () => {
  assert.deepEqual(buildRequests(config({ cortexUrl: '' })), []);
  assert.deepEqual(buildRequests(config({ cortexUrl: 'cortex.local' })), []);
});

test('das Token geht als Bearer mit, sonst gar nichts', () => {
  const [plain] = buildRequests(config());
  assert.equal(plain.headers.Authorization, undefined);
  const [paired] = buildRequests(config({ token: 'abc' }));
  assert.equal(paired.headers.Authorization, 'Bearer abc');
  assert.match(buildRequests(config({ days: 99 }))[1].url, /days=7$/);
});

// Was aufs Handy ging oder vor Gästen zurückgehalten wurde, war nicht für
// den Flur gedacht.
test('nur was AEON laut gesagt hat, das Neueste zuerst', () => {
  const feed = { enabled: true, feed: [
    { at: '07:00', text: 'Guten Morgen.', outcome: 'said' },
    { at: '08:00', text: 'Privat.', outcome: 'pushed' },
    { at: '09:00', text: 'Der Bericht ist fertig.', outcome: 'said' }
  ] };
  const data = transform([feed, { enabled: true, entries: [] }], config({ maxSaid: 5 }));
  assert.deepEqual(data.said.map(s => s.text), ['Der Bericht ist fertig.', 'Guten Morgen.']);
});

test('Termine mit Uhrzeit, ganztägige ohne', () => {
  const now = new Date(2026, 8, 29, 7, 0);
  const calendar = { enabled: true, entries: [
    { start: new Date(2026, 8, 29, 9, 30).toISOString(), all_day: false, title: 'Zahnarzt' },
    { start: new Date(2026, 8, 30).toISOString(), all_day: true, title: 'Urlaub' }
  ] };
  const data = transform([{ enabled: true, feed: [] }, calendar], config(), now);
  assert.deepEqual(data.entries, [
    { day: 'heute', at: '09:30', title: 'Zahnarzt' },
    { day: 'morgen', at: null, title: 'Urlaub' }
  ]);
});

test('ein Cortex ohne Antwort ergibt eine leere, keine kaputte Anzeige', () => {
  const data = transform([null, null], config());
  assert.deepEqual(data, { said: [], entries: [], calendar: false, governor: false });
});
