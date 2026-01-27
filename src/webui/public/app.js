// Web Config Interface JavaScript

let currentConfig = null;
let availableModules = [];
let currentInstance = 'display1';
let selectedModule = null;
let moduleListSortable = null;
let previewGridSortable = null;

// Initialisierung
document.addEventListener('DOMContentLoaded', async () => {
  // Theme aus LocalStorage laden
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);

  // Tab-Navigation Setup
  setupTabNavigation();

  // Settings-Button Setup
  setupSettingsButton();

  // Theme-Picker Setup
  setupThemePicker();

  // Lade zuerst Module, dann Config
  await loadModules();
  await loadConfig();
  renderModuleList();
  renderPreview();

  // SortableJS Setup
  setupDragAndDrop();

  // Event Listeners
  document.getElementById('instance-select').addEventListener('change', (e) => {
    currentInstance = e.target.value;
    loadConfig();
  });

  document.getElementById('save-settings-btn').addEventListener('click', () => {
    saveModuleSettings();
  });

  document.getElementById('cancel-settings-btn').addEventListener('click', () => {
    hideSettings();
  });

  // Update-System initialisieren
  initUpdateSystem();
});

// Tab-Navigation
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.bottom-nav button[data-tab]');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  // Vorherigen Tab merken (außer wenn wir zu Settings wechseln)
  const currentTab = document.querySelector('.tab-content.active')?.id.replace('tab-', '');
  if (currentTab && currentTab !== 'settings' && tabName !== 'settings') {
    previousTab = currentTab;
  }

  // Alle Tabs verstecken
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Alle Tab-Buttons deaktivieren
  document.querySelectorAll('.bottom-nav button').forEach(btn => {
    btn.classList.remove('active');
  });

  // Gewählten Tab zeigen
  const targetTab = document.getElementById(`tab-${tabName}`);
  if (targetTab) {
    targetTab.classList.add('active');
  }

  // Gewählten Button aktivieren
  const targetButton = document.querySelector(`.bottom-nav button[data-tab="${tabName}"]`);
  if (targetButton) {
    targetButton.classList.add('active');
  }

  // Settings-Button Icon aktualisieren
  updateSettingsButton(tabName);

  // Preview aktualisieren wenn Preview-Tab geöffnet wird
  if (tabName === 'preview') {
    renderPreview();
  }

  // App Store aktualisieren wenn App Store-Tab geöffnet wird
  if (tabName === 'appstore') {
    renderAppStore();
  }
}

function updateSettingsButton(currentTab) {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    if (currentTab === 'settings') {
      settingsBtn.innerHTML = '←'; // Zurück-Pfeil
      settingsBtn.title = 'Zurück';
    } else {
      settingsBtn.innerHTML = '⚙️'; // Settings-Icon
      settingsBtn.title = 'Einstellungen';
    }
  }
}

// Settings-Button (Toggle zwischen Settings und vorherigem Tab)
let previousTab = 'modules';

function setupSettingsButton() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const currentTab = document.querySelector('.tab-content.active')?.id.replace('tab-', '');

      if (currentTab === 'settings') {
        // Zurück zum vorherigen Tab
        switchTab(previousTab);
      } else {
        // Settings öffnen und aktuellen Tab merken
        previousTab = currentTab || 'modules';
        switchTab('settings');
      }
    });
  }
}

// Theme-System
function setupThemePicker() {
  const themeButtons = document.querySelectorAll('.theme-picker button[data-theme]');

  themeButtons.forEach(button => {
    button.addEventListener('click', () => {
      const theme = button.getAttribute('data-theme');
      setTheme(theme);
    });
  });
}

function setTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  // Aktiven Button markieren
  document.querySelectorAll('.theme-picker button').forEach(btn => {
    btn.classList.remove('active');
  });

  const activeButton = document.querySelector(`.theme-picker button[data-theme="${theme}"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }
}

async function loadConfig() {
  try {
    const response = await fetch(`/api/config?instance=${currentInstance}`);
    currentConfig = await response.json();
    console.log('Config geladen:', currentConfig); // Debug
    renderModuleList(); // Aktualisiere auch die Modul-Liste
    renderPreview();
  } catch (error) {
    console.error('Fehler beim Laden der Konfiguration:', error);
  }
}

async function loadModules() {
  try {
    const response = await fetch('/api/modules');
    availableModules = await response.json();
    console.log('Module geladen:', availableModules); // Debug
  } catch (error) {
    console.error('Fehler beim Laden der Module:', error);
  }
}

function setupDragAndDrop() {
  const moduleList = document.getElementById('module-list');
  const previewGridDesktop = document.getElementById('preview-grid-desktop');
  const previewGridMobile = document.getElementById('preview-grid-mobile');

  if (!moduleList) return;

  // SortableJS für Module-Liste
  if (moduleListSortable) {
    moduleListSortable.destroy();
  }

  moduleListSortable = new Sortable(moduleList, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    group: {
      name: 'modules',
      pull: 'clone',
      put: false
    },
    sort: false,
    onEnd: () => {
      // Module-Liste neu rendern nach Drag
      renderModuleList();
    }
  });

  // SortableJS für Preview-Grid (beide Versionen)
  const setupPreviewGrid = (grid) => {
    if (!grid) return null;

    return new Sortable(grid, {
      animation: 150,
      group: 'modules',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onAdd: (evt) => {
        const moduleIndex = parseInt(evt.item.dataset.index);
        const newPosition = evt.newIndex;

        // Position aus Grid-Index berechnen
        const positions = [
          'top_left', 'top_center', 'top_right',
          'middle_left', 'middle_center', 'middle_right',
          'bottom_left', 'bottom_center', 'bottom_right'
        ];

        if (currentConfig.modules[moduleIndex]) {
          currentConfig.modules[moduleIndex].position = positions[newPosition];
          saveConfig();
        }
      },
      onUpdate: (evt) => {
        // Position innerhalb des Grids geändert
        const moduleIndex = parseInt(evt.item.dataset.index);
        const newPosition = evt.newIndex;

        const positions = [
          'top_left', 'top_center', 'top_right',
          'middle_left', 'middle_center', 'middle_right',
          'bottom_left', 'bottom_center', 'bottom_right'
        ];

        if (currentConfig.modules[moduleIndex]) {
          currentConfig.modules[moduleIndex].position = positions[newPosition];
          saveConfig();
        }
      }
    });
  };

  if (previewGridSortable) {
    previewGridSortable.destroy();
  }

  // Setup beide Preview-Grids
  setupPreviewGrid(previewGridDesktop);
  setupPreviewGrid(previewGridMobile);
}

function renderModuleList() {
  const moduleList = document.getElementById('module-list');
  if (!moduleList) return;

  moduleList.innerHTML = '';

  if (!currentConfig) {
    console.warn('Keine Config geladen');
    return;
  }

  const configModules = currentConfig.modules || [];

  configModules.forEach((moduleConfig, index) => {
    const moduleInfo = availableModules.find(m => m.name === moduleConfig.module);
    const displayName = moduleInfo?.info?.displayName || moduleConfig.module;

    const item = document.createElement('div');
    item.className = `module-item ${selectedModule === index ? 'active' : ''}`;
    item.dataset.index = index;

    // Drag Handle
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '⋮⋮';
    dragHandle.title = 'Ziehen um zu verschieben';

    // Checkbox für Enable/Disable
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = moduleConfig.enabled !== false;
    checkbox.setAttribute('aria-label', displayName);
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    checkbox.addEventListener('change', (e) => {
      toggleModule(index, e.target.checked);
    });

    // Modul-Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'module-item-name';
    nameSpan.textContent = displayName;
    nameSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      selectModule(index);
    });

    // Edit-Button
    const editBtn = document.createElement('button');
    editBtn.className = 'module-edit-btn';
    editBtn.textContent = '⚙️';
    editBtn.title = 'Einstellungen';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectModule(index);
    });

    item.appendChild(dragHandle);
    item.appendChild(checkbox);
    item.appendChild(nameSpan);
    item.appendChild(editBtn);

    item.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        selectModule(index);
      }
    });

    moduleList.appendChild(item);
  });

  // SortableJS neu initialisieren
  setupDragAndDrop();
}

function selectModule(index) {
  selectedModule = index;
  renderModuleList();

  const moduleConfig = currentConfig.modules[index];
  if (!moduleConfig) return;

  const moduleInfo = availableModules.find(m => m.name === moduleConfig.module);

  // Zeige Einstellungen auch ohne moduleInfo
  showModuleSettings(moduleConfig, moduleInfo);

  const settingsSection = document.getElementById('settings-section');
  if (settingsSection) {
    settingsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function showModuleSettings(moduleConfig, moduleInfo) {
  const settingsSection = document.getElementById('settings-section');
  const moduleSettings = document.getElementById('module-settings');

  settingsSection.style.display = 'block';
  document.getElementById('settings-actions').style.display = 'flex';

  const displayName = moduleInfo?.info?.displayName || moduleConfig.module;
  let html = `<h3>${displayName}</h3>`;
  html += '<form class="settings-form" id="module-settings-form">';

  // Position
  html += '<div class="form-group">';
  html += `<label data-i18n="position">${t('position')}</label>`;
  html += '<select name="position" id="module-position">';
  const positions = ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'];
  positions.forEach(pos => {
    const selected = moduleConfig.position === pos ? 'selected' : '';
    html += `<option value="${pos}" ${selected}>${getPositionName(pos)}</option>`;
  });
  html += '</select>';
  html += '</div>';

  // Modul-spezifische Einstellungen
  if (moduleInfo?.info?.config) {
    Object.entries(moduleInfo.info.config).forEach(([key, schema]) => {
      html += '<div class="form-group">';
      html += `<label>${schema.description || key}</label>`;

      if (schema.type === 'boolean') {
        html += `<div class="form-group-checkbox">`;
        html += `<input type="checkbox" name="${key}" ${(moduleConfig.config && moduleConfig.config[key]) !== false ? 'checked' : ''}>`;
        html += `<span>${schema.description || key}</span>`;
        html += `</div>`;
      } else if (schema.type === 'number') {
        html += `<input type="number" name="${key}" value="${moduleConfig.config?.[key] ?? schema.default ?? ''}">`;
      } else {
        html += `<input type="text" name="${key}" value="${moduleConfig.config?.[key] ?? schema.default ?? ''}" placeholder="${schema.default || ''}">`;
      }

      html += '</div>';
    });
  } else {
    // Fallback: JSON-Editor, falls kein Schema vorhanden
    const rawConfig = JSON.stringify(moduleConfig.config || {}, null, 2);
    html += '<div class="form-group">';
    html += '<label>Erweiterte Config (JSON)</label>';
    html += `<textarea name="__raw_config" rows="6" style="width: 100%; font-family: monospace;">${rawConfig}</textarea>`;
    html += '</div>';
  }

  // Untis: Klassen-Liste laden
  if (moduleConfig.module === 'untis') {
    html += '<div class="form-group">';
    html += '<label>Klasse auswählen</label>';
    html += '<div style="display: flex; gap: 8px; align-items: center;">';
    html += '<select id="untis-class-select" style="flex: 1;"></select>';
    html += '<button type="button" class="btn-secondary" id="untis-load-classes">Klassen laden</button>';
    html += '</div>';
    html += '<small style="color: var(--text-secondary);">Wähle z.B. 5BHEL → classId + className werden gesetzt.</small>';
    html += '</div>';
  }

  // Spotify: OAuth Authentifizierung
  if (moduleConfig.module === 'spotify') {
    const hasRefreshToken = moduleConfig.config?.refreshToken;
    html += '<div class="form-group" style="border-top: 1px solid var(--border-color); padding-top: 20px; margin-top: 20px;">';
    html += '<label>Spotify Authentifizierung</label>';
    html += '<div style="display: flex; gap: 8px; align-items: center; flex-direction: column; align-items: stretch;">';

    if (hasRefreshToken) {
      html += '<div style="padding: 10px; background: rgba(0,255,0,0.1); border: 1px solid rgba(0,255,0,0.3); border-radius: 6px; color: #00ff00;">';
      html += '✓ Spotify ist verbunden';
      html += '</div>';
      html += '<button type="button" class="btn-secondary" id="spotify-reauth-btn">Erneut verbinden</button>';
    } else {
      html += '<div style="padding: 10px; background: rgba(255,200,0,0.1); border: 1px solid rgba(255,200,0,0.3); border-radius: 6px; color: #ffcc00;">';
      html += '⚠ Spotify nicht verbunden';
      html += '</div>';
      html += '<button type="button" class="btn-primary" id="spotify-auth-btn">Mit Spotify verbinden</button>';
    }

    html += '</div>';
    html += '<small style="color: var(--text-secondary); margin-top: 8px; display: block;">Der OAuth-Flow öffnet ein neues Fenster. Nach erfolgreicher Anmeldung wird der Refresh Token automatisch gespeichert.</small>';
    html += '</div>';
  }

  html += '</form>';

  moduleSettings.innerHTML = html;

  if (moduleConfig.module === 'untis') {
    initUntisClassPicker(moduleConfig);
  }

  if (moduleConfig.module === 'spotify') {
    initSpotifyAuth(moduleConfig);
  }
}

async function initUntisClassPicker(moduleConfig) {
  const select = document.getElementById('untis-class-select');
  const loadBtn = document.getElementById('untis-load-classes');
  if (!select || !loadBtn) return;

  const classIdInput = document.querySelector('input[name="classId"]');
  const classNameInput = document.querySelector('input[name="className"]');
  select.innerHTML = '<option value="">Klassen laden...</option>';

  loadBtn.addEventListener('click', async () => {
    try {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Lädt...';
      const response = await fetch(`/api/untis/classes?instance=${currentInstance}`);
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Klassen konnten nicht geladen werden.');
        return;
      }

      const classes = data.result || [];
      if (classes.length === 0) {
        select.innerHTML = '<option value="">Keine Klassen gefunden</option>';
        return;
      }

      select.innerHTML = '<option value="">Klasse wählen…</option>' + classes.map(c => {
        const label = c.longName || c.name || `Klasse ${c.id}`;
        return `<option value="${c.id}">${label}</option>`;
      }).join('');
    } catch (error) {
      console.error('Fehler beim Laden der Klassen:', error);
      alert('Klassen konnten nicht geladen werden.');
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Klassen laden';
    }
  });

  select.addEventListener('change', () => {
    if (!classIdInput) return;
    classIdInput.value = select.value;
    if (classNameInput) {
      const selectedOption = select.options[select.selectedIndex];
      classNameInput.value = selectedOption?.textContent || '';
    }
  });

  if (moduleConfig.config?.classId && classIdInput) {
    classIdInput.value = moduleConfig.config.classId;
  }
}

function initSpotifyAuth(moduleConfig) {
  const authBtn = document.getElementById('spotify-auth-btn');
  const reauthBtn = document.getElementById('spotify-reauth-btn');

  const startAuth = async () => {
    try {
      // Hole Auth-URL vom Backend
      const response = await fetch(`/api/spotify/auth-url?instance=${currentInstance}`);
      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Fehler beim Starten der Authentifizierung.');
        return;
      }

      // Öffne Auth-Fenster
      const authWindow = window.open(
        data.authUrl,
        'Spotify Authentifizierung',
        'width=600,height=800,left=100,top=100'
      );

      // Polling für Callback-Result
      const pollInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch(`/api/spotify/auth-status?instance=${currentInstance}`);
          const statusData = await statusResponse.json();

          if (statusData.status === 'completed') {
            clearInterval(pollInterval);
            if (authWindow && !authWindow.closed) {
              authWindow.close();
            }

            // Reload Config und zeige Success
            await loadConfig();
            alert('✓ Spotify erfolgreich verbunden!');
            selectModule(selectedModule); // Refresh Settings-UI
          } else if (statusData.status === 'error') {
            clearInterval(pollInterval);
            if (authWindow && !authWindow.closed) {
              authWindow.close();
            }
            alert('Fehler bei der Authentifizierung: ' + (statusData.error || 'Unbekannter Fehler'));
          }
        } catch (error) {
          console.error('Fehler beim Polling:', error);
        }
      }, 2000);

      // Stop Polling nach 5 Minuten
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 300000);

    } catch (error) {
      console.error('Fehler beim Starten der Authentifizierung:', error);
      alert('Fehler beim Starten der Authentifizierung.');
    }
  };

  if (authBtn) {
    authBtn.addEventListener('click', startAuth);
  }

  if (reauthBtn) {
    reauthBtn.addEventListener('click', startAuth);
  }
}

function hideSettings() {
  document.getElementById('settings-actions').style.display = 'none';
  document.getElementById('module-settings').innerHTML = '<p style="color: var(--text-secondary);">Klicke auf ein Modul links, um es zu konfigurieren.</p>';
  selectedModule = null;
  renderModuleList();
}

async function saveModuleSettings() {
  if (selectedModule === null) return;

  const form = document.getElementById('module-settings-form');
  const formData = new FormData(form);

  const moduleConfig = currentConfig.modules[selectedModule];
  moduleConfig.position = formData.get('position');

  if (!moduleConfig.config) {
    moduleConfig.config = {};
  }

  // Speichere alle Formular-Daten
  for (const [key, value] of formData.entries()) {
    if (key !== 'position') {
      const moduleInfo = availableModules.find(m => m.name === moduleConfig.module);
      const schema = moduleInfo?.info.config?.[key];

      if (schema?.type === 'boolean') {
        moduleConfig.config[key] = value === 'on';
      } else if (schema?.type === 'number') {
        moduleConfig.config[key] = parseFloat(value);
      } else {
        moduleConfig.config[key] = value;
      }
    }
  }

  // Fallback: JSON-Editor (wenn vorhanden)
  const rawConfigValue = formData.get('__raw_config');
  if (rawConfigValue) {
    try {
      const rawConfig = JSON.parse(rawConfigValue);
      moduleConfig.config = { ...moduleConfig.config, ...rawConfig };
    } catch (error) {
      alert('Ungültiges JSON in der erweiterten Config.');
      return;
    }
  }

  try {
    const response = await fetch(`/api/config?instance=${currentInstance}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    });

    if (response.ok) {
      await loadConfig();
      renderPreview();
      hideSettings();
    }
  } catch (error) {
    console.error('Fehler beim Speichern:', error);
  }
}

