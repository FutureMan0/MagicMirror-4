// Magic Mirror Renderer - Dynamische Modul-Verwaltung
let config = null;
let moduleLoader = null;

// Manifeste der installierten Module, kommen mit config-loaded mit. Der
// Renderer braucht daraus vor allem die Privatsphäre-Stufe.
let moduleInfo = new Map();

// Was gerade angezeigt wird: Schlüssel -> { container, entry }. Der Abgleich
// braucht das, um zu erkennen, was schon da ist.
let rendered = new Map();
let gridEl = null;
let absoluteEl = null;

// Wetter-Effekte werden erst erzeugt, wenn ein Modul sie tatsächlich anfordert.
// Vorher lief hier beim Start unbedingt ein vollflächiger Canvas mit, auch wenn
// gar kein Wetter-Modul aktiv war.
if (window.WeatherEffects && !window.weatherEffects) {
  let weatherEffectsInstance = null;
  Object.defineProperty(window, 'weatherEffects', {
    configurable: true,
    get() {
      if (!weatherEffectsInstance) {
        weatherEffectsInstance = new window.WeatherEffects({
          perfProfile: document.documentElement.dataset.perf || 'normal'
        });
        weatherEffectsInstance.init();
      }
      return weatherEffectsInstance;
    }
  });
}

// Legacy Grid-Positionen werden dynamisch basierend auf gridSettings berechnet
function getLegacyGridPosition(positionName, gridSettings) {
  const cols = gridSettings?.columns || 5;
  const rows = gridSettings?.rows || 5;
  
  // Berechne dynamisch: links=1, mitte=mittlere Spalte, rechts=letzte Spalte
  const leftCol = 1;
  const centerCol = Math.ceil(cols / 2);
  const rightCol = cols;
  
  const topRow = 1;
  const middleRow = Math.ceil(rows / 2);
  const bottomRow = rows;
  
  const positions = {
    'top_left': { gridColumn: `${leftCol}`, gridRow: `${topRow}`, justifySelf: 'start', alignSelf: 'start' },
    'top_center': { gridColumn: `${centerCol}`, gridRow: `${topRow}`, justifySelf: 'center', alignSelf: 'start' },
    'top_right': { gridColumn: `${rightCol}`, gridRow: `${topRow}`, justifySelf: 'end', alignSelf: 'start' },
    'middle_left': { gridColumn: `${leftCol}`, gridRow: `${middleRow}`, justifySelf: 'start', alignSelf: 'start' },
    'middle_center': { gridColumn: `${centerCol}`, gridRow: `${middleRow}`, justifySelf: 'center', alignSelf: 'start' },
    'middle_right': { gridColumn: `${rightCol}`, gridRow: `${middleRow}`, justifySelf: 'end', alignSelf: 'start' },
    'bottom_left': { gridColumn: `${leftCol}`, gridRow: `${bottomRow}`, justifySelf: 'start', alignSelf: 'end' },
    'bottom_center': { gridColumn: `${centerCol}`, gridRow: `${bottomRow}`, justifySelf: 'center', alignSelf: 'end' },
    'bottom_right': { gridColumn: `${rightCol}`, gridRow: `${bottomRow}`, justifySelf: 'end', alignSelf: 'end' }
  };
  
  return positions[positionName] || null;
}

// Generiert dynamisches CSS für das Grid basierend auf gridSettings
/**
 * Den Spiegel drehen.
 *
 * Als CSS-Drehung im Renderer, nicht ueber xrandr: so wirkt sie auch in der
 * Live-Vorschau am Handy, sie braucht keine Rechte auf dem Geraet, und sie
 * ueberlebt einen Wechsel des Anzeigeservers. Bei 90 und 270 Grad tauschen
 * Breite und Hoehe die Rollen - sonst steht der Spiegel gedreht, aber im
 * falschen Format.
 */
function wendeDrehungAn(config) {
  const erlaubt = [0, 90, 180, 270];
  const grad = Number(config?.display?.rotation) || 0;
  document.documentElement.dataset.rotate = String(erlaubt.includes(grad) ? grad : 0);
}

