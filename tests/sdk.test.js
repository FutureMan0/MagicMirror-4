const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
const { MMModule, Timers, createHttp } = require(path.join(ROOT, 'src/renderer/sdk.js'));

test('Timers räumt alles auf einmal ab', () => {
  const timers = new Timers();

  timers.every(1000, () => {});
  timers.every(2000, () => {});
  timers.after(5000, () => {});

  assert.equal(timers.intervals.size, 2);
  assert.equal(timers.timeouts.size, 1);

  timers.clearAll();

  assert.equal(timers.intervals.size, 0);
  assert.equal(timers.timeouts.size, 0);
});

test('die Abmeldefunktion entfernt den Timer aus der Verwaltung', () => {
  const timers = new Timers();
  const stop = timers.every(1000, () => {});
  assert.equal(timers.intervals.size, 1);
  stop();
  assert.equal(timers.intervals.size, 0);
});

test('ein abgelaufener Timeout wird nicht ewig mitgeführt', async () => {
  const timers = new Timers();
  await new Promise(resolve => {
    timers.after(1, resolve);
  });
  assert.equal(timers.timeouts.size, 0);
});

// Unter file:// landet ein relativer Pfad auf file:///api/... - genau daran
// scheiterte das Präsenz-Modul jahrelang unbemerkt.
test('http löst die Basis-URL passend zum Protokoll auf', () => {
  const previous = global.window.location;

  global.window.location = { protocol: 'file:' };
  assert.equal(createHttp('demo').base, 'http://localhost:3000');

  global.window.location = { protocol: 'http:' };
  assert.equal(createHttp('demo').base, '', 'über HTTP genügt der relative Pfad');

  global.window.location = previous;
});

test('destroy() räumt Timer und Bus-Abos ab', () => {
  const { Bus } = require(path.join(ROOT, 'src/shared/bus.js'));
  const bus = new Bus();
  const previous = global.window.mmBus;
  global.window.mmBus = { on: (pattern, listener) => bus.on(pattern, listener) };

  try {
    const module = new MMModule({});
    let received = 0;

    module.subscribe('x', () => { received += 1; });
    module.timers.every(1000, () => {});

    bus.emit('x');
    assert.equal(received, 1);

    module.destroy();

    bus.emit('x');
    assert.equal(received, 1, 'das Abo läuft nach destroy() weiter');
    assert.equal(module.timers.intervals.size, 0);
  } finally {
    global.window.mmBus = previous;
  }
});

test('requestUpdate() bündelt mehrere Aufrufe zu einem update()', async () => {
  let updates = 0;

  class Demo extends MMModule {
    update() { updates += 1; }
  }

  const demo = new Demo({});
  demo.requestUpdate();
  demo.requestUpdate();
  demo.requestUpdate();

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(updates, 1, 'drei Aufrufe müssen zu einem Neuzeichnen führen');
});

test('requestUpdate() nach destroy() zeichnet nicht mehr', async () => {
  let updates = 0;

  class Demo extends MMModule {
    update() { updates += 1; }
  }

  const demo = new Demo({});
  demo.requestUpdate();
  demo.destroy();

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(updates, 0);
});

test('onConfigChange unterscheidet patchbare von umbaupflichtigen Schlüsseln', () => {
  class Demo extends MMModule {
    static patchable = ['showDate', 'timeFormat'];
  }

  const demo = new Demo({});
  assert.equal(demo.onConfigChange({}, ['showDate']), 'patch');
  assert.equal(demo.onConfigChange({}, ['showDate', 'timeFormat']), 'patch');
  assert.equal(demo.onConfigChange({}, ['apiKey']), 'rebuild');
  assert.equal(demo.onConfigChange({}, ['showDate', 'apiKey']), 'rebuild');
});

test('ein Fehler in update() bringt das Modul nicht zum Absturz', async () => {
  class Broken extends MMModule {
    update() { throw new Error('kaputt'); }
  }

  const broken = new Broken({});
  assert.doesNotThrow(() => broken.requestUpdate());
  await new Promise(resolve => setTimeout(resolve, 20));
});
