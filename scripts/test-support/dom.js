// Minimaler DOM-Stub. Gerade genug, damit die Modul-Klassen ihre Elemente
// bauen und aktualisieren koennen - ohne jsdom als Abhaengigkeit.
class StubElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.dataset = {};
    this.style = {};
    this._textContent = '';
    this._innerHTML = '';
    this.writeCount = 0;
  }

  get classes() {
    return this.className ? this.className.split(/\s+/).filter(Boolean) : [];
  }

  get classList() {
    const self = this;
    return {
      add(...names) {
        const cur = new Set(self.classes);
        names.forEach(n => cur.add(n));
        self.className = [...cur].join(' ');
      },
      remove(...names) {
        self.className = self.classes.filter(c => !names.includes(c)).join(' ');
      },
      contains: (name) => self.classes.includes(name)
    };
  }

  set textContent(value) {
    this.writeCount += 1;
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    return this._textContent;
  }

  set innerHTML(value) {
    this.writeCount += 1;
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }

  querySelector(selector) {
    const name = selector.replace(/^\./, '');
    for (const child of this.children) {
      if (child.classes.includes(name)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector) {
    const name = selector.replace(/^\./, '');
    const out = [];
    for (const child of this.children) {
      if (child.classes.includes(name)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }

  // Summe aller textContent-/innerHTML-Schreibvorgaenge im Teilbaum.
  totalWrites() {
    return this.writeCount + this.children.reduce((sum, c) => sum + c.totalWrites(), 0);
  }

  resetWrites() {
    this.writeCount = 0;
    this.children.forEach(c => c.resetWrites());
  }

  // Alle Knoten des Teilbaums in fester Reihenfolge - fuer Identitaetsvergleiche.
  flatten() {
    return this.children.reduce((acc, c) => acc.concat([c], c.flatten()), []);
  }
}

function installDom() {
  const documentElement = new StubElement('html');
  global.document = {
    documentElement,
    hidden: false,
    createElement: (tag) => new StubElement(tag)
  };
  global.window = global.window || {};
  global.window.MagicMirrorModules = global.window.MagicMirrorModules || {};
  // Mehrere Module leiten aus dem Protokoll ihre API-Basis-URL ab
  // (file:// -> http://localhost:3000). Ohne location wirft schon der
  // Konstruktor.
  global.window.location = global.window.location || {
    protocol: 'http:',
    host: 'localhost:3000',
    href: 'http://localhost:3000/',
    search: ''
  };
  return { StubElement, documentElement };
}

module.exports = { StubElement, installDom };