function buildGridCSS(gridSettings, config) {
  // Ein Layout aus Zonen braucht das grobe Zonen-Raster, nicht das feine
  // 8x10 aus der Konfiguration - sonst landen die Zonen in Zelle 1 bis 3 von
  // acht und der Rest bleibt leer.
  const zonen = (typeof window !== 'undefined' && window.MMZonen) || null;
  if (zonen && config && Array.isArray(config.modules)) {
    const platzierte = config.modules.filter(m => m.enabled !== false && m.position);
    const alleZonen = platzierte.length > 0 && platzierte.every(m => zonen.alsZone(m.position));
    if (alleZonen) gridSettings = zonen.ZONEN_RASTER;
  }

  if (!gridSettings) {
    gridSettings = {
      columns: 3,
      rows: 3,
      gap: 12,
      padding: 12,
      columnSizes: ['minmax(320px, 1fr)', '1fr', '1fr'],
      rowSizes: ['auto', '1fr', '1fr']
    };
  }

  // Erstelle grid-template-columns String
  const columnTemplate = gridSettings.columnSizes && gridSettings.columnSizes.length > 0
    ? gridSettings.columnSizes.join(' ')
    : `repeat(${gridSettings.columns}, 1fr)`;

  // Erstelle grid-template-rows String
  const rowTemplate = gridSettings.rowSizes && gridSettings.rowSizes.length > 0
    ? gridSettings.rowSizes.join(' ')
    : `repeat(${gridSettings.rows}, 1fr)`;

  // Setze ALLE CSS Custom Properties auf :root (werden von CSS verwendet)
  const root = document.documentElement;
  root.style.setProperty('--grid-columns', gridSettings.columns);
  root.style.setProperty('--grid-rows', gridSettings.rows);
  root.style.setProperty('--grid-gap', `${gridSettings.gap}px`);
  root.style.setProperty('--grid-padding', `${gridSettings.padding}px`);
  root.style.setProperty('--grid-column-template', columnTemplate);
  root.style.setProperty('--grid-row-template', rowTemplate);

  console.log('Grid CSS angewendet:', {
    columns: gridSettings.columns,
    rows: gridSettings.rows,
    columnTemplate,
    rowTemplate
  });
}

// Konvertiert alle Position-Formate in ein einheitliches Format
function parsePosition(position, gridSettings) {
  // Zonen zuerst: sie sind der Normalfall, seit das Layout ueber Zonen
  // eingestellt wird. Alte Namen wie "top_left" bildet alsZone() mit ab.
  const zonen = (typeof window !== 'undefined' && window.MMZonen) || null;
  const ausZone = zonen && zonen.platzierung(position);
  if (ausZone) return ausZone;

  // String-Position (Legacy-Format wie "top_left")
  if (typeof position === 'string') {
    const pos = getLegacyGridPosition(position, gridSettings);
    if (pos) {
      return {
        type: 'grid',
        gridColumn: pos.gridColumn,
        gridRow: pos.gridRow,
        justifySelf: pos.justifySelf,
        alignSelf: pos.alignSelf
      };
    }
    return null;
  }

  // Objekt-Position
  if (typeof position === 'object') {
    // Grid-basierte Position mit column/row
    if (position.column !== undefined && position.row !== undefined) {
      return {
        type: 'grid',
        gridColumn: calculateGridArea(position.column, position.columnSpan),
        gridRow: calculateGridArea(position.row, position.rowSpan),
        // Der Container fuellt seine Rasterflaeche immer aus. Frueher stand
        // hier justifySelf/alignSelf 'start' - dann schrumpfte das Modul auf
        // seinen Inhalt, und der Layout-Editor zeigte einen Block, den es am
        // Spiegel nie gab. Was man anordnet, soll man auch sehen.
        justifySelf: 'stretch',
        alignSelf: 'stretch',
        // Wo der Inhalt INNERHALB der Flaeche sitzt. Vorgabe 'stretch': ein
        // Modul soll den Platz nutzen, den man ihm im Editor gegeben hat.
        contentJustify: position.justify || 'stretch',
        contentAlign: position.align || 'stretch'
      };
    }

    // Freie absolute Positionierung
    if (position.x !== undefined || position.y !== undefined) {
      return {
        type: 'absolute',
        x: position.x,
        y: position.y,
        width: position.width,
        height: position.height,
        zIndex: position.zIndex
      };
    }
  }

  return null;
}

