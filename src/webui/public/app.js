/**
 * Der Anzeigename eines Moduls in der eingestellten Sprache.
 *
 * `displayName` im Manifest darf ein einfacher Text sein oder { de, en }.
 * Vorher stand in einer englischen Oberflaeche „Uhr & Datum".
 */
function modulName(displayName, fallback) {
  if (!displayName) return fallback;
  if (typeof displayName === 'string') return displayName;

  const sprache = typeof getCurrentLanguage === 'function' ? getCurrentLanguage() : 'de';
  return displayName[sprache] || displayName.de || displayName.en || fallback;
}

// Muss zu SECRET_PLACEHOLDER in src/main/configManager.js passen.
const SECRET_PLACEHOLDER = '__SET__';

// Escaping fuer Werte aus fremden APIs, die in Markup eingesetzt werden.
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

// Web Config Interface JavaScript

let currentConfig = null;
let availableModules = [];
let currentInstance = 'display1';
// Auch am window: der Zonen-Editor liegt in einer eigenen Datei.
window.currentInstance = currentInstance;
let selectedModule = null;
let moduleListSortable = null;
let previewGridSortable = null;

// Visual Editor Instance
let visualEditor = null;

// Initialisierung
document.addEventListener('DOMContentLoaded', async () => {
  // Theme aus LocalStorage laden
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);

  // Tab-Navigation Setup
  setupTabNavigation();
  setupModeButtons();

  // Settings-Button Setup
  setupSettingsButton();

  // Theme-Picker Setup (WebUI)
  setupThemePicker();

  // Lade zuerst Module, dann Config
  await loadModules();
  await loadConfig();

  // Erst danach die Theme-Auswahl aufbauen: sie markiert das aktive Theme
  // und braucht dafür die geladene Konfiguration.
  await setupMirrorThemePicker();
  setupLiveView();
  renderModuleList();

  // Warte kurz, bis initGridSettings gelaufen ist
  setTimeout(() => {
    const mode = localStorage.getItem('layoutMode') || 'visual';
    console.log('Initial layout mode:', mode);
    if (mode === 'classic') {
      renderPreview();
    } else {
      // Initialisiere Visual Editor für den visuellen Modus
      initVisualEditor();
    }
  }, 300);

  // SortableJS Setup
  setupDragAndDrop();

  // Event Listeners
  document.getElementById('instance-select').addEventListener('change', (e) => {
    currentInstance = e.target.value;
    window.currentInstance = currentInstance;
    loadConfig();
  });

  // Sprache-Synchronisation
  window.addEventListener('languageChanged', (e) => {
    if (currentConfig && currentConfig.language !== e.detail.language) {
      currentConfig.language = e.detail.language;
      saveConfig();
    }
  });

  document.getElementById('save-settings-btn').addEventListener('click', () => {
    saveModuleSettings();
  });

  document.getElementById('cancel-settings-btn').addEventListener('click', () => {
    hideSettings();
  });

  // Update-System initialisieren
  initUpdateSystem();

  // Grid-Einstellungen initialisieren
  initGridSettings();

  // Visual Editor nur initialisieren wenn visueller Modus aktiv ist
  // wird durch initGridSettings gesteuert
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

  // Layout Editor aktualisieren/initialisieren wenn Layout-Tab geöffnet wird
  if (tabName === 'layout') {
    const mode = window.getLayoutMode ? window.getLayoutMode() : 'visual';

    if (mode === 'visual') {
      // Initialisiere Editoren falls noch nicht geschehen
      if (!visualEditorDesktop && !visualEditorMobile) {
        console.log('Initializing visual editor from tab switch');
        setTimeout(() => initVisualEditor(), 100);
      } else {
        // Aktualisiere vorhandene Editoren
        if (visualEditorDesktop) {
          visualEditorDesktop.updateConfig(currentConfig);
        }
        if (visualEditorMobile) {
          visualEditorMobile.updateConfig(currentConfig);
        }
      }
    } else {
      renderPreview();
    }
  }

  // App Store aktualisieren wenn App Store-Tab geöffnet wird
  if (tabName === 'appstore') {
    renderAppStore();
  }
}



// Mode Buttons (Classic vs Visual)
function setupModeButtons() {
  const visualBtn = document.getElementById('mode-btn-visual');
  const classicBtn = document.getElementById('mode-btn-classic');

  if (visualBtn) {
    visualBtn.addEventListener('click', () => {
      if (window.setLayoutMode) window.setLayoutMode('visual');
      updateModeButtons('visual');
    });
  }

  if (classicBtn) {
    classicBtn.addEventListener('click', () => {
      if (window.setLayoutMode) window.setLayoutMode('classic');
      updateModeButtons('classic');
    });
  }

  // Initialer Status
  const currentMode = localStorage.getItem('layoutMode') || 'visual';
  updateModeButtons(currentMode);
}

