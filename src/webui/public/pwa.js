// PWA-Verhalten: Installation, Aktualisierung, Bedienung mit dem Daumen.
//
// Der Unterschied zwischen "responsive Webseite" und "App" liegt weniger in
// der Breite als in Kleinigkeiten: dass ein Tippen sofort reagiert, dass ein
// Wisch von oben neu lädt, dass nichts unter der Statusleiste klebt.
(function () {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  // --- Service Worker ------------------------------------------------------

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // Über http nur auf localhost erlaubt; im Heimnetz per IP gibt es keinen
    // Service Worker. Das ist eine Browser-Regel, kein Fehler - die App
    // funktioniert dann eben ohne Offline-Hülle.
    if (window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      console.info('Service Worker nur über HTTPS oder localhost - Offline-Hülle ist inaktiv.');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          // Nur wenn schon einer lief - sonst ist das die Erstinstallation.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate(registration);
          }
        });
      });
    } catch (error) {
      console.warn('Service Worker konnte nicht registriert werden:', error.message);
    }
  }

  /**
   * Nach dem Übernehmen wird neu geladen - aber gefragt wird vorher.
   *
   * Ein automatisches skipWaiting würde eine offene Bearbeitung verwerfen.
   * Besonders relevant nach einem Update über die Oberfläche: die App startet
   * neu, und die alte Hülle wäre dann veraltet.
   */
  function offerUpdate(registration) {
    const toast = document.createElement('div');
    toast.className = 'pwa-toast';
    toast.innerHTML = `
      <span>Neue Version verfügbar.</span>
      <button type="button" class="pwa-toast-action">Neu laden</button>
      <button type="button" class="pwa-toast-dismiss" aria-label="Später">&times;</button>
    `;

    toast.querySelector('.pwa-toast-action').addEventListener('click', () => {
      registration.waiting?.postMessage('SKIP_WAITING');
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    });

    toast.querySelector('.pwa-toast-dismiss').addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);
  }

  // --- Installation --------------------------------------------------------

  let installPrompt = null;
  const SNOOZE_KEY = 'pwaInstallSnoozedUntil';

  function snoozed() {
    const until = parseInt(localStorage.getItem(SNOOZE_KEY) || '0', 10);
    return Date.now() < until;
  }

  function snooze(days = 30) {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86400000));
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    localStorage.removeItem(SNOOZE_KEY);
    document.querySelector('.pwa-install-sheet')?.remove();
  });

  /**
   * Der Vorschlag kommt erst nach einem erfolgreichen Speichern.
   *
   * Beim ersten Aufschlagen zu fragen ist die zuverlässigste Art, abgelehnt
   * zu werden - man weiß ja noch nicht, wofür. Wer etwas gespeichert hat, hat
   * die Absicht gezeigt, wiederzukommen.
   */
  function maybeOfferInstall() {
    if (isStandalone || snoozed()) return;
    if (document.querySelector('.pwa-install-sheet')) return;

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

    if (!installPrompt && !isIOS) return;

    const sheet = document.createElement('div');
    sheet.className = 'sheet pwa-install-sheet';
    sheet.innerHTML = isIOS
      ? `<div class="sheet-body">
           <h3>Zum Home-Bildschirm</h3>
           <p>Tippe unten auf <strong>Teilen</strong> und dann auf
              <strong>„Zum Home-Bildschirm"</strong>. Danach öffnet sich MM⁴
              wie eine App — ohne Browser-Leiste.</p>
           <button type="button" class="btn-secondary" data-dismiss>Verstanden</button>
         </div>`
      : `<div class="sheet-body">
           <h3>MM⁴ installieren</h3>
           <p>Als App auf dem Home-Bildschirm: Vollbild, schnellerer Start,
              und sie funktioniert auch kurz ohne Verbindung.</p>
           <div class="sheet-actions">
             <button type="button" class="btn-secondary" data-dismiss>Später</button>
             <button type="button" class="btn-primary" data-install>Installieren</button>
           </div>
         </div>`;

    sheet.addEventListener('click', (event) => {
      if (event.target === sheet || event.target.hasAttribute('data-dismiss')) {
        snooze();
        sheet.remove();
      }
    });

    sheet.querySelector('[data-install]')?.addEventListener('click', async () => {
      sheet.remove();
      if (!installPrompt) return;
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'dismissed') snooze();
      installPrompt = null;
    });

    document.body.appendChild(sheet);
  }

  document.addEventListener('mm:saved', maybeOfferInstall);

  // --- Haptik --------------------------------------------------------------

  // Nur Android kann das; iOS hat keine Schnittstelle dafür. Deshalb reine
  // Zugabe und nie die einzige Rückmeldung.
  function tap(duration = 10) {
    if ('vibrate' in navigator) navigator.vibrate(duration);
  }

  // --- Wisch von oben zum Neuladen ----------------------------------------

  function setupPullToRefresh() {
    const scroller = document.querySelector('.app-content');
    if (!scroller) return;

    const THRESHOLD = 64;
    let startY = 0;
    let pulling = false;

    const indicator = document.createElement('div');
    indicator.className = 'pull-indicator';
    indicator.textContent = '↓';
    scroller.prepend(indicator);

    scroller.addEventListener('touchstart', (event) => {
      // Nur ganz oben - sonst kämpft die Geste mit dem Scrollen.
      pulling = scroller.scrollTop === 0;
      startY = event.touches[0].clientY;
    }, { passive: true });

    scroller.addEventListener('touchmove', (event) => {
      if (!pulling) return;

      const distance = event.touches[0].clientY - startY;
      if (distance <= 0) {
        pulling = false;
        indicator.style.transform = '';
        return;
      }

      // Mit Widerstand: die Bewegung folgt dem Finger nicht eins zu eins.
      const pulled = Math.min(distance * 0.4, THRESHOLD * 1.5);
      indicator.style.transform = `translateY(${pulled}px)`;
      indicator.classList.toggle('ready', pulled >= THRESHOLD);
    }, { passive: true });

    scroller.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;

      const ready = indicator.classList.contains('ready');
      indicator.style.transform = '';
      indicator.classList.remove('ready');

      if (!ready) return;

      tap(12);
      indicator.classList.add('spinning');
      try {
        if (window.reloadEverything) await window.reloadEverything();
        else location.reload();
      } finally {
        indicator.classList.remove('spinning');
      }
    }, { passive: true });
  }

  // --- Start ---------------------------------------------------------------

  function init() {
    registerServiceWorker();
    setupPullToRefresh();

    if (isStandalone) document.body.classList.add('pwa-standalone');

    // Kurzes Feedback bei jedem Speichern - auf einem Handy ohne sichtbaren
    // Mauszeiger ist das oft die einzige Bestätigung, dass die Berührung
    // angekommen ist.
    document.addEventListener('mm:saved', () => tap());
  }

  window.mmPwa = { isStandalone, tap };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