// Berechnet grid-column/grid-row String für Spanning
function calculateGridArea(start, span) {
  if (span && span > 1) {
    return `${start} / span ${span}`;
  }
  return `${start}`;
}

// Metadaten der verfügbaren Themes, damit der Renderer den Hell/Dunkel-Modus
// kennt. Wird beim ersten Bedarf geholt und danach gemerkt.
let themeCatalog = null;

async function getThemeMeta(themeId) {
  if (!themeCatalog) {
    try {
      const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
      const response = await fetch(`${apiBase}/api/themes`);
      themeCatalog = response.ok ? await response.json() : [];
    } catch {
      // Ohne Server läuft der Spiegel trotzdem - nur ohne Modus-Angabe.
      themeCatalog = [];
    }
  }
  return themeCatalog.find((theme) => theme.id === themeId) || {};
}

async function applyTheme() {
  const themeId = config.theme || 'default';
  const meta = await getThemeMeta(themeId);
  await window.mmThemeEngine.applyTheme(themeId, meta);
}

/** Baut den Rahmen eines Moduls samt seiner Attribute. */
function createModuleContainer(moduleConfig) {
  const element = document.createElement('div');
  element.className = 'module-container';
  element.dataset.moduleName = moduleConfig.module;

  // Nach diesen Attributen blendet privacy.css aus - ohne Neuaufbau.
  // Fehlt die Angabe, gilt das Modul als heikel.
  const info = moduleInfo.get(moduleConfig.module) || {};
  element.dataset.privacyLevel = info.privacyLevel || 'sensitive';
  if (info.showInShower) element.dataset.showInShower = 'true';

  // Optionale Modulseite - nur gesetzt, wenn die Konfiguration eine nennt.
  if (moduleConfig.page) element.dataset.page = String(moduleConfig.page);

  return element;
}

/**
 * Setzt einen Rahmen an seinen Platz. Getrennt vom Erzeugen, weil eine
 * verschobene Kachel nur neu platziert werden muss - nicht neu gebaut.
 */
function placeModuleContainer(element, moduleConfig) {
  const parsed = parsePosition(moduleConfig.position, config.gridSettings);

  /** 'start'/'center'/'end' auf die Flexbox-Schreibweise bringen. */
  function flexWert(wert) {
    if (wert === 'center') return 'center';
    if (wert === 'end') return 'flex-end';
    if (wert === 'stretch') return 'stretch';
    return 'flex-start';
  }

  // Alte Platzierung zurücksetzen, sonst bleiben Reste stehen, wenn ein Modul
  // von absolut auf Raster wechselt.
  element.style.gridColumn = '';
  element.style.gridRow = '';
  element.style.justifySelf = '';
  element.style.alignSelf = '';
  element.style.justifyContent = '';
  element.style.alignItems = '';
  element.style.position = '';
  element.style.left = '';
  element.style.top = '';
  element.style.width = '';
  element.style.height = '';
  element.style.zIndex = '';

  if (parsed && parsed.type === 'grid') {
    element.style.gridColumn = parsed.gridColumn;
    element.style.gridRow = parsed.gridRow;
    element.style.justifySelf = parsed.justifySelf;
    element.style.alignSelf = parsed.alignSelf;
    if (parsed.contentAlign || parsed.contentJustify) {
      // Spalte: senkrecht = justify-content, waagerecht = align-items.
      element.style.justifyContent = flexWert(parsed.contentAlign);
      element.style.alignItems = flexWert(parsed.contentJustify);
    }
    gridEl.appendChild(element);
    return;
  }

  if (parsed && parsed.type === 'absolute') {
    element.style.position = 'absolute';
    if (parsed.x) element.style.left = parsed.x;
    if (parsed.y) element.style.top = parsed.y;
    if (parsed.width) element.style.width = parsed.width;
    if (parsed.height) element.style.height = parsed.height;
    if (parsed.zIndex) element.style.zIndex = parsed.zIndex;
    absoluteEl.appendChild(element);
    return;
  }

  // Ohne verwertbare Angabe ins Raster - die automatische Platzierung
  // übernimmt.
  gridEl.appendChild(element);
}