function updateModeButtons(mode) {
  const visualBtn = document.getElementById('mode-btn-visual');
  const classicBtn = document.getElementById('mode-btn-classic');
  const viewTitle = document.getElementById('view-title');

  if (visualBtn) visualBtn.classList.toggle('active', mode === 'visual');
  if (classicBtn) classicBtn.classList.toggle('active', mode === 'classic');

  if (viewTitle) {
    viewTitle.textContent = mode === 'visual' ? 'Layout Editor' : 'Live Preview';
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
    window.currentConfig = currentConfig;
    // Die Modulkarten haengen an der Konfiguration.
    window.ModulBrowser?.zeichneKarten();
    console.log('Config geladen:', currentConfig); // Debug

    // UI-Sprache an Config anpassen
    if (currentConfig.language && typeof setLanguage === 'function' && currentConfig.language !== currentLanguage) {
      setLanguage(currentConfig.language);
    }

    renderModuleList(); // Aktualisiere auch die Modul-Liste
    renderPreview();
    updateMirrorThemeUI(); // Update UI for Mirror Theme

    // Visual Editor aktualisieren falls vorhanden
    if (visualEditor) {
      visualEditor.updateConfig(currentConfig);
    }
  } catch (error) {
    console.error('Fehler beim Laden der Konfiguration:', error);
  }
}

/**
 * Live-Ansicht des Spiegels.
 *
 * Zeigt denselben Renderer, der auch auf dem Spiegel laeuft - ueber HTTP in
 * einem iframe. Der Layout-Editor zeigt sonst nur Kaestchen mit Modulnamen;
 * ob eine Uhr wirklich passt oder ein Theme zu dunkel ist, sieht man daran
 * nicht.
 *
 * Der Rahmen laedt in voller Aufloesung und wird als Ganzes skaliert. Ein
 * einfach verkleinerter iframe wuerde stattdessen ein Handy-Layout rendern -
 * also gerade nicht das, was am Spiegel zu sehen ist.
 */
function setupLiveView() {
  const section = document.getElementById('live-view');
  const toggle = document.getElementById('toggle-live-view');
  const frame = document.getElementById('live-view-iframe');
  const reload = document.getElementById('live-view-reload');
  const hint = document.getElementById('live-view-hint');
  if (!section || !toggle || !frame) return;

  const MIRROR_WIDTH = 1920;
  let visible = localStorage.getItem('liveViewVisible') === '1';

  function url() {
    return `/mirror/index.html?instance=${encodeURIComponent(currentInstance)}&preview=1`;
  }

  function rescale() {
    const wrapper = frame.parentElement;
    if (!wrapper) return;
    const scale = wrapper.clientWidth / MIRROR_WIDTH;
    wrapper.style.setProperty('--live-view-scale', String(scale));
  }

  function apply() {
    section.hidden = !visible;
    toggle.classList.toggle('active', visible);
    localStorage.setItem('liveViewVisible', visible ? '1' : '0');

    if (visible) {
      // Erst beim Einblenden laden: sonst laeuft im Hintergrund dauerhaft ein
      // zweiter Spiegel samt aller Netzabfragen mit.
      if (frame.getAttribute('src') !== url()) frame.setAttribute('src', url());
      rescale();
      if (hint) hint.textContent = t('livePreviewHint');
    } else {
      frame.removeAttribute('src');
    }
  }

  toggle.addEventListener('click', () => {
    visible = !visible;
    apply();
  });

  reload?.addEventListener('click', () => {
    frame.setAttribute('src', url());
  });

  window.addEventListener('resize', rescale);

  // Beim Wechsel der Instanz die andere Anzeige zeigen.
  document.getElementById('instance-select')?.addEventListener('change', () => {
    if (visible) frame.setAttribute('src', url());
  });

  apply();
}

/**
 * Laedt Module und Konfiguration neu, ohne die Seite zu verwerfen.
 *
 * Ein location.reload() wuerde die Wisch-Geste zwar auch bedienen, aber die
 * Verbindung neu aufbauen und die Ansicht zuruecksetzen - fuer ein
 * "aktualisieren" ist das zu viel.
 */
window.reloadEverything = async function reloadEverything() {
  await loadModules();
  await loadConfig();
  renderModuleList();
  updateMirrorThemeUI();
  if (window.refreshActiveLayoutView) {
    window.refreshActiveLayoutView();
  } else {
    renderPreview();
  }
};

// Eine Aenderung von einem anderen Geraet - oder vom Spiegel selbst -
// erreicht diese Oberflaeche jetzt sofort, statt bis zum naechsten Neuladen
// unsichtbar zu bleiben.
document.addEventListener('mm:config', (event) => {
  const payload = event.detail || {};
  if (payload.instance && payload.instance !== currentInstance) return;

  // Waehrend eine Bearbeitung offen ist, nicht dazwischenfunken - sonst
  // verschwinden Eingaben unter den Fingern.
  const settingsOpen = document.getElementById('settings-actions')?.style.display !== 'none';
  if (settingsOpen) {
    showNotification('Die Konfiguration wurde anderswo geändert. Nach dem Speichern neu laden.');
    return;
  }

  if (!payload.config) return;

  currentConfig = payload.config;
  renderModuleList();
  updateMirrorThemeUI();
  if (window.refreshActiveLayoutView) {
    window.refreshActiveLayoutView();
  } else {
    renderPreview();
  }
});

