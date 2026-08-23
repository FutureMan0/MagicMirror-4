const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { InputHub } = require(path.join(ROOT, 'src/main/inputHub.js'));
const { MockProvider } = require(path.join(ROOT, 'src/main/inputProviders/mock.js'));
const { GESTURES } = require(path.join(ROOT, 'src/main/inputProviders/base.js'));

const quiet = { log() {}, warn() {} };

function makeHub(inputConfig = {}, privacyMode = 'normal') {
  const events = [];
  const hub = new InputHub({
    bus: { emit: (topic, payload) => events.push({ topic, payload }) },
    getConfig: () => ({
      input: {
        enabled: true,
        provider: 'mock',
        cooldownMs: 400,
        minConfidence: 0.6,
        bindings: { swipe_left: 'page.next' },
        ...inputConfig
      }
    }),
    getPrivacyMode: () => privacyMode,
    log: quiet
  });

  return { hub, events };
}

test('nur bekannte Gesten lassen sich erzeugen', () => {
  const provider = new MockProvider({}, () => {});
  provider.connected = true;

  for (const gesture of GESTURES) {
    assert.doesNotThrow(() => provider.trigger(gesture));
  }

  assert.throws(() => provider.trigger('salto'), /Unbekannte Geste/);
});

test('ein abgeschalteter Hub startet nichts', async () => {
  const { hub } = makeHub({ enabled: false });
  await hub.start();
  assert.equal(hub.status().running, false);
});

// Ein Kamera-Sensor, der "nur zuhoert", ist genau das, was hier niemand will.
test('bei eingeschränkter Privatsphäre wird gar nicht erst gestartet', async () => {
  for (const mode of ['guest', 'shower', 'off']) {
    const { hub } = makeHub({}, mode);
    await hub.start();
    assert.equal(hub.status().running, false, `im Zustand "${mode}" läuft der Sensor`);
  }
});

test('ein Wechsel der Privatsphäre stoppt und startet den Anbieter', async () => {
  let mode = 'normal';
  const hub = new InputHub({
    bus: { emit() {} },
    getConfig: () => ({ input: { enabled: true, provider: 'mock', bindings: {} } }),
    getPrivacyMode: () => mode,
    log: quiet
  });

  await hub.start();
  assert.equal(hub.status().running, true);

  mode = 'shower';
  await hub.onPrivacyChange('shower');
  assert.equal(hub.status().running, false, 'der Sensor läuft im Duschmodus weiter');

  mode = 'normal';
  await hub.onPrivacyChange('normal');
  assert.equal(hub.status().running, true);

  await hub.stop();
});

test('eine Geste wird mit ihrer Zuordnung weitergegeben', async () => {
  const { hub, events } = makeHub();
  await hub.start();

  hub.trigger('swipe_left');

  assert.equal(events.length, 1);
  assert.equal(events[0].topic, 'input:gesture');
  assert.equal(events[0].payload.gesture, 'swipe_left');
  assert.equal(events[0].payload.action, 'page.next');

  await hub.stop();
});

test('eine Geste ohne Zuordnung kommt trotzdem an, nur ohne Aktion', async () => {
  const { hub, events } = makeHub();
  await hub.start();

  hub.trigger('grab');

  assert.equal(events[0].payload.action, null);
  await hub.stop();
});

// Ohne Sperre schaltet der Spiegel drei Seiten weiter statt einer.
test('dieselbe Geste wird innerhalb der Sperrzeit nur einmal gezählt', async () => {
  const { hub, events } = makeHub({ cooldownMs: 1000 });
  await hub.start();

  hub.trigger('swipe_left');
  hub.trigger('swipe_left');
  hub.trigger('swipe_left');

  assert.equal(events.length, 1, `${events.length} Ereignisse statt einem`);
  await hub.stop();
});

// Schnell hintereinander links und rechts zu wischen ist eine gueltige
// Eingabe - die Sperre gilt je Geste, nicht global.
test('verschiedene Gesten blockieren sich nicht gegenseitig', async () => {
  const { hub, events } = makeHub({ cooldownMs: 1000 });
  await hub.start();

  hub.trigger('swipe_left');
  hub.trigger('swipe_right');

  assert.equal(events.length, 2);
  await hub.stop();
});

// Eine halb erkannte Geste ist schlimmer als keine: was von selbst passiert,
// wirkt kaputt.
test('unsichere Erkennungen werden verworfen', async () => {
  const { hub, events } = makeHub({ minConfidence: 0.8 });
  await hub.start();

  hub.trigger('swipe_left', { confidence: 0.5 });
  assert.equal(events.length, 0);

  hub.trigger('swipe_left', { confidence: 0.9 });
  assert.equal(events.length, 1);

  await hub.stop();
});

test('der Status sagt, was läuft und was zuletzt erkannt wurde', async () => {
  const { hub } = makeHub();
  await hub.start();
  hub.trigger('push');

  const status = hub.status();
  assert.equal(status.provider, 'mock');
  assert.equal(status.running, true);
  assert.equal(status.lastGesture, 'push');
  assert.equal(status.counts.push, 1);
  assert.match(status.detail, /ohne Hardware/i);

  await hub.stop();
});

test('ein unbekannter Anbieter wird gemeldet, statt zu werfen', async () => {
  const { hub } = makeHub({ provider: 'gibtesnicht' });
  await assert.doesNotReject(() => hub.start());
  assert.equal(hub.status().running, false);
});

test('ohne laufenden Anbieter lässt sich nichts auslösen', () => {
  const { hub } = makeHub();
  assert.throws(() => hub.trigger('swipe_left'), /lässt sich nicht von Hand auslösen/);
});