function toggleModule(index, enabled) {
  if (!currentConfig.modules[index]) return;
  currentConfig.modules[index].enabled = enabled;

  fetch(`/api/config?instance=${currentInstance}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentConfig)
  }).then(() => {
    loadConfig();
  });
}

function renderPreview() {
  const previewGridDesktop = document.getElementById('preview-grid-desktop');
  const previewGridMobile = document.getElementById('preview-grid-mobile');

  // Rendere beide Preview-Grids
  [previewGridDesktop, previewGridMobile].forEach(previewGrid => {
    if (!previewGrid) return;

    previewGrid.innerHTML = '';

    // Erstelle 9 Grid-Zellen
    const positions = [
      'top_left', 'top_center', 'top_right',
      'middle_left', 'middle_center', 'middle_right',
      'bottom_left', 'bottom_center', 'bottom_right'
    ];

    positions.forEach((pos, index) => {
      const cell = document.createElement('div');
      cell.className = 'preview-module';
      cell.style.gridColumn = (index % 3) + 1;
      cell.style.gridRow = Math.floor(index / 3) + 1;
      cell.dataset.position = pos;

      // Zeige nur aktivierte Module
      const module = currentConfig?.modules?.find(m =>
        m.position === pos && m.enabled !== false
      );

      if (module) {
        const moduleIndex = currentConfig.modules.indexOf(module);
        const moduleInfo = availableModules.find(m => m.name === module.module);
        cell.textContent = moduleInfo?.info?.displayName || module.module;
        cell.style.border = '1px solid var(--accent-cyan)';
        cell.classList.add('has-module');
        cell.dataset.index = moduleIndex;

        // Klick um Modul zu konfigurieren
        cell.addEventListener('click', () => {
          selectModule(moduleIndex);
          switchTab('modules'); // Wechsle zu Module-Tab um Einstellungen zu zeigen
        });
      } else {
        cell.textContent = getPositionName(pos);
        cell.style.opacity = '0.3';
      }

      previewGrid.appendChild(cell);
    });
  });

  // SortableJS für Preview aktualisieren
  setupDragAndDrop();
}

async function saveConfig() {
  try {
    const response = await fetch(`/api/config?instance=${currentInstance}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    });

    if (response.ok) {
      await loadConfig();
      renderPreview();
    }
  } catch (error) {
    console.error('Fehler beim Speichern:', error);
  }
}