// Mirror Theme System
//
// Die Auswahl stand frueher fest im HTML. Ein neues Theme war damit
// unsichtbar, bis jemand die Datei anfasste. Jetzt kommt die Liste aus
// GET /api/themes, das themes/ scannt.
let availableThemes = [];

async function setupMirrorThemePicker() {
  const picker = document.getElementById('mirror-theme-picker');
  if (!picker) return;

  try {
    const response = await fetch('/api/themes');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    availableThemes = await response.json();
  } catch (error) {
    console.error('Themes konnten nicht geladen werden:', error);
    picker.textContent = t('themesFailed');
    return;
  }

  picker.innerHTML = '';
  picker.classList.add('theme-cards');

  for (const theme of availableThemes) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-card';
    card.dataset.mirrorTheme = theme.id;

    const swatch = document.createElement('span');
    swatch.className = 'theme-card-swatch';
    swatch.dataset.mode = theme.mode;

    const name = document.createElement('span');
    name.className = 'theme-card-name';
    name.textContent = theme.name;

    const description = document.createElement('span');
    description.className = 'theme-card-description';
    description.textContent = theme.description || '';

    card.append(swatch, name, description);

    if (theme.mode === 'light') {
      const badge = document.createElement('span');
      badge.className = 'theme-card-badge';
      badge.textContent = 'hell';
      card.appendChild(badge);
    }

    card.addEventListener('click', () => setMirrorTheme(theme.id));
    picker.appendChild(card);
  }

  updateMirrorThemeUI();
}

function updateMirrorThemeUI() {
  if (!currentConfig) return;
  const currentTheme = currentConfig.theme || 'default';

  const buttons = document.querySelectorAll('#mirror-theme-picker button');
  buttons.forEach(btn => btn.classList.remove('active'));

  const activeBtn = document.querySelector(
    `#mirror-theme-picker button[data-mirror-theme="${CSS.escape(currentTheme)}"]`
  );
  if (activeBtn) activeBtn.classList.add('active');
}

async function setMirrorTheme(theme) {
  if (!currentConfig) return;

  currentConfig.theme = theme;

  // Update UI immediately for feedback
  updateMirrorThemeUI();

  // Save to config
  saveConfig();
}

