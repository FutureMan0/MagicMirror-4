const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { installDom } = require('../scripts/test-support/dom');

installDom();

const ROOT = path.join(__dirname, '..');
const ClockModule = require(path.join(ROOT, 'modules/clock/index.js'));

const RealDate = Date;

// Friert die "aktuelle" Zeit ein, damit die Tests deterministisch sind.
function freeze(year, month, day, hour, minute, second) {
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length) return new RealDate(...args);
      return new RealDate(year, month, day, hour, minute, second);
    }
  };
}

function withFrozenClock(fn) {
  const timers = [];
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.setInterval = (callback) => { timers.push(callback); return timers.length; };
  global.clearInterval = () => {};
  try {
    return fn();
  } finally {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
    global.Date = RealDate;
  }
}

test('zerlegt die Zeit in genau die angezeigten Teile', () => {
  withFrozenClock(() => {
    freeze(2026, 7, 23, 15, 4, 9);

    assert.deepEqual(
      new ClockModule({ timeFormat: 'HH:mm:ss' }).getTimeParts(new Date()),
      { parts: ['15', '04', '09'], suffix: '' }
    );

    assert.deepEqual(
      new ClockModule({ timeFormat: 'HH:mm' }).getTimeParts(new Date()),
      { parts: ['15', '04'], suffix: '' }
    );

    assert.deepEqual(
      new ClockModule({ timeFormat: 'hh:mm A' }).getTimeParts(new Date()),
      { parts: ['03', '04'], suffix: 'PM' }
    );
  });
});

test('Mitternacht wird im 12h-Format als 12 AM dargestellt', () => {
  withFrozenClock(() => {
    freeze(2026, 7, 23, 0, 30, 0);
    assert.deepEqual(
      new ClockModule({ timeFormat: 'hh:mm A' }).getTimeParts(new Date()),
      { parts: ['12', '30'], suffix: 'AM' }
    );
  });
});

test('formatiert das Datum in der gewaehlten Sprache', () => {
  withFrozenClock(() => {
    freeze(2026, 7, 23, 15, 4, 9);
    const de = new ClockModule({ language: 'de' });
    const en = new ClockModule({ language: 'en' });
    assert.equal(de.formatDate(new Date()), 'Sonntag, 23. August 2026');
    assert.equal(en.formatDate(new Date()), 'Sunday, 23. August 2026');
  });
});

// Der eigentliche Regressionstest: update() baute frueher jede Sekunde das
// innerHTML neu auf. Dadurch entstanden neue DOM-Knoten, und die
// Endlos-Animationen der Themes starteten jede Sekunde bei Frame 0 neu.
test('update() schreibt nur geaenderte Werte und ersetzt keine DOM-Knoten', () => {
  withFrozenClock(() => {
    freeze(2026, 7, 23, 15, 4, 9);
    const clock = new ClockModule({ language: 'de' });
    const root = clock.render();
    const nodesAfterRender = root.flatten();

    root.resetWrites();
    clock.update();
    assert.equal(root.totalWrites(), 0, 'gleiche Sekunde darf nichts schreiben');

    freeze(2026, 7, 23, 15, 4, 10);
    root.resetWrites();
    clock.update();
    assert.equal(root.totalWrites(), 1, 'neue Sekunde: genau ein Schreibvorgang');

    freeze(2026, 7, 23, 15, 5, 0);
    root.resetWrites();
    clock.update();
    assert.equal(root.totalWrites(), 2, 'Minutenwechsel: Minuten + Sekunden');

    freeze(2026, 7, 24, 0, 0, 0);
    root.resetWrites();
    clock.update();
    assert.ok(root.totalWrites() >= 3, 'Tageswechsel aktualisiert auch das Datum');

    const nodesNow = root.flatten();
    assert.equal(nodesNow.length, nodesAfterRender.length);
    nodesNow.forEach((node, i) => {
      assert.equal(node, nodesAfterRender[i], 'DOM-Knoten muessen dieselben Objekte bleiben');
    });
  });
});

// Die Basisklasse raeumt Timer und Bus-Abos ab. Frueher musste jedes Modul
// daran selbst denken - und ein vergessenes clearInterval liess die Uhr im
// Sekundentakt weiterlaufen, obwohl sie laengst entfernt war.
test('destroy() raeumt Timer, Abos und Referenzen ab', () => {
  withFrozenClock(() => {
    freeze(2026, 7, 23, 15, 4, 9);
    const clock = new ClockModule({});
    clock.render();

    assert.ok(clock.timers.intervals.size > 0, 'ohne Bus muss ein eigener Timer laufen');

    clock.destroy();

    assert.equal(clock.timers.intervals.size, 0, 'Timer laeuft weiter');
    assert.equal(clock.container, null);
    assert.doesNotThrow(() => clock.update(), 'update() nach destroy() darf nicht werfen');
  });
});

test('mit Bus haengt die Uhr am gemeinsamen Takt statt an einem eigenen Timer', () => {
  withFrozenClock(() => {
    freeze(2026, 7, 23, 15, 4, 9);

    const { Bus } = require('../src/shared/bus.js');
    const bus = new Bus();
    const previous = global.window.mmBus;
    global.window.mmBus = {
      on: (pattern, listener) => bus.on(pattern, listener),
      emit: (topic, payload) => bus.emit(topic, payload)
    };

    try {
      const clock = new ClockModule({});
      clock.render();

      assert.equal(clock.timers.intervals.size, 0, 'mit Bus darf kein eigener Timer laufen');

      const root = clock.container;
      freeze(2026, 7, 23, 15, 4, 10);
      root.resetWrites();
      bus.emit('tick:second', {});
      assert.equal(root.totalWrites(), 1, 'der Takt erreicht die Uhr nicht');

      clock.destroy();
      root.resetWrites();
      bus.emit('tick:second', {});
      assert.equal(root.totalWrites(), 0, 'nach destroy() wird weiter gezeichnet');
    } finally {
      global.window.mmBus = previous;
    }
  });
});