// ==================== APP STORE ====================

function renderAppStore() {
  const appstoreGrid = document.getElementById('appstore-grid');
  if (!appstoreGrid) return;

  appstoreGrid.innerHTML = '';

  if (!currentConfig || !availableModules) {
    appstoreGrid.innerHTML = '<p>Lade Module...</p>';
    return;
  }

  const installedModules = currentConfig.modules || [];

  availableModules.forEach(module => {
    const isInstalled = installedModules.some(m => m.module === module.name);
    const moduleIndex = installedModules.findIndex(m => m.module === module.name);
    const moduleInfo = module.info || {};

    const card = document.createElement('div');
    card.className = `appstore-card ${isInstalled ? 'installed' : ''}`;

    // Icon Mapping
    const moduleIcons = {
      'clock': '🕐',
      'weather': '🌤️',
      'untis': '📅',
      'spotify': '🎵',
      'presence': '👤',
      'calendar': '📆',
      'news': '📰'
    };

    const icon = moduleIcons[module.name] || '📦';

    card.innerHTML = `
      <div class="appstore-card-header">
        <h3 class="appstore-card-title">${moduleInfo.displayName || module.name}</h3>
        ${isInstalled ? '<span class="appstore-card-badge">Installiert</span>' : ''}
      </div>
      
      <div class="appstore-card-description">
        ${moduleInfo.description || 'Keine Beschreibung verfügbar.'}
      </div>
      
      <div class="appstore-card-preview">
        <div class="appstore-card-preview-icon">${icon}</div>
      </div>
      
      <div class="appstore-card-actions">
        ${isInstalled ? `
          <button class="appstore-btn appstore-btn-remove" data-module="${module.name}">
            ❌ Entfernen
          </button>
          <button class="appstore-btn appstore-btn-configure" data-module-index="${moduleIndex}">
            ⚙️
          </button>
        ` : `
          <button class="appstore-btn appstore-btn-add" data-module="${module.name}">
            ➕ Hinzufügen
          </button>
        `}
      </div>
    `;

    appstoreGrid.appendChild(card);
  });

  // Event Listeners für Buttons
  appstoreGrid.querySelectorAll('.appstore-btn-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleName = btn.dataset.module;
      addModule(moduleName);
    });
  });

  appstoreGrid.querySelectorAll('.appstore-btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleName = btn.dataset.module;
      removeModule(moduleName);
    });
  });

  appstoreGrid.querySelectorAll('.appstore-btn-configure').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleIndex = parseInt(btn.dataset.moduleIndex);
      selectModule(moduleIndex);
      switchTab('modules');
    });
  });
}

