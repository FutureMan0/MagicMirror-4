// Steuerungs-Tab: Home-Assistant-Entitäten am Handy schalten.
//
// Am Spiegel sind die Kacheln bewusst schreibgeschützt - er ist kein
// Touchscreen, und ein versehentlicher Griff im Vorbeigehen wäre ärgerlicher
// als nützlich. Hier dagegen ist Schalten der ganze Zweck.
//
// Die Schalter sind optimistisch: der Zustand springt sofort um, und erst
// wenn der Server widerspricht, geht er zurück. Auf die Antwort zu warten
// fühlt sich bei einer Lampe im selben Raum falsch an - man sieht ja, dass
// sie angeht.
(function () {
  const DOMAIN_SERVICES = {
    light: 'toggle',
    switch: 'toggle',
    input_boolean: 'toggle',
    fan: 'toggle',
    scene: 'turn_on',
    script: 'turn_on',
    media_player: 'media_play_pause',
    cover: null // Rollläden brauchen zwei Knöpfe, nicht einen Umschalter.
  };

  let entities = [];
  let controlEnabled = false;
  let available = false;

  async function load() {
    const body = document.getElementById('control-body');
    if (!body) return;

    try {
      const response = await fetch('/api/home-assistant/data');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const envelope = await response.json();
      entities = envelope.data?.entities || [];
      controlEnabled = Boolean(envelope.data?.controlEnabled);
      available = true;

      render(envelope);
    } catch (error) {
      available = false;
      body.textContent = 'Home Assistant ist nicht eingerichtet.';
    }

    updateNavVisibility();
  }

  /** Der Tab erscheint nur, wenn es etwas zu steuern gibt. */
  function updateNavVisibility() {
    const nav = document.getElementById('nav-control');
    if (nav) nav.hidden = !available || entities.length === 0;
  }

  function render(envelope) {
    const body = document.getElementById('control-body');
    body.textContent = '';

    if (!envelope.ok && envelope.error) {
      const notice = document.createElement('div');
      notice.className = 'control-notice';
      notice.textContent = `Nicht erreichbar: ${envelope.error.message}`;
      body.appendChild(notice);
    }

    if (!controlEnabled) {
      const notice = document.createElement('div');
      notice.className = 'control-notice';
      // Wichtig, dass das hier steht: sonst tippt man auf Kacheln, die sich
      // nicht rühren, und sucht den Fehler woanders.
      notice.textContent = 'Schalten ist ausgeschaltet. In den Einstellungen des '
        + 'Home-Assistant-Moduls unter „Schalten erlauben" aktivieren.';
      body.appendChild(notice);
    }

    if (entities.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Keine Entitäten eingetragen.';
      body.appendChild(empty);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'control-grid';

    for (const entity of entities) {
      grid.appendChild(buildTile(entity));
    }

    body.appendChild(grid);
  }

  function buildTile(entity) {
    const tile = document.createElement('div');
    tile.className = 'control-tile';
    tile.dataset.entity = entity.entityId;
    if (isOn(entity)) tile.dataset.state = 'on';
    if (!entity.available) tile.dataset.state = 'unavailable';

    const name = document.createElement('div');
    name.className = 'control-tile-name';
    name.textContent = entity.name;
    tile.appendChild(name);

    const state = document.createElement('div');
    state.className = 'control-tile-state';
    state.textContent = describe(entity);
    tile.appendChild(state);

    const service = DOMAIN_SERVICES[entity.domain];
    const canControl = controlEnabled && entity.controllable && entity.available;

    if (entity.domain === 'cover' && canControl) {
      tile.appendChild(buildCoverButtons(entity));
    } else if (service && canControl) {
      tile.classList.add('control-tile-tappable');
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '0');
      tile.addEventListener('click', () => call(entity, service, tile));
    }

    return tile;
  }

  function buildCoverButtons(entity) {
    const row = document.createElement('div');
    row.className = 'control-cover';

    for (const [label, service] of [['▲', 'open_cover'], ['■', 'stop_cover'], ['▼', 'close_cover']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-secondary';
      button.textContent = label;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        call(entity, service, null);
      });
      row.appendChild(button);
    }

    return row;
  }

  async function call(entity, service, tile) {
    // Optimistisch umschalten - und bei Widerspruch zurücknehmen.
    const previous = tile?.dataset.state;
    if (tile) tile.dataset.state = previous === 'on' ? '' : 'on';
    if (window.mmPwa) window.mmPwa.tap();

    try {
      const response = await fetch('/api/home-assistant/action/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: entity.entityId, service })
      });

      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Der Server hat abgelehnt.');

      // Kurz warten: Home Assistant meldet den neuen Zustand nicht sofort
      // zurück, und ein sofortiger Abruf brächte noch den alten.
      setTimeout(load, 600);
    } catch (error) {
      if (tile && previous !== undefined) tile.dataset.state = previous;
      showControlError(error.message);
    }
  }

  function showControlError(message) {
    const body = document.getElementById('control-body');
    if (!body) return;

    let notice = body.querySelector('.control-error');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'control-notice control-error';
      body.prepend(notice);
    }

    notice.textContent = message;
    setTimeout(() => notice.remove(), 5000);
  }

  function isOn(entity) {
    return ['on', 'open', 'playing', 'home'].includes(String(entity.state).toLowerCase());
  }

  function describe(entity) {
    if (!entity.available) return 'nicht erreichbar';
    if (entity.domain === 'media_player' && entity.mediaTitle) return entity.mediaTitle;
    if (entity.unit) return `${entity.state} ${entity.unit}`;

    const words = {
      on: 'an', off: 'aus', open: 'offen', closed: 'zu',
      playing: 'läuft', paused: 'pausiert', idle: 'bereit',
      home: 'zuhause', not_home: 'unterwegs'
    };
    return words[String(entity.state).toLowerCase()] || entity.state;
  }

  // Bei einer Zustandsänderung aus dem Bus sofort nachziehen.
  document.addEventListener('mm:event', (event) => {
    if (event.detail?.topic === 'data:home-assistant') load();
  });

  window.mmControl = { load };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
