// Privatsphäre am Handy.
//
// Der wichtigste Teil ist nicht der Umschalter, sondern die Anzeige darunter:
// ob der Sensor gerade läuft. Und dass dort ehrlich steht, wie weit eine
// Software-Abschaltung überhaupt trägt.
(function () {
  // Schluessel in i18n.js. „Normal" heisst in beiden Sprachen so und steht
  // deshalb als fester Name hier, nicht im Woerterbuch.
  const MODES = [
    { id: 'normal', name: 'Normal', hint: 'privacyNormalHint' },
    { id: 'guest', label: 'privacyGuest', hint: 'privacyGuestHint' },
    { id: 'shower', label: 'privacyShower', hint: 'privacyShowerHint' },
    { id: 'off', label: 'privacyOff', hint: 'privacyOffHint' }
  ];

  let state = null;

  async function load() {
    const body = document.getElementById('privacy-body');
    if (!body) return;

    try {
      const response = await fetch('/api/privacy');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state = await response.json();
      render();
    } catch (error) {
      body.textContent = t('privacyStateFailed');
    }
  }

  async function setMode(mode) {
    const body = document.getElementById('privacy-body');

    try {
      const response = await fetch('/api/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t('serverRefused'));

      state = result;
      if (window.mmPwa) window.mmPwa.tap();
      render();
    } catch (error) {
      const notice = document.createElement('div');
      notice.className = 'privacy-notice privacy-error';
      notice.textContent = error.message;
      body.prepend(notice);
      setTimeout(() => notice.remove(), 4000);
    }
  }

  function render() {
    const body = document.getElementById('privacy-body');
    body.textContent = '';

    const grid = document.createElement('div');
    grid.className = 'privacy-modes';

    for (const mode of MODES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'privacy-mode';
      if (state.mode === mode.id) button.classList.add('active');

      const label = document.createElement('span');
      label.className = 'privacy-mode-label';
      label.textContent = mode.name || t(mode.label);
      button.appendChild(label);

      const hint = document.createElement('span');
      hint.className = 'privacy-mode-hint';
      hint.textContent = t(mode.hint);
      button.appendChild(hint);

      button.addEventListener('click', () => setMode(mode.id));
      grid.appendChild(button);
    }

    body.appendChild(grid);

    if (state.expiresAt) {
      const minutes = Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000));
      const note = document.createElement('div');
      note.className = 'privacy-notice';
      note.textContent = t('privacyRevertsIn', { n: minutes });
      body.appendChild(note);
    }

    body.appendChild(buildSensorStatus());
  }

  /**
   * Der Sensor-Zustand — gemessen, nicht angenommen.
   *
   * Eine Anzeige, die behauptet, die Kamera sei aus, weil das mal jemand
   * angeordnet hat, wäre schlimmer als gar keine.
   */
  function buildSensorStatus() {
    const box = document.createElement('div');
    box.className = 'privacy-sensor';

    const sensor = state.sensor;
    if (!sensor) {
      box.textContent = t('noSensor');
      return box;
    }

    const row = document.createElement('div');
    row.className = 'privacy-sensor-row';

    const dot = document.createElement('span');
    dot.className = 'privacy-sensor-dot';
    dot.dataset.active = String(sensor.active);
    row.appendChild(dot);

    const label = document.createElement('span');
    label.textContent = sensor.active ? t('sensorActive') : t('sensorOff');
    row.appendChild(label);

    box.appendChild(row);

    if (sensor.uncertain) {
      const warn = document.createElement('div');
      warn.className = 'privacy-notice privacy-error';
      warn.textContent = sensor.lastError || t('sensorUncertain');
      box.appendChild(warn);
    }

    const honesty = document.createElement('div');
    honesty.className = 'privacy-notice';
    // Derselbe Satz, den der Server als `note` mitschickt - hier aus dem
    // Woerterbuch, damit er in der eingestellten Sprache steht.
    honesty.textContent = t('sensorNote');
    box.appendChild(honesty);

    return box;
  }

  document.addEventListener('mm:event', (event) => {
    if (event.detail?.topic?.startsWith('privacy:')) load();
  });

  // Nach einem Sprachwechsel mit dem vorhandenen Stand neu zeichnen.
  document.addEventListener('mm:language', () => {
    if (state) render();
  });

  window.mmPrivacyUi = { load };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