async function loadModules() {
  try {
    const response = await fetch('/api/modules');
    availableModules = await response.json();
    // Auch am window: der Zonen-Editor liegt in einer eigenen Datei und
    // soll den Namen nicht ein zweites Mal deklarieren.
    window.availableModules = availableModules;
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
    const displayName = modulName(moduleInfo?.info?.displayName, moduleConfig.module);

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
  // Auch am window: der Modul-Browser liegt in einer eigenen Datei.
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

  const displayName = modulName(moduleInfo?.info?.displayName, moduleConfig.module);
  let html = `<h3>${displayName}</h3>`;
  html += '<form class="settings-form" id="module-settings-form">';

  // Position: eine Zone, sonst nichts.
  //
  // Hier standen frueher drei Auswahlfelder - "Legacy (top_left, etc.)",
  // "Grid (Spalten/Zeilen)", "Absolut (Pixel/Prozent)" - samt Spalten-Span
  // und Z-Index. Das war Entwicklersprache in einem Einstellungsdialog, und
  // schlimmer: ein Modul mit Zone galt dort als "Legacy", die Auswahl kannte
  // seine Zone nicht, und Speichern haette sie mit middle_center ueberschrieben.
  const zonen = window.MMZonen;
  const aktuelleZone = zonen ? zonen.alsZone(moduleConfig.position) : null;
  const eigenePosition = !aktuelleZone && moduleConfig.position;

  html += '<div class="form-group">';
  html += `<label data-i18n="position">${t('position')}</label>`;

  if (eigenePosition) {
    // Wer Spalte/Zeile von Hand gesetzt hat, soll das nicht durch einen
    // unbedachten Klick verlieren.
    html += `<p class="form-hint">${t('positionCustom')}</p>`;
    html += '<input type="hidden" name="positionZone" value="">';
  } else {
    html += '<select name="positionZone" id="module-position-zone">';
    for (const z of (zonen ? zonen.ZONEN : [])) {
      const gewaehlt = aktuelleZone === z.id ? 'selected' : '';
      html += `<option value="${z.id}" ${gewaehlt}>${zonen.zonenLabel(z.id, getCurrentLanguage())}</option>`;
    }
    html += '</select>';
    html += `<p class="form-hint">${t('positionHint')}</p>`;
  }
  html += '</div>';


  // Modul-spezifische Einstellungen
  const secretFields = moduleInfo?.secretFields || [];
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
      } else if (secretFields.includes(key)) {
        // Geheimnisse verlassen den Pi nicht. Der Server liefert stattdessen
        // den Platzhalter SECRET_PLACEHOLDER. Ein leer gelassenes Feld
        // bedeutet "unverändert".
        const isSet = moduleConfig.config?.[key] === SECRET_PLACEHOLDER;
        html += `<input type="password" name="${key}" value="" autocomplete="new-password"`;
        html += ` placeholder="${isSet ? '•••••••• (gespeichert)' : 'nicht gesetzt'}"`;
        html += ` data-secret="true" data-was-set="${isSet}">`;
        html += `<small style="color: var(--text-secondary); display: block; margin-top: 4px;">`;
        html += isSet
          ? 'Gespeichert. Leer lassen, um den Wert unverändert zu übernehmen.'
          : 'Noch nicht gesetzt.';
        html += `</small>`;
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

  // Spotify: Einrichtung
  if (moduleConfig.module === 'spotify') {
    html += '<div class="form-group spotify-setup">';
    html += '<label>Spotify-Verbindung</label>';
    html += '<div id="spotify-setup-body">Wird geprüft …</div>';
    html += '</div>';
  }

  html += '</form>';

  moduleSettings.innerHTML = html;

  if (moduleConfig.module === 'untis') {
    initUntisClassPicker(moduleConfig);
  }

  if (moduleConfig.module === 'spotify') {
    initSpotifySetup();
  }

  // Position Type Switcher
  const posTypeSelect = document.getElementById('position-type-select');
  if (posTypeSelect) {
    posTypeSelect.addEventListener('change', (e) => {
      const posType = e.target.value;
      document.querySelectorAll('.position-config').forEach(el => el.style.display = 'none');
      const targetDiv = document.getElementById(`position-${posType}`);
      if (targetDiv) targetDiv.style.display = 'block';
    });
  }
}

async function initUntisClassPicker(moduleConfig) {
  const select = document.getElementById('untis-class-select');
  const loadBtn = document.getElementById('untis-load-classes');
  if (!select || !loadBtn) return;

  const classIdInput = document.querySelector('input[name="classId"]');
  const classNameInput = document.querySelector('input[name="className"]');
  select.innerHTML = `<option value="">${t('classesLoading')}</option>`;

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
        select.innerHTML = `<option value="">${t('classesNone')}</option>`;
        return;
      }

      select.innerHTML = `<option value="">${t('classPick')}</option>` + classes.map(c => {
        const label = c.longName || c.name || `Klasse ${c.id}`;
        // Name und Id stammen aus der WebUntis-Antwort.
        return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
      }).join('');
    } catch (error) {
      console.error('Fehler beim Laden der Klassen:', error);
      alert('Klassen konnten nicht geladen werden.');
    } finally {
      loadBtn.disabled = false;
      loadBtn.textContent = t('classesLoad');
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

/**
 * Einrichtungs-Assistent für Spotify.
 *
 * Der Wunsch war "ohne viel Tamtam". Was dem im Weg stand:
 *
 *  1. Man muss sich selbst eine Spotify-App anlegen. Das lässt sich nicht
 *     umgehen - im Development Mode braucht der App-Besitzer Premium und darf
 *     nur fünf Testnutzer haben, eine mitgelieferte Client-ID wäre also nach
 *     fünf Leuten am Ende.
 *  2. Man musste Client ID UND Secret abtippen. Das Secret entfällt jetzt
 *     dank PKCE.
 *  3. Die Rückleitungsadresse musste man von Hand eintragen und exakt
 *     treffen. Sie steht jetzt hier zum Kopieren.
 *
 * Übrig bleiben: App anlegen, zwei Werte kopieren, eine ID einfügen,
 * verbinden.
 */
async function initSpotifySetup() {
  const body = document.getElementById('spotify-setup-body');
  if (!body) return;

  let status;
  try {
    const response = await fetch(`/api/spotify/auth-status?instance=${currentInstance}`);
    status = await response.json();
  } catch (error) {
    body.textContent = t('statusFailed');
    return;
  }

  body.textContent = '';

  if (status.connected) {
    body.appendChild(buildSpotifyConnected());
    return;
  }

  body.appendChild(buildSpotifySteps(status));
}

function buildSpotifyConnected() {
  const box = document.createElement('div');
  box.className = 'spotify-connected';

  const line = document.createElement('div');
  line.className = 'spotify-status-ok';
  line.textContent = '✓ Verbunden';
  box.appendChild(line);

  const disconnect = document.createElement('button');
  disconnect.type = 'button';
  disconnect.className = 'btn-secondary';
  disconnect.textContent = t('disconnect');
  disconnect.addEventListener('click', async () => {
    await fetch('/api/spotify/disconnect', { method: 'POST' });
    initSpotifySetup();
  });
  box.appendChild(disconnect);

  return box;
}

function buildSpotifySteps(status) {
  const wrapper = document.createElement('div');
  wrapper.className = 'spotify-steps';

  const hint = document.createElement('p');
  hint.className = 'spotify-hint';
  // Ohne diesen Hinweis läuft man in ein 403, dessen Ursache nirgends steht.
  hint.textContent = t('spotifyPremium') + '.';
  wrapper.appendChild(hint);

  wrapper.appendChild(buildSpotifyStep(1,
    'Spotify-App anlegen',
    'Im Dashboard auf „Create app". Name und Beschreibung sind frei wählbar.',
    (content) => {
      const link = document.createElement('a');
      link.href = 'https://developer.spotify.com/dashboard';
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'btn-secondary spotify-link';
      link.textContent = t('openDashboard');
      content.appendChild(link);
    }
  ));

  wrapper.appendChild(buildSpotifyStep(2,
    'Diese Adresse als Redirect URI eintragen',
    'Sie muss exakt übereinstimmen — deshalb kopieren statt abtippen.',
    (content) => content.appendChild(buildCopyField(status.redirectUri))
  ));

  wrapper.appendChild(buildSpotifyStep(3,
    'Client ID einfügen',
    'Aus der Übersicht der eben angelegten App. Ein Client Secret wird nicht gebraucht.',
    (content) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'spotify-client-id';
      input.placeholder = 'z. B. 4c2a9f18…';
      input.autocomplete = 'off';
      input.spellcheck = false;
      content.appendChild(input);

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn-secondary';
      save.textContent = 'Speichern';
      save.addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) return;

        const moduleConfig = currentConfig.modules.find(m => m.module === 'spotify');
        if (!moduleConfig) return;

        moduleConfig.config = { ...(moduleConfig.config || {}), clientId: value };
        await saveConfig();
        initSpotifySetup();
      });
      content.appendChild(save);
    }
  ));

  const connectStep = buildSpotifyStep(4,
    'Verbinden',
    status.hasClientId
      ? 'Es öffnet sich Spotify. Nach dem Erlauben geht es automatisch zurück.'
      : 'Erst die Client ID speichern.',
    (content) => {
      const connect = document.createElement('button');
      connect.type = 'button';
      connect.className = 'btn-primary';
      connect.textContent = t('connectSpotify');
      connect.disabled = !status.hasClientId;
      connect.addEventListener('click', startSpotifyAuth);
      content.appendChild(connect);

      // Rückfallebene: Chromes HTTPS-First-Mode kann die Rückleitung
      // blockieren, und im Mobilfunk ist der Spiegel gar nicht erreichbar.
      const details = document.createElement('details');
      details.className = 'spotify-fallback';
      details.innerHTML = `
        <summary>Es kam kein automatischer Rücksprung</summary>
        <p>Dann steht auf der Spotify-Seite ein Code. Hier einfügen:</p>
      `;

      const codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.placeholder = 'Code von der Rückleitungsseite';
      details.appendChild(codeInput);

      const paste = document.createElement('button');
      paste.type = 'button';
      paste.className = 'btn-secondary';
      paste.textContent = t('redeemCode');
      paste.addEventListener('click', async () => {
        const state = sessionStorage.getItem('spotifyState');
        if (!state) {
          alert('Bitte zuerst „Mit Spotify verbinden" antippen.');
          return;
        }

        const response = await fetch('/api/spotify/paste-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: codeInput.value.trim(), state })
        });

        const result = await response.json();
        if (result.ok) initSpotifySetup();
        else alert(result.error || 'Der Code wurde nicht angenommen.');
      });
      details.appendChild(paste);

      content.appendChild(details);
    }
  );
  wrapper.appendChild(connectStep);

  return wrapper;
}

