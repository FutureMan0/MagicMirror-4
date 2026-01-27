// Magic Mirror Renderer - Dynamische Modul-Verwaltung
let config = null;
let moduleLoader = null;

const gridPositions = {
  'top_left': { gridColumn: '1', gridRow: '1', justifySelf: 'start', alignSelf: 'start' },
  'top_center': { gridColumn: '2', gridRow: '1', justifySelf: 'center', alignSelf: 'start' },
  'top_right': { gridColumn: '3', gridRow: '1', justifySelf: 'end', alignSelf: 'start' },
  'middle_left': { gridColumn: '1', gridRow: '2', justifySelf: 'start', alignSelf: 'center' },
  'middle_center': { gridColumn: '2', gridRow: '2', justifySelf: 'center', alignSelf: 'center' },
  'middle_right': { gridColumn: '3', gridRow: '2', justifySelf: 'end', alignSelf: 'center' },
  'bottom_left': { gridColumn: '1', gridRow: '3', justifySelf: 'start', alignSelf: 'end' },
  'bottom_center': { gridColumn: '2', gridRow: '3', justifySelf: 'center', alignSelf: 'end' },
  'bottom_right': { gridColumn: '3', gridRow: '3', justifySelf: 'end', alignSelf: 'end' }
};

async function renderModules() {
  const container = document.getElementById('modules-container');
  if (!container || !config || !config.modules) return;

  if (!moduleLoader) {
    moduleLoader = new window.RendererModuleLoader();
  }

  container.innerHTML = '';

  // Container für Grid-Module
  const gridContainer = document.createElement('div');
  gridContainer.className = 'modules-grid';
  container.appendChild(gridContainer);

  // Container für Absolut positionierte Module
  const absoluteContainer = document.createElement('div');
  absoluteContainer.className = 'modules-absolute';
  container.appendChild(absoluteContainer);

  const envConfig = config.env || {};

  for (const moduleConfig of config.modules) {
    if (moduleConfig.enabled === false) continue;

    const moduleContainer = document.createElement('div');
    moduleContainer.className = 'module-container';
    moduleContainer.dataset.moduleName = moduleConfig.module;

    // Position anwenden
    if (typeof moduleConfig.position === 'string') {
      const pos = gridPositions[moduleConfig.position];
      if (pos) {
        moduleContainer.style.gridColumn = pos.gridColumn;
        moduleContainer.style.gridRow = pos.gridRow;
        moduleContainer.style.justifySelf = pos.justifySelf;
        moduleContainer.style.alignSelf = pos.alignSelf;
      }
      gridContainer.appendChild(moduleContainer);
    } else if (typeof moduleConfig.position === 'object') {
      moduleContainer.style.position = 'absolute';
      if (moduleConfig.position.x) moduleContainer.style.left = moduleConfig.position.x;
      if (moduleConfig.position.y) moduleContainer.style.top = moduleConfig.position.y;
      if (moduleConfig.position.width) moduleContainer.style.width = moduleConfig.position.width;
      if (moduleConfig.position.height) moduleContainer.style.height = moduleConfig.position.height;
      if (moduleConfig.position.zIndex) moduleContainer.style.zIndex = moduleConfig.position.zIndex;
      absoluteContainer.appendChild(moduleContainer);
    }

    try {
      const moduleElement = await moduleLoader.createModuleInstance(
        moduleConfig.module,
        moduleConfig.config || {},
        envConfig
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
}

function createErrorPlaceholder(moduleName, errorMessage = 'Modul konnte nicht geladen werden') {
  const placeholder = document.createElement('div');
  placeholder.className = 'module-placeholder';
  placeholder.innerHTML = `
    <div class="module-error">
      <div class="module-error-title">${moduleName}</div>
      <div class="module-error-message">${errorMessage}</div>
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
