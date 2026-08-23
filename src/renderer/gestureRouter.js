// Setzt Gesten in Aktionen um.
//
// Der Hub liefert normalisierte Ereignisse mit einer Zuordnung; hier wird
// entschieden, was das konkret bedeutet. Absichtlich getrennt: welche Geste
// was tut, ist eine Frage der Konfiguration - was "nächste Seite" heisst, eine
// Frage der Anzeige.
(function () {
  if (!window.mmBus) return;

  const ACTIONS = {
    'page.next': () => changePage(1),
    'page.prev': () => changePage(-1),

    'spotify.next': () => spotify('next'),
    'spotify.previous': () => spotify('previous'),
    'spotify.playpause': () => spotify('play'),

    'privacy.toggleGuest': () => togglePrivacy('guest'),
    'privacy.shower': () => setPrivacy('shower'),
    'privacy.normal': () => setPrivacy('normal'),

    'display.wake': () => wake()
  };

  let currentPage = 1;

  function apiBase() {
    return window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  }

  async function post(endpoint, body) {
    try {
      await fetch(`${apiBase()}${endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    } catch (error) {
      console.error(`Geste: ${endpoint} fehlgeschlagen`, error);
    }
  }

  /**
   * Blättert zwischen Modulseiten.
   *
   * Über ein Attribut, nicht über Neuaufbau: die Module behalten ihren
   * Zustand, und der Wechsel ist sofort.
   */
  function changePage(delta) {
    const containers = [...document.querySelectorAll('.module-container')];
    const pages = new Set(containers.map(el => Number(el.dataset.page || 1)));
    if (pages.size <= 1) return;

    const sorted = [...pages].sort((a, b) => a - b);
    const index = sorted.indexOf(currentPage);
    currentPage = sorted[(index + delta + sorted.length) % sorted.length];

    document.documentElement.dataset.page = String(currentPage);
  }

  function spotify(action) {
    return post('/api/spotify/control', { action });
  }

  function setPrivacy(mode) {
    return post('/api/privacy', { mode });
  }

  function togglePrivacy(mode) {
    const current = window.mmPrivacy ? window.mmPrivacy.getMode() : 'normal';
    return setPrivacy(current === mode ? 'normal' : mode);
  }

  function wake() {
    document.body.style.opacity = '1';
    return post('/api/presence/trigger', {});
  }

  window.mmBus.on('input:gesture', (event) => {
    if (!event || !event.action) return;

    const handler = ACTIONS[event.action];
    if (!handler) {
      console.warn(`Geste: unbekannte Aktion "${event.action}"`);
      return;
    }

    Promise.resolve(handler()).catch(error => {
      console.error(`Geste "${event.gesture}" fehlgeschlagen:`, error);
    });
  });

  window.mmGestureRouter = { actions: Object.keys(ACTIONS), getPage: () => currentPage };
})();
