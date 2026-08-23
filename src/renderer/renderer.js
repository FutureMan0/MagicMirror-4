// Magic Mirror Renderer - Dynamische Modul-Verwaltung
let config = null;
let moduleLoader = null;

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
function buildGridCSS(gridSettings) {
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
        justifySelf: position.justify || 'start',
        alignSelf: position.align || 'start'
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

// Vergleicht zwei Konfigurationen und meldet, ob sich ausschließlich das
// Theme unterscheidet.
function onlyThemeChanged(previous, next) {
  if (previous.theme === next.theme) return false;
  const strip = (cfg) => JSON.stringify({ ...cfg, theme: null });
  return strip(previous) === strip(next);
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

    // Grid-CSS dynamisch anwenden
    buildGridCSS(config.gridSettings);

    if (!moduleLoader) {
      moduleLoader = new window.RendererModuleLoader();
    }

    const envConfig = config.env || {};

    // Ergebnis je Modul festhalten. Der Smoke-Test in CI wertet das aus - es
    // ist der einzige Nachweis, dass die App wirklich startet und nicht nur
    // die Tests gruen sind.
    const mounted = [];
    const failed = [];

    for (const [moduleIndex, moduleConfig] of config.modules.entries()) {
      if (moduleConfig.enabled === false) continue;

      const moduleContainer = document.createElement('div');
      moduleContainer.className = 'module-container';
      moduleContainer.dataset.moduleName = moduleConfig.module;

      // Parse Position mit neuer Funktion
      const parsedPos = parsePosition(moduleConfig.position, config.gridSettings);

      if (parsedPos) {
        if (parsedPos.type === 'grid') {
          // Grid-basierte Position
          moduleContainer.style.gridColumn = parsedPos.gridColumn;
          moduleContainer.style.gridRow = parsedPos.gridRow;
          moduleContainer.style.justifySelf = parsedPos.justifySelf;
          moduleContainer.style.alignSelf = parsedPos.alignSelf;
          gridContainer.appendChild(moduleContainer);
        } else if (parsedPos.type === 'absolute') {
          // Absolute Position
          moduleContainer.style.position = 'absolute';
          if (parsedPos.x) moduleContainer.style.left = parsedPos.x;
          if (parsedPos.y) moduleContainer.style.top = parsedPos.y;
          if (parsedPos.width) moduleContainer.style.width = parsedPos.width;
          if (parsedPos.height) moduleContainer.style.height = parsedPos.height;
          if (parsedPos.zIndex) moduleContainer.style.zIndex = parsedPos.zIndex;
          absoluteContainer.appendChild(moduleContainer);
        }
      } else {
        // Fallback: zum Grid hinzufügen
        gridContainer.appendChild(moduleContainer);
      }

      try {
        const result = await moduleLoader.createModuleInstance(
          moduleConfig.module,
          moduleConfig.config || {},
          envConfig,
          config.language || 'en',
          `${moduleConfig.module}#${moduleIndex}`
        );

        if (result.element) {
          moduleContainer.appendChild(result.element);
        } else if (result.headless) {
          // Modul ohne Anzeige: kein leerer Container im Raster.
          moduleContainer.remove();
        }

        if (result.ok) {
          mounted.push(moduleConfig.module);
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

document.addEventListener('DOMContentLoaded', () => {
  if (window.electronAPI) {
    window.electronAPI.onConfigLoaded((data) => {
      config = data.config;
      // Perf-Profil aus dem Hauptprozess. Steuert Blur, Dauer-Animationen und
      // die Bildrate der Wetter-Effekte (siehe main.css und weatherEffects.js).
      if (data.perfProfile) {
        document.documentElement.dataset.perf = data.perfProfile;
      }
      renderModules();
    });

    window.electronAPI.onConfigUpdate(async (newConfig) => {
      const previous = config;
      config = newConfig;

      // Wenn sich ausschließlich das Theme geändert hat, reicht der Tausch
      // des Stylesheets. Vorher wurde dafür jedes Modul zerstört und neu
      // erzeugt - inklusive aller Netzwerkabfragen.
      if (previous && onlyThemeChanged(previous, newConfig)) {
        await applyTheme();
        return;
      }

      renderModules();
    });

    // Dimmen laeuft jetzt ueber den Bus. Die eigenen IPC-Kanaele
    // presence-detected/-lost entfallen damit.
    window.mmBus.on('presence:display', (payload) => {
      document.body.style.opacity = payload && payload.on ? '1' : '0.1';
    });
  } else {
    const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
    fetch(`${apiBase}/api/config`)
      .then(res => res.json())
      .then(data => {
        config = data;
        renderModules();
      })
      .catch(err => console.error('Config laden fehlgeschlagen:', err));
  }
});
