// Sicheres Zusammensetzen von HTML für Module.
//
// Module bauen ihre Ausgabe aus Daten fremder APIs (WebUntis, OpenWeatherMap,
// Spotify). Landen die ungeprüft in innerHTML, führt ein Lehrername wie
// `<img src=x onerror=...>` Code im Renderer aus. Die CSP fängt das nicht ab,
// solange sie 'unsafe-inline' erlaubt.
//
// Verwendung:
//
//   element.innerHTML = html`<div class="x">${wert}</div>`;
//
// Jede Interpolation wird escapt - auch für Attributwerte, weil Anführungs-
// zeichen mitbehandelt werden. Wer bewusst fertiges Markup einsetzt, muss das
// mit html.raw(...) kenntlich machen.
(function () {
  const ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);
  }

  // Markierung für bewusst unescapte Fragmente.
  class RawHtml {
    constructor(value) {
      this.value = String(value);
    }
    toString() {
      return this.value;
    }
  }

  function html(strings, ...values) {
    return strings.reduce((out, chunk, index) => {
      if (index === 0) return chunk;
      const value = values[index - 1];

      if (value instanceof RawHtml) return out + value.value + chunk;

      // Arrays kommen aus .map() - jedes Element einzeln behandeln.
      if (Array.isArray(value)) {
        const joined = value
          .map(item => (item instanceof RawHtml ? item.value : escapeHtml(item)))
          .join('');
        return out + joined + chunk;
      }

      return out + escapeHtml(value) + chunk;
    }, '');
  }

  html.raw = (value) => new RawHtml(value);
  html.escape = escapeHtml;

  if (typeof window !== 'undefined') {
    window.mmHtml = html;
    window.mmEscapeHtml = escapeHtml;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { html, escapeHtml, RawHtml };
  }
})();