async function addModule(moduleName) {
  if (!currentConfig) return;

  // Prüfe ob Modul bereits existiert
  const exists = currentConfig.modules.some(m => m.module === moduleName);
  if (exists) {
    alert('Dieses Modul ist bereits installiert.');
    return;
  }

  // Finde freie Position
  const positions = [
    'top_left', 'top_center', 'top_right',
    'middle_left', 'middle_center', 'middle_right',
    'bottom_left', 'bottom_center', 'bottom_right'
  ];

  let freePosition = 'middle_center';
  for (const pos of positions) {
    const occupied = currentConfig.modules.some(m => m.position === pos && m.enabled !== false);
    if (!occupied) {
      freePosition = pos;
      break;
    }
  }

  // Hole Standard-Config vom Backend
  const moduleInfo = availableModules.find(m => m.name === moduleName);
  const defaultConfig = {};

  if (moduleInfo?.info?.config) {
    Object.entries(moduleInfo.info.config).forEach(([key, schema]) => {
      if (schema.default !== undefined) {
        defaultConfig[key] = schema.default;
      }
    });
  }

  // Füge Modul hinzu
  const newModule = {
    module: moduleName,
    position: freePosition,
    enabled: true,
    config: defaultConfig
  };

  currentConfig.modules.push(newModule);

  // Speichere Config
  try {
    const response = await fetch(`/api/config?instance=${currentInstance}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    });

    if (response.ok) {
      await loadConfig();
      renderAppStore();
      renderModuleList();
      renderPreview();

      // Zeige Success-Nachricht
      const displayName = moduleInfo?.info?.displayName || moduleName;
      showNotification(`✓ ${displayName} wurde hinzugefügt!`, 'success');
    }
  } catch (error) {
    console.error('Fehler beim Hinzufügen des Moduls:', error);
    alert('Fehler beim Hinzufügen des Moduls.');
  }
}

async function removeModule(moduleName) {
  if (!currentConfig) return;

  const moduleInfo = availableModules.find(m => m.name === moduleName);
  const displayName = moduleInfo?.info?.displayName || moduleName;

  if (!confirm(`Möchtest du ${displayName} wirklich entfernen?`)) {
    return;
  }

  // Entferne Modul aus Config
  currentConfig.modules = currentConfig.modules.filter(m => m.module !== moduleName);

  // Speichere Config
  try {
    const response = await fetch(`/api/config?instance=${currentInstance}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    });

    if (response.ok) {
      await loadConfig();
      renderAppStore();
      renderModuleList();
      renderPreview();

      showNotification(`✓ ${displayName} wurde entfernt.`, 'success');
    }
  } catch (error) {
    console.error('Fehler beim Entfernen des Moduls:', error);
    alert('Fehler beim Entfernen des Moduls.');
  }
}

