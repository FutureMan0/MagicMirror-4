/**
 * Vorlage für ein Modul.
 *
 * Der Vertrag, den der Renderer erwartet:
 *   constructor(config)  - bekommt die zusammengeführte Konfiguration
 *   render()             - liefert genau ein HTMLElement (darf async sein)
 *   destroy()            - optional, muss jeden Timer und Listener abräumen
 *
 * Wichtig: Der Renderer fasst den von render() gelieferten Teilbaum nicht an.
 * Alles Weitere macht das Modul selbst - am besten punktuell über
 * textContent statt über einen innerHTML-Neuaufbau, sonst starten die
 * CSS-Animationen der Themes bei jeder Aktualisierung von vorne.
 */
class ExampleHidden {
  constructor(config = {}) {
    this.config = {
      text: config.text || 'This is a hidden example module.',
      language: config.language || 'en',
      ...config
    };

    this.container = null;
  }

  render() {
    this.container = document.createElement('div');
    this.container.className = 'module-example-hidden';

    this.textElement = document.createElement('div');
    this.textElement.className = 'example-hidden-text';
    this.textElement.textContent = this.config.text;
    this.container.appendChild(this.textElement);

    return this.container;
  }

  destroy() {
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
