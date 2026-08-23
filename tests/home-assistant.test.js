const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ha = require(path.join(ROOT, 'modules/home-assistant/backend.js'));

const { defaults, buildRequests, transform, actions, testConnection } = ha._definition;
const { ALLOWED_DOMAINS, ALLOWED_SERVICES, parseEntities } = ha._guards;

const config = (extra = {}) => ({ ...defaults, ...extra });
const READY = { baseUrl: 'http://ha.local:8123', token: 'geheim' };

test('ohne Adresse oder Token wird nichts angefragt', () => {
  assert.deepEqual(buildRequests(config({ token: 'x' })), []);
  assert.deepEqual(buildRequests(config({ baseUrl: 'http://ha.local' })), []);
});

// Einzelabfragen waeren bei zehn Entitaeten zehn Anfragen.
test('alle Entitäten kommen mit einem Abruf', () => {
  const requests = buildRequests(config({ ...READY, entities: 'light.a, light.b, sensor.c' }));

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/states$/);
  assert.equal(requests[0].headers.Authorization, 'Bearer geheim');
});

test('unbrauchbare Entitäts-Kennungen werden verworfen', () => {
  assert.deepEqual(
    parseEntities('light.wohnzimmer, kaputt, .leer, sensor.temp, LIGHT.GROSS'),
    ['light.wohnzimmer', 'sensor.temp']
  );
});

test('eine Liste von Objekten wird ebenfalls verstanden', () => {
  assert.deepEqual(
    parseEntities([{ entity_id: 'light.a' }, 'switch.b']),
    ['light.a', 'switch.b']
  );
});

test('transform nimmt nur die konfigurierten Entitäten', () => {
  const states = [
    { entity_id: 'light.a', state: 'on', attributes: { friendly_name: 'Stehlampe' } },
    { entity_id: 'light.ungefragt', state: 'on', attributes: {} },
    { entity_id: 'sensor.temp', state: '21.5', attributes: { unit_of_measurement: '°C' } }
  ];

  const result = transform([states], config({ ...READY, entities: 'light.a, sensor.temp' }));

  assert.equal(result.entities.length, 2);
  assert.equal(result.entities[0].name, 'Stehlampe', 'der sprechende Name ist nützlicher');
  assert.equal(result.entities[1].unit, '°C');
});

test('eine unbekannte Entität wird als nicht verfügbar gemeldet', () => {
  const result = transform([[]], config({
    ...READY, entities: 'light.gibtesnicht', showUnavailable: true
  }));

  assert.equal(result.entities[0].available, false);
  assert.equal(result.entities[0].state, 'unbekannt');
});

test('nicht erreichbare Entitäten werden standardmässig ausgeblendet', () => {
  const states = [{ entity_id: 'light.a', state: 'unavailable', attributes: {} }];

  assert.equal(transform([states], config({ ...READY, entities: 'light.a' })).entities.length, 0);
  assert.equal(
    transform([states], config({ ...READY, entities: 'light.a', showUnavailable: true })).entities.length,
    1
  );
});

test('die Oberfläche erfährt, ob Schalten erlaubt ist', () => {
  const states = [{ entity_id: 'light.a', state: 'on', attributes: {} }];

  assert.equal(transform([states], config({ ...READY, entities: 'light.a' })).controlEnabled, false);
  assert.equal(
    transform([states], config({ ...READY, entities: 'light.a', allowControl: true })).controlEnabled,
    true
  );
});

// --- Die drei Schranken --------------------------------------------------

function callWith(configExtra, body) {
  const calls = [];
  const request = async (req) => { calls.push(req); return { data: {} }; };
  return { calls, run: () => actions.call(body, { config: config(configExtra), request }) };
}

// Schranke 1: ohne ausdrueckliche Freigabe geht gar nichts.
test('ohne allowControl wird nicht geschaltet', async () => {
  const { run, calls } = callWith(
    { ...READY, entities: 'light.a' },
    { entityId: 'light.a', service: 'toggle' }
  );

  await assert.rejects(run, /nicht eingeschaltet/);
  assert.equal(calls.length, 0, 'es wurde trotzdem eine Anfrage gestellt');
});

// Schranke 2: nur was der Nutzer selbst eingetragen hat.
test('eine nicht eingetragene Entität wird abgelehnt', async () => {
  const { run, calls } = callWith(
    { ...READY, entities: 'light.a', allowControl: true },
    { entityId: 'light.fremd', service: 'toggle' }
  );

  await assert.rejects(run, /steht nicht in der konfigurierten Liste/);
  assert.equal(calls.length, 0);
});

// Schranke 3: die wichtigste. Sie steht im Code, nicht in der Konfiguration.
test('gefährliche Gattungen lassen sich nicht schalten, auch nicht eingetragen', async () => {
  for (const entityId of ['lock.haustuer', 'alarm_control_panel.haus', 'homeassistant.stop']) {
    const { run, calls } = callWith(
      { ...READY, entities: entityId, allowControl: true },
      { entityId, service: 'turn_off' }
    );

    await assert.rejects(run, /lässt sich nicht schalten/, `${entityId} wurde durchgelassen`);
    assert.equal(calls.length, 0);
  }
});

test('nur bekannte Dienste sind erlaubt', async () => {
  const { run } = callWith(
    { ...READY, entities: 'light.a', allowControl: true },
    { entityId: 'light.a', service: 'ein_beliebiger_dienst' }
  );

  await assert.rejects(run, /nicht erlaubt/);
});

test('ein erlaubter Aufruf geht durch', async () => {
  const { run, calls } = callWith(
    { ...READY, entities: 'light.a', allowControl: true },
    { entityId: 'light.a', service: 'toggle' }
  );

  await run();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/services\/light\/toggle$/);
  assert.deepEqual(calls[0].body, { entity_id: 'light.a' });
});

test('Helligkeit und Lautstärke werden begrenzt', async () => {
  const { run, calls } = callWith(
    { ...READY, entities: 'light.a', allowControl: true },
    { entityId: 'light.a', service: 'turn_on', brightness: 9999, volumeLevel: 5 }
  );

  await run();

  assert.equal(calls[0].body.brightness, 255);
  assert.equal(calls[0].body.volume_level, 1);
});

test('die Liste erlaubter Gattungen enthält nichts Sicherheitskritisches', () => {
  for (const forbidden of ['lock', 'alarm_control_panel', 'homeassistant', 'shell_command', 'notify']) {
    assert.ok(!ALLOWED_DOMAINS.has(forbidden), `"${forbidden}" steht auf der Erlaubnisliste`);
  }

  assert.ok(ALLOWED_DOMAINS.has('light'));
  assert.ok(ALLOWED_SERVICES.has('toggle'));
  assert.ok(!ALLOWED_SERVICES.has('reload'));
});

// Ein Tippfehler in einer Kennung ist der haeufigste Grund dafuer, dass
// "nichts angezeigt wird".
test('der Verbindungstest nennt fehlende Entitäten beim Namen', async () => {
  const request = async () => ({
    data: [{ entity_id: 'light.a' }, { entity_id: 'sensor.b' }]
  });

  const result = await testConnection(
    config({ ...READY, entities: 'light.a, light.vertippt' }),
    request
  );

  assert.equal(result.ok, true);
  assert.equal(result.found, 1);
  assert.deepEqual(result.missing, ['light.vertippt']);
});
