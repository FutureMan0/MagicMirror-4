// Theme-Wechsel im Renderer.
//
// Ersetzt applyTheme() aus renderer.js. Zwei Unterschiede zur alten Fassung:
//
//  1. Das neue Stylesheet wird geladen, BEVOR das alte entfernt wird. Vorher
//     wurde einfach href umgesetzt - zwischen altem und neuem Stylesheet lag
//     ein Moment ohne Theme, in dem der Spiegel ungestylt aufblitzte.
//  2. Ein Themewechsel baut die Module nicht mehr neu auf. Vorher lief der
//     Wechsel über renderModules(), das jedes Modul zerstörte und neu
//     erzeugte - inklusive aller Netzwerkabfragen.
(function () {
  const LINK_ID = 'mm-theme';
  const THEMES_BASE = '../../themes/';

  let currentTheme = null;

  // Themes gibt es in zwei Ablageformen; die alte flache Datei muss weiter
  // funktionieren, damit selbst gebaute Themes nicht kaputtgehen.
  function candidateUrls(themeId) {
    return [
      `${THEMES_BASE}${themeId}/theme.css`,
      `${THEMES_BASE}${themeId}.css`
    ];
  }

  function loadStylesheet(url) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.pending = 'true';
      link.onload = () => resolve(link);
      link.onerror = () => {
        link.remove();
        reject(new Error(`Theme-Stylesheet nicht ladbar: ${url}`));
      };
      document.head.appendChild(link);
    });
  }

  function removeCurrent() {
    document.getElementById(LINK_ID)?.remove();
  }

  async function applyTheme(themeId, meta = {}) {
    const target = themeId || 'default';
    if (target === currentTheme) return;

    if (target === 'default') {
      removeCurrent();
      currentTheme = 'default';
      document.documentElement.dataset.theme = 'default';
      document.documentElement.dataset.themeMode = 'dark';
      return;
    }

    let link = null;
    for (const url of candidateUrls(target)) {
      try {
        link = await loadStylesheet(url);
        break;
      } catch {
        // nächste Ablageform versuchen
      }
    }

    if (!link) {
      console.error(`Theme "${target}" konnte nicht geladen werden, bleibe beim aktuellen.`);
      return;
    }

    // Erst jetzt das alte entfernen - kein ungestylter Moment dazwischen.
    removeCurrent();
    link.id = LINK_ID;
    delete link.dataset.pending;

    currentTheme = target;
    document.documentElement.dataset.theme = target;
    document.documentElement.dataset.themeMode = meta.mode || 'dark';

    window.dispatchEvent(new CustomEvent('mm:theme-changed', {
      detail: { theme: target, mode: meta.mode || 'dark' }
    }));
  }

  window.mmThemeEngine = {
    applyTheme,
    getCurrentTheme: () => currentTheme
  };
})();
