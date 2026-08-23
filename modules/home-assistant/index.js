// Home Assistant am Spiegel.
//
// Bewusst schreibgeschützt: der Spiegel ist kein Touchscreen, und ein
// versehentlich ausgelöster Schalter beim Vorbeigehen wäre ärgerlicher als
// nützlich. Geschaltet wird am Handy, im Steuerungs-Tab.
var HaBase = (typeof window !== 'undefined' && window.DataModule) || class {};

class HomeAssistantModule extends HaBase {
  static moduleName = 'home-assistant';
  static patchable = ['showUnavailable'];

  constructor(config = {}) {
    super(config);

    this.config = {
      language: config.language || 'de',
      ...config
    };
  }

  get title() {
    return 'Zuhause';
  }

  renderData(data, root) {
    root.textContent = '';

    const entities = (data && data.entities) || [];
    if (entities.length === 0) {
      root.appendChild(this.buildNotice(
        'dm-error',
        data && data.total > 0
          ? 'Keine der eingetragenen Entitäten ist erreichbar.'
          : 'Noch keine Entitäten eingetragen.'
      ));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'ha-grid';

    for (const entity of entities) {
      grid.appendChild(this.renderEntity(entity));
    }

    root.appendChild(grid);
  }

  renderEntity(entity) {
    const tile = document.createElement('div');
    tile.className = 'ha-tile';
    tile.dataset.domain = entity.domain;
    if (!entity.available) tile.dataset.state = 'unavailable';
    else if (this.isOn(entity)) tile.dataset.state = 'on';

    const name = document.createElement('div');
    name.className = 'ha-tile-name';
    name.textContent = entity.name;
    tile.appendChild(name);

    const value = document.createElement('div');
    value.className = 'ha-tile-value';
    value.textContent = this.formatState(entity);
    tile.appendChild(value);

    return tile;
  }

  isOn(entity) {
    return ['on', 'open', 'playing', 'home'].includes(String(entity.state).toLowerCase());
  }

  formatState(entity) {
    if (!entity.available) return '—';

    // Ein Medienspieler sagt "playing" - der Titel ist die nützlichere
    // Auskunft.
    if (entity.domain === 'media_player' && entity.mediaTitle) {
      return entity.mediaTitle;
    }

    if (entity.unit) return `${entity.state} ${entity.unit}`;

    const words = {
      on: 'an', off: 'aus',
      open: 'offen', closed: 'zu',
      home: 'zuhause', not_home: 'unterwegs',
      playing: 'läuft', paused: 'pausiert', idle: 'bereit',
      unavailable: '—'
    };

    return words[String(entity.state).toLowerCase()] || entity.state;
  }
}

// Browser: Registriere in globaler Registry
if (typeof window !== 'undefined' && window.MagicMirrorModules) {
  window.MagicMirrorModules['home-assistant'] = HomeAssistantModule;
}

// Node.js: Exportiere als CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HomeAssistantModule;
}