let isRendering = false;

async function renderModules() {
  if (isRendering) {
    console.warn('Neu-Rendern bereits im Gange, überspringe...');
    return;
  }
  isRendering = true;

  try {
    if (moduleLoader) {
      moduleLoader.destroyAll();
    }

    await applyTheme();

    const container = document.getElementById('modules-container');
    if (!container || !config || !config.modules) return;

    // Sofort leeren, um Geister-Module zu vermeiden
    container.innerHTML = '';
    document.documentElement.lang = config.language || 'en';

    // Container für Grid-Module
    const gridContainer = document.createElement('div');
    gridContainer.className = 'modules-grid';
    container.appendChild(gridContainer);

    // Container für Absolut positionierte Module
    const absoluteContainer = document.createElement('div');
    absoluteContainer.className = 'modules-absolute';
    container.appendChild(absoluteContainer);

    gridEl = gridContainer;
    absoluteEl = absoluteContainer;
    rendered = new Map();

    // Grid-CSS dynamisch anwenden
    buildGridCSS(config.gridSettings, config);
    wendeDrehungAn(config);

    if (!moduleLoader) {
      moduleLoader = new window.RendererModuleLoader();
      // privacy.js benachrichtigt darüber die Module.
      window.mmModuleLoader = moduleLoader;
    }

    const envConfig = config.env || {};

    // Ergebnis je Modul festhalten. Der Smoke-Test in CI wertet das aus - es
    // ist der einzige Nachweis, dass die App wirklich startet und nicht nur
    // die Tests gruen sind.
    const mounted = [];
    const failed = [];

    for (const [moduleIndex, moduleConfig] of config.modules.entries()) {
      if (moduleConfig.enabled === false) continue;

      const moduleContainer = createModuleContainer(moduleConfig);
      placeModuleContainer(moduleContainer, moduleConfig);

      try {
        const result = await moduleLoader.createModuleInstance(
          moduleConfig.module,
          moduleConfig.config || {},
          envConfig,
          config.language || 'en',
          window.mmReconciler.keyOf(moduleConfig, moduleIndex)
        );

        if (result.element) {
          moduleContainer.appendChild(result.element);
        } else if (result.headless) {
          // Modul ohne Anzeige: kein leerer Container im Raster.
          moduleContainer.remove();
        }

        if (result.ok) {
          mounted.push(moduleConfig.module);
          rendered.set(window.mmReconciler.keyOf(moduleConfig, moduleIndex), {
            container: moduleContainer,
            entry: moduleConfig
          });
        } else {
          failed.push({ module: moduleConfig.module, error: result.error });
        }
      } catch (error) {
        console.error(`Fehler bei Modul ${moduleConfig.module}:`, error);
        moduleContainer.appendChild(createErrorPlaceholder(moduleConfig.module, error.message));
        failed.push({ module: moduleConfig.module, error: error.message });
      }
    }

    if (window.mmBus) {
      window.mmBus.publish('system:modules-rendered', {
        mounted,
        failed,
        theme: config.theme || 'default'
      });
    }
  } catch (error) {
    console.error('Fehler beim Rendern der Module:', error);
    if (window.mmBus) {
      window.mmBus.publish('system:render-failed', { error: error.message });
    }
  } finally {
    isRendering = false;
  }
}

/**
 * Wendet eine geänderte Konfiguration an - und fasst dabei nur an, was sich
 * wirklich geändert hat.
 *
 * Vorher lief jede Änderung über renderModules(): alle Module zerstören,
 * alles neu aufbauen. Wer am Handy eine Einstellung der Uhr verstellte, löste
 * damit aus, dass das Wetter neu geladen und der Stundenplan neu abgefragt
 * wurde - und für einen Moment stand der halbe Spiegel leer.
 */
