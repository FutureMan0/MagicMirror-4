/**
 * Vorlage für ein Modul (API v2).
 *
 * Ein Modul ist ein Ordner unter modules/ mit einem module.json und dieser
 * Datei. Mehr braucht es nicht - der Loader findet es von selbst.
 *
 * MMModule nimmt die wiederkehrende Arbeit ab:
 *
 *   this.timers    setInterval/setTimeout/rAF, die beim Zerstören von selbst
 *                  abgeräumt werden. Ein vergessenes clearInterval kann es
 *                  damit nicht mehr geben.
 *   this.http      get/post mit bereits aufgelöster Basis-URL. Unter file://
 *                  würde ein relativer Pfad sonst auf file:///api/... landen.
 *   this.subscribe Bus-Abo, das beim Zerstören ebenfalls endet.
 *   this.html      Template-Tag, das jede Interpolation escapt.
 *   this.requestUpdate()  bündelt mehrere Anfragen zu einem Neuzeichnen.
 *
 * Wichtig: Der Host fasst den von render() gelieferten Teilbaum nicht an.
 * Änderungen gehören in update() und sollten punktuell sein - ein
 * innerHTML-Neuaufbau lässt die CSS-Animationen der Themes jedes Mal von vorne
 * beginnen.
 *
 * Farben, Abstände und Schriften kommen aus Tokens (siehe
 * src/renderer/styles/tokens.css). Ein hartcodiertes #00ff7f wäre für jedes
 * Theme unerreichbar - `npm run check:tokens` weist es deshalb ab.
 */
// Bewusst `var` und nicht `const`: unter file:// werden Module als klassische
// Scripts geladen und teilen sich einen globalen Scope. Ein zweites `const`
// desselben Namens wuerde das Modul mit einem SyntaxError scheitern lassen.
// Als ES-Modul (der Normalfall) ist die Deklaration ohnehin modul-lokal.
var ModuleBase = (typeof window !== 'undefined' && window.MMModule) || class {};

class ExampleHidden extends ModuleBase {
  static moduleName = 'example-hidden';

  // Diese Schlüssel lassen sich ändern, ohne das Modul neu aufzubauen.
  static patchable = ['text'];

  constructor(config = {}) {
    super(config);

    this.config = {
      text: config.text || 'This is a hidden example module.',
      language: config.language || 'en',
      ...config
    };

    this.container = null;
    this.textElement = null;
  }

  /** Asynchrone Vorbereitung, bevor irgendetwas gezeichnet wird. */
  async init() {
    // z.B. Daten vorladen: this.data = await this.http.get('/api/demo/data');
  }

  /** Wird genau einmal aufgerufen. null bedeutet: Modul ohne Anzeige. */
  render() {
    this.container = document.createElement('div');
    this.container.className = 'module-example-hidden';

    this.textElement = document.createElement('div');
    this.textElement.className = 'example-hidden-text';
    this.container.appendChild(this.textElement);

    this.update();

    return this.container;
  }

  /** Aktualisiert die bestehende Anzeige - ohne sie neu aufzubauen. */
  update() {
    if (!this.textElement) return;

    // Nur schreiben, wenn sich etwas geändert hat: jeder Schreibvorgang
    // kostet Layout und Paint.
    if (this.textElement.textContent !== this.config.text) {
      this.textElement.textContent = this.config.text;
    }
  }

  destroy() {
    // Timer und Abos übernimmt die Basisklasse.
    if (super.destroy) super.destroy();
    this.container = null;
    this.textElement = null;
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules['example-hidden'] = ExampleHidden;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExampleHidden;
}
