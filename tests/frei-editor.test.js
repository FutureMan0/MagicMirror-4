// Freies Positionieren - der Zug selbst.
//
// Ein Editor, den man nicht anfassen kann, prüft sich schlecht: die alten
// Tests instanziierten nur die Klasse und sahen ihr beim Rechnen zu. Hier wird
// wirklich gezogen - pointerdown, pointermove, pointerup - und danach steht in
// der Konfiguration, was dabei herauskommen soll.
//
// Dafür ein eigener, kleiner DOM. Gerade genug für Ereignisse, Rechtecke und
// Zeiger-Erfassung; jsdom wäre für diese paar Bausteine die falsche
// Abhängigkeit (dieselbe Überlegung wie in scripts/test-support/dom.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const QUELLE = fs.readFileSync(path.join(ROOT, 'src/webui/public/free-editor.js'), 'utf8');

// Die Bühne ist 1000×1000 - damit ist ein Prozent genau zehn Pixel.
const BUEHNE = { left: 0, top: 0, width: 1000, height: 1000 };

class Stil {
  setProperty(name, wert) { this[name] = wert; }
  getPropertyValue(name) { return this[name] || ''; }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.dataset = {};
    this.style = new Stil();
    this.zuhoerer = new Map();
    this._text = '';
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
  }

  get classList() {
    const self = this;
    const teile = () => (self.className ? self.className.split(/\s+/).filter(Boolean) : []);
    return {
      add: (...n) => { self.className = [...new Set([...teile(), ...n])].join(' '); },
      remove: (...n) => { self.className = teile().filter(c => !n.includes(c)).join(' '); },
      toggle: (n, an) => { if (an) self.classList.add(n); else self.classList.remove(n); },
      contains: (n) => teile().includes(n)
    };
  }

  set textContent(wert) { this._text = String(wert); this.children = []; }
  get textContent() {
    return this.children.length ? this.children.map(c => c.textContent).join('') : this._text;
  }

  appendChild(kind) { kind.parentNode = this; this.children.push(kind); return kind; }
  append(...kinder) { kinder.forEach(k => this.appendChild(k)); }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(k => k !== this);
    }
  }

  get clientWidth() { return this.rect.width; }
  getBoundingClientRect() { return { ...this.rect }; }

  setPointerCapture() {}
  releasePointerCapture() {}
  setAttribute(name, wert) { this[name] = wert; }
  getAttribute(name) { return this[name]; }

  addEventListener(art, fn) {
    if (!this.zuhoerer.has(art)) this.zuhoerer.set(art, []);
    this.zuhoerer.get(art).push(fn);
  }

  removeEventListener(art, fn) {
    const liste = this.zuhoerer.get(art) || [];
    this.zuhoerer.set(art, liste.filter(f => f !== fn));
  }

  dispatchEvent(ereignis) {
    for (const fn of [...(this.zuhoerer.get(ereignis.type) || [])]) fn(ereignis);
    return true;
  }

  alle(klasse, treffer = []) {
    for (const kind of this.children) {
      if (kind.classList.contains(klasse)) treffer.push(kind);
      kind.alle(klasse, treffer);
    }
    return treffer;
  }

  querySelector(sel) { return this.alle(sel.replace(/^\./, ''))[0] || null; }
  querySelectorAll(sel) { return this.alle(sel.replace(/^\./, '')); }
}

function ereignis(art, x, y) {
  return {
    type: art, clientX: x, clientY: y, pointerId: 1,
    preventDefault() {}, stopPropagation() {}
  };
}