async function applyConfig(nextConfig) {
  const previous = config;
  config = nextConfig;

  // Ohne bisherigen Stand oder ohne Reconciler bleibt nur der Komplettaufbau.
  if (!previous || !window.mmReconciler || rendered.size === 0) {
    return renderModules();
  }

  const changes = window.mmReconciler.diff(previous, nextConfig);

  if (window.mmReconciler.isEmpty(changes)) return;

  document.documentElement.lang = nextConfig.language || 'en';

  // Sprache betrifft jedes Modul - da lohnt der Abgleich nicht.
  if (changes.language) return renderModules();

  if (changes.theme) await applyTheme();
  if (changes.grid) buildGridCSS(nextConfig.gridSettings);

  for (const { key } of changes.removed) {
    const current = rendered.get(key);
    if (!current) continue;

    moduleLoader.destroyInstance(key);
    current.container.remove();
    rendered.delete(key);
  }

  // Nur umplatzieren: Rasterposition liegt im Style, nicht in der
  // DOM-Reihenfolge - ein Verschieben kostet damit nichts.
  for (const { key, entry } of changes.moved) {
    const current = rendered.get(key);
    if (!current) continue;

    placeModuleContainer(current.container, entry);
    current.entry = entry;
  }

  for (const change of changes.patched) {
    const current = rendered.get(change.key);
    if (!current) continue;

    const instance = moduleLoader.getInstance(change.key);
    const decision = window.mmReconciler.decide(instance, change.entry, change.changed);

    if (change.moved) placeModuleContainer(current.container, change.entry);
    current.entry = change.entry;

    if (decision === 'patch') {
      // Das Modul übernimmt die neuen Werte selbst.
      Object.assign(instance.config, change.entry.config || {});
      instance.requestUpdate ? instance.requestUpdate() : instance.update?.();
      continue;
    }

    await remountModule(change.key, change.entry, current.container);
  }

  for (const { key, entry } of changes.added) {
    const container = createModuleContainer(entry);
    placeModuleContainer(container, entry);
    rendered.set(key, { container, entry });
    await remountModule(key, entry, container);
  }
}

/** Baut genau ein Modul neu auf, ohne die übrigen anzufassen. */
async function remountModule(key, entry, container) {
  moduleLoader.destroyInstance(key);
  container.textContent = '';

  try {
    const result = await moduleLoader.createModuleInstance(
      entry.module,
      entry.config || {},
      config.env || {},
      config.language || 'en',
      key
    );

    if (result.element) {
      container.appendChild(result.element);
    } else if (result.headless) {
      container.remove();
      rendered.delete(key);
      return;
    }

    if (!result.ok) {
      container.appendChild(createErrorPlaceholder(entry.module, result.error));
    }
  } catch (error) {
    console.error(`Fehler bei Modul ${entry.module}:`, error);
    container.appendChild(createErrorPlaceholder(entry.module, error.message));
  }
}

function createErrorPlaceholder(moduleName, errorMessage) {
  const lang = (config && config.language) || 'en';
  const defaultMessage = lang === 'de' ? 'Modul konnte nicht geladen werden' : 'Module could not be loaded';
  const message = errorMessage || defaultMessage;
  const placeholder = document.createElement('div');
  placeholder.className = 'module-placeholder';
  placeholder.innerHTML = `
    <div class="module-error">
      <div class="module-error-title">${moduleName}</div>
      <div class="module-error-message">${message}</div>
    </div>
  `;
  return placeholder;
}

/**
 * Hinweis, wenn die Ansicht ohne Konfiguration dasteht. Ohne das bliebe ein
 * schwarzes Bild - nicht unterscheidbar von "der Spiegel ist einfach aus".
 */