function buildSpotifyStep(number, title, description, fill) {
  const step = document.createElement('div');
  step.className = 'spotify-step';

  const badge = document.createElement('span');
  badge.className = 'spotify-step-number';
  badge.textContent = String(number);
  step.appendChild(badge);

  const content = document.createElement('div');
  content.className = 'spotify-step-content';

  const heading = document.createElement('div');
  heading.className = 'spotify-step-title';
  heading.textContent = title;
  content.appendChild(heading);

  const text = document.createElement('div');
  text.className = 'spotify-step-description';
  text.textContent = description;
  content.appendChild(text);

  fill(content);
  step.appendChild(content);
  return step;
}

/** Ein Feld, das man antippt und dessen Inhalt in der Zwischenablage landet. */
function buildCopyField(value) {
  const row = document.createElement('div');
  row.className = 'spotify-copy';

  const field = document.createElement('code');
  field.textContent = value;
  row.appendChild(field);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary';
  button.textContent = 'Kopieren';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Kopiert';
      if (window.mmPwa) window.mmPwa.tap();
      setTimeout(() => { button.textContent = 'Kopieren'; }, 2000);
    } catch {
      // Ohne Zwischenablage bleibt Markieren - das Feld ist dafür ausgelegt.
      button.textContent = t('pleaseSelect');
    }
  });
  row.appendChild(button);

  return row;
}

async function startSpotifyAuth() {
  try {
    const response = await fetch(`/api/spotify/auth-url?instance=${currentInstance}`);
    const data = await response.json();

    if (!response.ok) {
      alert(data.error || 'Der Anmeldevorgang ließ sich nicht starten.');
      return;
    }

    // Den state merken: die Rückfallebene braucht ihn beim Einlösen von Hand.
    const state = new URL(data.authUrl).searchParams.get('state');
    sessionStorage.setItem('spotifyState', state);

    window.location.href = data.authUrl;
  } catch (error) {
    alert('Der Anmeldevorgang ließ sich nicht starten.');
  }
}

function hideSettings() {
  document.getElementById('settings-actions').style.display = 'none';
  document.getElementById('module-settings').innerHTML = `<p style="color: var(--text-secondary);">${t('pickModuleHint')}</p>`;
  selectedModule = null;
  renderModuleList();
}