/** Editor in einem eigenen Fenster aufbauen. */
function baueEditor(config) {
  const behaelter = new El('div');
  behaelter.className = 'ziel';

  const dok = {
    createElement: (tag) => new El(tag),
    querySelector: (sel) => (sel === '#frei-editor' ? behaelter : null),
    addEventListener() {}
  };

  const gespeichert = [];
  const fenster = {
    currentConfig: config,
    currentInstance: 'display1',
    availableModules: [],
    localStorage: { getItem: () => '0', setItem() {} },
    Bildschirm: {
      vorschau: () => ({ format: '9 / 16', breite: 1080, hoehe: 1920, hochkant: true, url: '/mirror' })
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => fn()
  };

  new Function('window', 'document', 'localStorage', 'ResizeObserver',
    'requestAnimationFrame', 't', 'getCurrentLanguage', QUELLE)(
    fenster, dok, fenster.localStorage, fenster.ResizeObserver,
    fenster.requestAnimationFrame, () => null, () => 'de'
  );

  const editor = new fenster.FreiEditor('#frei-editor', config, (c) => gespeichert.push(c));

  // Die Bühne bekommt ein Rechteck, sonst lässt sich nichts umrechnen.
  editor.buehne.rect = { ...BUEHNE };

  return { editor, behaelter, gespeichert };
}

function ziehe(element, vonX, vonY, nachX, nachY) {
  element.dispatchEvent(ereignis('pointerdown', vonX, vonY));
  element.dispatchEvent(ereignis('pointermove', nachX, nachY));
  element.dispatchEvent(ereignis('pointerup', nachX, nachY));
}

const EINS = () => ({
  modules: [{ module: 'clock', enabled: true, position: { x: '10%', y: '10%', width: '30%', height: '20%' } }]
});

test('ein Modul laesst sich verschieben', () => {
  const config = EINS();
  const { editor, gespeichert } = baueEditor(config);

  const kasten = editor.buehne.querySelector('.frei-modul');
  assert.ok(kasten, 'kein Modul gezeichnet');

  // 150 px nach rechts, 50 px nach unten = 15 % und 5 %.
  ziehe(kasten, 0, 0, 150, 50);

  assert.equal(config.modules[0].position.x, '25%');
  assert.equal(config.modules[0].position.y, '15%');
  // Die Größe bleibt, was sie war.
  assert.equal(config.modules[0].position.width, '30%');
  assert.equal(gespeichert.length, 1, 'nicht gespeichert');
});

test('an der Ecke wird es groesser', () => {
  const config = EINS();
  const { editor } = baueEditor(config);

  const griff = editor.buehne.querySelector('.frei-griff');
  assert.ok(griff, 'kein Griff gezeichnet');

  ziehe(griff, 0, 0, 200, 300);

  assert.equal(config.modules[0].position.width, '50%');
  assert.equal(config.modules[0].position.height, '50%');
  // Die Ecke oben links bleibt liegen.
  assert.equal(config.modules[0].position.x, '10%');
  assert.equal(config.modules[0].position.y, '10%');
});

test('nichts wird ueber den Rand geschoben', () => {
  const config = EINS();
  const { editor } = baueEditor(config);

  // Weit nach rechts unten - das Modul ist 30×20 gross.
  ziehe(editor.buehne.querySelector('.frei-modul'), 0, 0, 5000, 5000);

  assert.equal(config.modules[0].position.x, '70%', 'ragt rechts hinaus');
  assert.equal(config.modules[0].position.y, '80%', 'ragt unten hinaus');
});

test('kleiner als greifbar wird es nicht', () => {
  const config = EINS();
  const { editor } = baueEditor(config);

  ziehe(editor.buehne.querySelector('.frei-griff'), 0, 0, -5000, -5000);

  assert.equal(config.modules[0].position.width, '8%');
  assert.equal(config.modules[0].position.height, '5%');
});

test('ein Modul ohne freie Position bekommt eine Flaeche', () => {
  // Sonst laegen alle bei 0,0 uebereinander und man erwischt nur das oberste.
  const config = {
    modules: [
      { module: 'clock', enabled: true, position: 'oben-links' },
      { module: 'weather', enabled: true, position: { column: 1, row: 2 } }
    ]
  };
  const { editor } = baueEditor(config);

  const kaesten = editor.buehne.querySelectorAll('.frei-modul');
  assert.equal(kaesten.length, 2);
  assert.notEqual(kaesten[0].style.top, kaesten[1].style.top, 'beide liegen uebereinander');
});

test('der Schriftregler schreibt einen Faktor, kein Prozent', () => {
  const config = EINS();
  const { editor } = baueEditor(config);

  editor.waehle('clock');
  const regler = editor.werkzeug.querySelector('.darstellung-zeile')
    ?.children.find(k => k.tagName === 'INPUT');
  assert.ok(regler, 'kein Regler im Werkzeugkasten');

  regler.value = '150';
  regler.dispatchEvent({ type: 'change' });

  assert.equal(config.modules[0].appearance.fontScale, 1.5);
});

test('steht alles auf 100 Prozent, faellt der Eintrag weg', () => {
  const config = EINS();
  config.modules[0].appearance = { scale: 1, fontScale: 1.5 };
  const { editor } = baueEditor(config);

  editor.waehle('clock');
  const regler = editor.werkzeug.querySelector('.darstellung-zeile')
    .children.find(k => k.tagName === 'INPUT');

  regler.value = '100';
  regler.dispatchEvent({ type: 'change' });

  assert.equal(config.modules[0].appearance, undefined, 'der Standard steht noch in der Datei');
});