function showStandaloneError(message) {
  const container = document.getElementById('modules-container');
  if (!container) return;

  const box = document.createElement('div');
  box.className = 'module-placeholder standalone-error';
  box.appendChild(Object.assign(document.createElement('div'), {
    className: 'module-error-title',
    textContent: 'MagicMirror⁴'
  }));
  box.appendChild(Object.assign(document.createElement('div'), {
    className: 'module-error-message',
    textContent: message
  }));

  container.innerHTML = '';
  container.appendChild(box);
}

/**
 * In einem normalen Browser gibt es kein IPC. Damit die Vorschau trotzdem
 * mitzieht, wenn jemand die Konfiguration aendert, haengt sie sich an
 * denselben WebSocket wie die Web-Oberflaeche.
 */
function connectLivePreview(instance) {
  if (typeof WebSocket === 'undefined') return;

  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket;
  try {
    socket = new WebSocket(`${scheme}//${window.location.host}/ws`);
  } catch {
    return;
  }

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'hello', clientId: `mirror-preview-${Date.now()}` }));
    socket.send(JSON.stringify({ type: 'subscribe', topics: ['config:*', 'presence:*'] }));
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type !== 'event') return;

    if (message.topic === 'config:changed') {
      const payload = message.payload || {};
      if (instance && payload.instance && payload.instance !== instance) return;
      if (!payload.config) return;

      applyConfig(payload.config);
    }

    if (message.topic === 'presence:display' && !document.documentElement.dataset.preview) {
      document.body.style.opacity = message.payload && message.payload.on ? '1' : '0.1';
    }
  });

  // Bricht die Verbindung weg, laeuft die Vorschau einfach ohne Nachfuehrung
  // weiter - ein Reconnect waere hier mehr Aufwand als Nutzen.
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.electronAPI) {
    window.electronAPI.onConfigLoaded((data) => {
      config = data.config;

      if (Array.isArray(data.modules)) {
        moduleInfo = new Map(data.modules.map(entry => [entry.name, entry.info || {}]));
      }

      if (data.privacy && window.mmPrivacy) {
        window.mmPrivacy.apply(data.privacy);
      }
      // Perf-Profil aus dem Hauptprozess. Steuert Blur, Dauer-Animationen und
      // die Bildrate der Wetter-Effekte (siehe main.css und weatherEffects.js).
      if (data.perfProfile) {
        document.documentElement.dataset.perf = data.perfProfile;
      }
      renderModules();
    });

    window.electronAPI.onConfigUpdate((newConfig) => {
      applyConfig(newConfig);
    });

    // Dimmen laeuft jetzt ueber den Bus. Die eigenen IPC-Kanaele
    // presence-detected/-lost entfallen damit.
    window.mmBus.on('presence:display', (payload) => {
      if (document.documentElement.dataset.preview) return;
      document.body.style.opacity = payload && payload.on ? '1' : '0.1';
    });
  } else {
    // Kein electronAPI: die Ansicht laeuft in einem normalen Browser, etwa als
    // Live-Vorschau am Handy. Instanz und Vorschau-Modus stehen dann in der
    // Adresse.
    const params = new URLSearchParams(window.location.search);
    const instance = params.get('instance');
    const isPreview = params.get('preview') === '1';

    if (isPreview) {
      // In der Vorschau nicht dimmen - sonst sieht man ein fast schwarzes
      // Bild und haelt die Vorschau fuer kaputt.
      document.documentElement.dataset.preview = '1';
    }

    const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
    const query = instance ? `?instance=${encodeURIComponent(instance)}` : '';

    fetch(`${apiBase}/api/config${query}`, { credentials: 'same-origin' })
      .then(res => {
        if (res.status === 401) throw new Error('nicht angemeldet');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        config = data;
        renderModules();
        connectLivePreview(instance);
      })
      .catch(err => {
        console.error('Config laden fehlgeschlagen:', err);
        showStandaloneError(err.message === 'nicht angemeldet'
          ? 'Nicht angemeldet — bitte die Web-Oberfläche öffnen und koppeln.'
          : `Konfiguration konnte nicht geladen werden: ${err.message}`);
      });
  }
});