async function saveModuleSettings() {
  if (selectedModule === null) return;

  const form = document.getElementById('module-settings-form');
  const formData = new FormData(form);

  const moduleConfig = currentConfig.modules[selectedModule];

  // Position: nur noch eine Zone. Ein leeres Feld heisst "eigene Position",
  // die dann unangetastet bleibt - sonst verliert man beim Speichern der
  // Spracheinstellung sein von Hand gesetztes Raster.
  const gewaehlteZone = formData.get('positionZone');
  if (gewaehlteZone) {
    moduleConfig.position = gewaehlteZone;
  }

  if (!moduleConfig.config) {
    moduleConfig.config = {};
  }

  // Speichere alle Formular-Daten
  const moduleInfo = availableModules.find(m => m.name === moduleConfig.module);
  const secretFields = moduleInfo?.secretFields || [];

  for (const [key, value] of formData.entries()) {
    if (key !== 'position') {
      const schema = moduleInfo?.info.config?.[key];

      if (schema?.type === 'boolean') {
        moduleConfig.config[key] = value === 'on';
      } else if (schema?.type === 'number') {
        moduleConfig.config[key] = parseFloat(value);
      } else if (secretFields.includes(key)) {
        const input = form.querySelector(`input[name="${key}"]`);
        const wasSet = input?.dataset.wasSet === 'true';

        if (value) {
          moduleConfig.config[key] = value;          // neuer Wert
        } else if (wasSet) {
          moduleConfig.config[key] = SECRET_PLACEHOLDER; // unverändert lassen
        } else {
          delete moduleConfig.config[key];           // war und bleibt leer
        }
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
      headers: {
        'Content-Type': 'application/json',
        // Der Server gibt die Kennung im Ereignis zurueck; diese Oberflaeche
        // ignoriert dann ihr eigenes Echo und ueberschreibt sich nicht selbst.
        'X-MM-Client-Id': window.mmLive ? window.mmLive.clientId : ''
      },
      body: JSON.stringify(currentConfig)
    });

    if (response.ok) {
      await loadConfig();
      if (window.refreshActiveLayoutView) {
        window.refreshActiveLayoutView();
      } else {
        renderPreview();
      }
      hideSettings();
      document.dispatchEvent(new CustomEvent('mm:saved'));
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
        cell.textContent = modulName(moduleInfo?.info?.displayName, module.module);
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
      if (window.refreshActiveLayoutView) {
        window.refreshActiveLayoutView();
      } else {
        renderPreview();
      }
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
    appstoreGrid.innerHTML = `<p>${t('modulesLoading')}</p>`;
    return;
  }

  const installedModules = currentConfig.modules || [];

  availableModules.forEach(module => {
    const moduleInfo = module.info || {};
    if (moduleInfo.hidden) return; // Skip hidden modules

    const isInstalled = installedModules.some(m => m.module === module.name);
    const moduleIndex = installedModules.findIndex(m => m.module === module.name);

    const card = document.createElement('div');
    card.className = `appstore-card ${isInstalled ? 'installed' : ''}`;

    // Icon Mapping
    const moduleIcons = {
      'clock': '🕐',
      'weather': '🌤️',
      'untis': '📅',
      'spotify': '🎵',
      'calendar': '📆',
      'news': '📰'
    };

    const icon = moduleIcons[module.name] || '📦';

    card.innerHTML = `
      <div class="appstore-card-header">
        <h3 class="appstore-card-title">${modulName(moduleInfo.displayName, module.name)}</h3>
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
      if (window.refreshActiveLayoutView) {
        window.refreshActiveLayoutView();
      } else {
        renderPreview();
      }

      // Zeige Success-Nachricht
      const displayName = modulName(moduleInfo?.info?.displayName, moduleName);
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
  const displayName = modulName(moduleInfo?.info?.displayName, moduleName);

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
      if (window.refreshActiveLayoutView) {
        window.refreshActiveLayoutView();
      } else {
        renderPreview();
      }

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

  message.textContent = t('checking');
  message.style.color = 'var(--text-secondary)';

  try {
    const response = await fetch('/api/update/check');
    const data = await response.json();

    if (data.updateAvailable) {
      const commits = data.behind === 1
        ? (currentLanguage === 'de' ? '1 neuer Commit' : '1 new commit')
        : (currentLanguage === 'de' ? `${data.behind} neue Commits` : `${data.behind} new commits`);
      message.textContent = `${t('updateAvailable')} (${commits})`;
      message.style.color = 'var(--accent-cyan)';
      if (actionDiv) actionDiv.style.display = 'block';
      showNotification(t('updateAvailable'));
    } else {
      // note kommt z.B. bei einem Branch ohne Upstream - dann ist "aktuell"
      // die falsche Auskunft.
      message.textContent = data.note || t('systemUpToDate');
      message.style.color = 'var(--text-secondary)';
      if (actionDiv) actionDiv.style.display = 'none';
    }
  } catch (error) {
    console.error('Update-Check fehlgeschlagen:', error);
    message.textContent = 'Error';
  }
}

async function executeUpdate() {
  const btn = document.getElementById('execute-update-btn');
  if (!btn) return;

  const confirmMsg = currentLanguage === 'de'
    ? 'Das System wird aktualisiert und anschließend neu gestartet. Fortfahren?'
    : 'The system will be updated and then restarted. Proceed?';
  if (!confirm(confirmMsg)) {
    return;
  }

  btn.disabled = true;
  btn.textContent = currentLanguage === 'de' ? 'Installiere...' : 'Installing...';

  try {
    const response = await fetch('/api/update/execute', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      const successMsg = currentLanguage === 'de' ? 'Update erfolgreich! Neustart...' : 'Update successful! Restarting...';
      showNotification(successMsg);
      setTimeout(() => {
        location.reload();
      }, 5000);
    } else if (data.code === 'DIRTY_WORKING_TREE') {
      // Verhaltensaenderung: frueher wurden lokale Aenderungen still
      // weggestasht und waren praktisch unauffindbar. Jetzt bricht das Update
      // ab und sagt, welche Dateien betroffen sind.
      alert(
        (currentLanguage === 'de'
          ? 'Update abgebrochen: es gibt lokale Änderungen im Projektverzeichnis.\n\n'
          + 'Sie wurden NICHT verworfen. Betroffene Dateien:\n\n'
          : 'Update cancelled: there are local changes in the project directory.\n\n'
          + 'They were NOT discarded. Affected files:\n\n')
        + (data.details || '')
      );
      btn.disabled = false;
      btn.textContent = t('installUpdate');
    } else {
      alert('Update failed: ' + (data.error || 'Unknown error'));
      btn.disabled = false;
      btn.textContent = t('installUpdate');
    }
  } catch (error) {
    console.error('Update-Execution failed:', error);
    alert(currentLanguage === 'de' ? 'Verbindung zum Server verloren während des Updates.' : 'Connection to server lost during update.');
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

// ==================== GRID SETTINGS ====================

function initGridSettings() {
  const columnsInput = document.getElementById('grid-columns');
  const rowsInput = document.getElementById('grid-rows');
  const gapInput = document.getElementById('grid-gap');
  const paddingInput = document.getElementById('grid-padding');
  const saveBtn = document.getElementById('save-grid-settings-btn');
  const layoutModeSelect = document.getElementById('layout-mode');

  if (!saveBtn) return;

  // Layout-Modus Verwaltung
  function getLayoutMode() {
    return localStorage.getItem('layoutMode') || 'visual';
  }

  function setLayoutMode(mode) {
    localStorage.setItem('layoutMode', mode);
    applyLayoutMode(mode);
  }

  function applyLayoutMode(mode) {
    const classicDesktop = document.getElementById('classic-preview-desktop');
    const visualDesktop = document.getElementById('visual-editor-desktop');
    const classicMobile = document.getElementById('classic-preview-mobile');
    const visualMobile = document.getElementById('visual-editor-mobile');

    console.log('Applying layout mode:', mode);

    if (mode === 'classic') {
      // Zeige NUR klassisches Preview, entferne Visual Editor komplett
      if (classicDesktop) {
        classicDesktop.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
        console.log('Showing classic desktop');
      }
      if (visualDesktop) {
        visualDesktop.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; position: absolute !important; left: -9999px !important;';
        console.log('Hiding visual desktop');
      }
      if (classicMobile) {
        classicMobile.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
      }
      if (visualMobile) {
        visualMobile.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; position: absolute !important; left: -9999px !important;';
      }

      // Rendere Preview
      setTimeout(() => renderPreview(), 100);
    } else {
      // Zeige NUR visuellen Editor, entferne klassisches Preview komplett
      if (classicDesktop) {
        classicDesktop.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; position: absolute !important; left: -9999px !important;';
        console.log('Hiding classic desktop');
      }
      if (visualDesktop) {
        visualDesktop.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
        console.log('Showing visual desktop');
      }
      if (classicMobile) {
        classicMobile.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important; position: absolute !important; left: -9999px !important;';
      }
      if (visualMobile) {
        visualMobile.style.cssText = 'display: block !important; visibility: visible !important; opacity: 1 !important;';
      }

      // Initialisiere Visual Editor falls noch nicht geschehen
      setTimeout(() => {
        if (!visualEditorDesktop && !visualEditorMobile) {
          console.log('Initializing visual editor');
          initVisualEditor();
        } else {
          console.log('Updating visual editor config');
          if (visualEditorDesktop) {
            visualEditorDesktop.updateConfig(currentConfig);
          }
          if (visualEditorMobile) {
            visualEditorMobile.updateConfig(currentConfig);
          }
        }
      }, 100);
    }
  }

  // Layout-Modus beim Start laden
  if (layoutModeSelect) {
    const savedMode = getLayoutMode();
    layoutModeSelect.value = savedMode;
    applyLayoutMode(savedMode);

    // Event-Listener für Modus-Änderung
    layoutModeSelect.addEventListener('change', (e) => {
      setLayoutMode(e.target.value);
    });
  }

  // Lade aktuelle Grid-Einstellungen
  function loadGridSettings() {
    if (!currentConfig) return;

    const gridSettings = currentConfig.gridSettings || {
      columns: 3,
      rows: 3,
      gap: 12,
      padding: 12
    };

    if (columnsInput) columnsInput.value = gridSettings.columns;
    if (rowsInput) rowsInput.value = gridSettings.rows;
    if (gapInput) gapInput.value = gridSettings.gap;
    if (paddingInput) paddingInput.value = gridSettings.padding;
  }

  // Initial laden
  loadGridSettings();

  // Bei Config-Änderung neu laden
  const originalLoadConfig = loadConfig;
  window.addEventListener('configLoaded', loadGridSettings);

  // Speichern-Button
  saveBtn.addEventListener('click', async () => {
    if (!currentConfig) return;

    const newGridSettings = {
      columns: parseInt(columnsInput.value) || 3,
      rows: parseInt(rowsInput.value) || 3,
      gap: parseInt(gapInput.value) || 12,
      padding: parseInt(paddingInput.value) || 12,
      columnSizes: [],
      rowSizes: []
    };

    // Generiere columnSizes und rowSizes - alle gleich groß (1fr)
    for (let i = 0; i < newGridSettings.columns; i++) {
      newGridSettings.columnSizes.push('1fr');
    }

    for (let i = 0; i < newGridSettings.rows; i++) {
      newGridSettings.rowSizes.push('1fr');
    }

    currentConfig.gridSettings = newGridSettings;

    try {
      const response = await fetch(`/api/config?instance=${currentInstance}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentConfig)
      });

      if (response.ok) {
        await loadConfig();

        // Aktualisiere die aktive Ansicht
        const currentMode = getLayoutMode();
        if (currentMode === 'classic') {
          renderPreview();
        } else {
          if (visualEditorDesktop) {
            visualEditorDesktop.updateConfig(currentConfig);
          }
          if (visualEditorMobile) {
            visualEditorMobile.updateConfig(currentConfig);
          }
        }

        showNotification('✓ Grid-Einstellungen gespeichert!', 'success');
      }
    } catch (error) {
      console.error('Fehler beim Speichern der Grid-Einstellungen:', error);
      alert('Fehler beim Speichern der Grid-Einstellungen.');
    }
  });

  // Hilfsfunktion: Aktualisiere die aktive Layout-Ansicht
  function refreshActiveLayoutView() {
    const mode = getLayoutMode();
    if (mode === 'classic') {
      renderPreview();
    } else {
      // Aktualisiere beide Editoren falls vorhanden
      if (visualEditorDesktop) {
        visualEditorDesktop.updateConfig(currentConfig);
      }
      if (visualEditorMobile) {
        visualEditorMobile.updateConfig(currentConfig);
      }
    }
  }

  // Mache Funktionen global verfügbar
  window.applyLayoutMode = applyLayoutMode;
  window.getLayoutMode = getLayoutMode;
  window.setLayoutMode = setLayoutMode;
  window.refreshActiveLayoutView = refreshActiveLayoutView;
}

