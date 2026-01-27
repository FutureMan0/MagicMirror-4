// Magic Mirror Renderer - Dynamische Modul-Verwaltung
let config = null;
let moduleLoader = null;

// Wetter-Effekte initialisieren
if (window.WeatherEffects) {
  window.weatherEffects = new window.WeatherEffects();
  window.weatherEffects.init();
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

function applyTheme() {
  const themeLink = document.getElementById('theme-stylesheet');
  const currentTheme = config.theme || 'default';

  if (currentTheme !== 'default') {
    if (!themeLink) {
      const link = document.createElement('link');
      link.id = 'theme-stylesheet';
      link.rel = 'stylesheet';
      link.href = `../../themes/${currentTheme}.css`;
      document.head.appendChild(link);
    } else {
      themeLink.href = `../../themes/${currentTheme}.css`;
    }
  } else {
    // Wenn Theme "default" ist, entferne das Stylesheet
    if (themeLink) {
      themeLink.remove();
    }
  }
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

    applyTheme();

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

    for (const moduleConfig of config.modules) {
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
        const moduleElement = await moduleLoader.createModuleInstance(
          moduleConfig.module,
          moduleConfig.config || {},
          envConfig,
          config.language || 'en'
        );

        if (moduleElement) {
          moduleContainer.appendChild(moduleElement);
        } else {
          moduleContainer.appendChild(createErrorPlaceholder(moduleConfig.module));
        }
      } catch (error) {
        console.error(`Fehler bei Modul ${moduleConfig.module}:`, error);
        moduleContainer.appendChild(createErrorPlaceholder(moduleConfig.module, error.message));
      }
    }
  } catch (error) {
    console.error('Fehler beim Rendern der Module:', error);
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
      renderModules();
    });

    window.electronAPI.onConfigUpdate((newConfig) => {
      config = newConfig;
      renderModules();
    });

    window.electronAPI.onPresenceDetected(() => {
      document.body.style.opacity = '1';
    });

    window.electronAPI.onPresenceLost(() => {
      document.body.style.opacity = '0.1';
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
