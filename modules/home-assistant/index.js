// Home Assistant am Spiegel.
//
// Bewusst schreibgeschützt: der Spiegel ist kein Touchscreen, und ein
// versehentlich ausgelöster Schalter beim Vorbeigehen wäre ärgerlicher als
// nützlich. Geschaltet wird am Handy, im Steuerungs-Tab.
var HaBase = (typeof window !== 'undefined' && window.DataModule) || class {};

class HomeAssistantModule extends HaBase {
  static moduleName = 'home-assistant';
  static patchable = ['showUnavailable'];

  // Als Klassenfeld und nicht auf oberster Ebene: unter file:// teilen sich
  // alle Module einen globalen Scope.
  static texte = {
    de: {
      title: 'Zuhause',
      noneReachable: 'Keine der eingetragenen Entitäten ist erreichbar.',
      noneListed: 'Noch keine Entitäten eingetragen.',
      states: {
        on: 'an', off: 'aus',
        open: 'offen', closed: 'zu',
        home: 'zuhause', not_home: 'unterwegs',
        playing: 'läuft', paused: 'pausiert', idle: 'bereit'
      }
    },
    en: {
      title: 'Home',
      noneReachable: 'None of the listed entities can be reached.',
      noneListed: 'No entities listed yet.',
      states: {
        on: 'on', off: 'off',
        open: 'open', closed: 'closed',
        home: 'home', not_home: 'away',
        playing: 'playing', paused: 'paused', idle: 'idle'
      }
    }
  };

  /** Die Texte in der Sprache des Spiegels. */
  get texte() {
    const alle = HomeAssistantModule.texte;
    return alle[this.config?.language] || alle.en;
  }

  constructor(config = {}) {
    super(config);

    this.config = {
      language: config.language || 'de',
      ...config
    };
  }

  get title() {
    return this.texte.title;
  }

  renderData(data, root) {
    root.textContent = '';

    const entities = (data && data.entities) || [];
    if (entities.length === 0) {
      root.appendChild(this.buildNotice(
        'dm-error',
        data && data.total > 0
          ? this.texte.noneReachable
          : this.texte.noneListed
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

    const zustand = String(entity.state).toLowerCase();
    if (zustand === 'unavailable') return '—';
    return this.texte.states[zustand] || entity.state;
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