// ==================== VISUAL EDITOR ====================

let visualEditorDesktop = null;
let visualEditorMobile = null;
let zonenEditor = null;

function initVisualEditor() {
  console.log('Initializing visual editor...');

  if (!window.VisualGridEditor) {
    console.error('VisualGridEditor class not found');
    return;
  }

  // Desktop-Editor initialisieren
  const desktopContainer = document.getElementById('visual-editor-container-desktop');
  if (desktopContainer && !visualEditorDesktop) {
    console.log('Creating desktop visual editor');
    visualEditorDesktop = new window.VisualGridEditor(
      '#visual-editor-container-desktop',
      currentConfig,
      async (updatedConfig) => {
        currentConfig = updatedConfig;
        await saveConfigAndRefresh();
      }
    );
  }

  // Zonen-Editor: der Layout-Reiter laeuft nicht mehr ueber die Leinwand.
  const zonenBehaelter = document.getElementById('zonen-editor');
  if (zonenBehaelter && !zonenEditor && window.ZonenEditor) {
    zonenEditor = new window.ZonenEditor('#zonen-editor', currentConfig,
      async (updatedConfig) => {
        currentConfig = updatedConfig;
        await saveConfigAndRefresh();
      });
  } else if (zonenEditor) {
    zonenEditor.updateConfig(currentConfig);
  }

  // Mobile-Editor initialisieren
  const mobileContainer = document.getElementById('visual-editor-container-mobile');
  if (mobileContainer && !visualEditorMobile) {
    console.log('Creating mobile visual editor');
    visualEditorMobile = new window.VisualGridEditor(
      '#visual-editor-container-mobile',
      currentConfig,
      async (updatedConfig) => {
        currentConfig = updatedConfig;
        await saveConfigAndRefresh();
      }
    );
  }

  // Setze visualEditor auf den passenden Editor
  visualEditor = visualEditorDesktop || visualEditorMobile;
}

async function saveConfigAndRefresh() {
  try {
    const response = await fetch(`/api/config?instance=${currentInstance}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentConfig)
    });

    if (response.ok) {
      await loadConfig();

      // Aktualisiere beide Editoren falls vorhanden
      if (visualEditorDesktop) {
        visualEditorDesktop.updateConfig(currentConfig);
      }
      if (visualEditorMobile) {
        visualEditorMobile.updateConfig(currentConfig);
      }

      showNotification('✓ Layout gespeichert!', 'success');
    }
  } catch (error) {
    console.error('Fehler beim Speichern des Layouts:', error);
    alert('Fehler beim Speichern des Layouts.');
  }
}

window.selectModule = selectModule;
