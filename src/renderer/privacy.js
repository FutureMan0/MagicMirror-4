// Privatsphäre am Spiegel.
//
// Ausgeblendet wird über ein Attribut am <html>-Element und CSS - nicht durch
// Neuaufbau der Module. Das ist sofort, flackerfrei, und die Module behalten
// ihren Zustand: nach dem Gästemodus steht die Uhr nicht plötzlich still und
// das Wetter muss nicht neu geladen werden.
//
// Zweite Stufe für echte Privatsphäre statt bloß optischer: Module, die
// setPrivacy() anbieten, werden benachrichtigt und können ihre Abfragen
// einstellen. Ein ausgeblendetes Modul, das weiter alle 15 Minuten den
// Stundenplan holt, wäre nur halb privat.
(function () {
  let currentMode = 'normal';
  let banner = null;

  const LABELS = {
    normal: null,
    guest: 'Gästemodus — persönliche Inhalte sind ausgeblendet',
    shower: null,
    off: 'Anzeige aus'
  };

  function apply(state) {
    if (!state || !state.mode) return;

    currentMode = state.mode;
    document.documentElement.dataset.privacy = state.mode;

    updateBanner(state.mode);
    notifyModules(state.mode);
  }

  function updateBanner(mode) {
    const text = LABELS[mode];

    if (!text) {
      banner?.remove();
      banner = null;
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'privacy-banner';
      document.body.appendChild(banner);
    }

    banner.textContent = text;
  }

  /** Module, die es anbieten, über den Wechsel informieren. */
  function notifyModules(mode) {
    const loader = window.mmModuleLoader;
    if (!loader || typeof loader.eachInstance !== 'function') return;

    loader.eachInstance((instance) => {
      if (typeof instance.setPrivacy === 'function') {
        try {
          instance.setPrivacy(mode);
        } catch (error) {
          console.error('setPrivacy fehlgeschlagen:', error);
        }
      }
    });
  }

  if (window.mmBus) {
    window.mmBus.on('privacy:changed', apply);
  }

  window.mmPrivacy = {
    apply,
    getMode: () => currentMode
  };
})();