function showNotification(message, type = 'info') {
  // Einfache Toast-Notification
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#00ff66' : '#00D4FF'};
    color: #000;
    padding: 15px 25px;
    border-radius: 8px;
    font-weight: 600;
    z-index: 10001;
    animation: slideInRight 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ==================== UPDATE SYSTEM ====================

function initUpdateSystem() {
  const checkBtn = document.getElementById('check-update-btn');
  const executeBtn = document.getElementById('execute-update-btn');

  if (checkBtn) {
    checkBtn.addEventListener('click', checkUpdate);
  }

  if (executeBtn) {
    executeBtn.addEventListener('click', executeUpdate);
  }

  // Automatische Prüfung beim Start
  checkUpdate();
}

async function checkUpdate() {
  const message = document.getElementById('update-message');
  const actionDiv = document.getElementById('update-action');
  if (!message) return;

  message.textContent = 'Prüfe...';
  message.style.color = 'var(--text-secondary)';

  try {
    const response = await fetch('/api/update/check');
    const data = await response.json();

    if (data.updateAvailable) {
      message.textContent = 'Update verfügbar!';
      message.style.color = 'var(--accent-cyan)';
      if (actionDiv) actionDiv.style.display = 'block';
      showNotification('System-Update verfügbar!');
    } else {
      message.textContent = 'System ist auf dem neuesten Stand.';
      message.style.color = 'var(--text-secondary)';
      if (actionDiv) actionDiv.style.display = 'none';
    }
  } catch (error) {
    console.error('Update-Check fehlgeschlagen:', error);
    message.textContent = 'Prüfung fehlgeschlagen.';
  }
}

async function executeUpdate() {
  const btn = document.getElementById('execute-update-btn');
  if (!btn) return;

  if (!confirm('Das System wird aktualisiert und anschließend neu gestartet. Fortfahren?')) {
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Installiere...';

  try {
    const response = await fetch('/api/update/execute', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      showNotification('Update erfolgreich! Neustart...');
      setTimeout(() => {
        location.reload();
      }, 5000);
    } else {
      alert('Update fehlgeschlagen: ' + (data.error || 'Unbekannter Fehler'));
      btn.disabled = false;
      btn.textContent = 'Update jetzt installieren';
    }
  } catch (error) {
    console.error('Update-Execution fehlgeschlagen:', error);
    alert('Verbindung zum Server verloren während des Updates.');
  }
}

// Füge CSS-Animation für Notifications hinzu
if (!document.getElementById('notification-styles')) {
  const style = document.createElement('style');
  style.id = 'notification-styles';
  style.textContent = `
    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOutRight {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
