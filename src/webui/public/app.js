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

// Visual Editor Instance
let visualEditor = null;

// Initialisierung
document.addEventListener('DOMContentLoaded', async () => {
  // Theme aus LocalStorage laden
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);

  // Tab-Navigation Setup
  setupTabNavigation();

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
  window.ModulBrowser?.zeichneKarten();

  // Warte kurz, bis initGridSettings gelaufen ist - dort haengt der
  // Layout-Modus. applyLayoutMode legt den passenden Editor an.
  setTimeout(() => {
    if (window.applyLayoutMode && window.getLayoutMode) {
      window.applyLayoutMode(window.getLayoutMode());
    } else {
      initVisualEditor();
    }
  }, 300);

  // Event Listeners
  document.getElementById('instance-select')?.addEventListener('change', (e) => {
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

  // Optional: die Schaltflaeche liegt in der Detailansicht. Fehlt sie,
  // darf das nicht den Rest der Verdrahtung abbrechen - genau daran ist
  // einmal die ganze Seite haengengeblieben.
  document.getElementById('save-settings-btn')?.addEventListener('click', () => {
    saveModuleSettings();
  });

  document.getElementById('cancel-settings-btn')?.addEventListener('click', () => {
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

  // Layout-Reiter: den Modus anwenden. Das zeichnet den richtigen Editor,
  // legt ihn beim ersten Mal an und rechnet Zonen um, wenn noetig.
  if (tabName === 'layout' && window.applyLayoutMode && window.getLayoutMode) {
    window.applyLayoutMode(window.getLayoutMode());
  }

  // App Store aktualisieren wenn App Store-Tab geöffnet wird
  if (tabName === 'appstore') {
    renderAppStore();
  }
}



// Die Knoepfe #mode-btn-visual und #mode-btn-classic gab es im Markup nicht
// mehr; der Schalter zwischen den Layout-Ansichten sitzt jetzt im
// Layout-Reiter (.layout-modus-knopf) und wird in initGridSettings verdrahtet.

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
    window.Bildschirm?.zeigeDrehung();
    window.Bildschirm?.zeigeSchutz();
    console.log('Config geladen:', currentConfig); // Debug

    // UI-Sprache an Config anpassen
    if (currentConfig.language && typeof setLanguage === 'function' && currentConfig.language !== currentLanguage) {
      setLanguage(currentConfig.language);
    }

    window.ModulBrowser?.zeichneKarten();
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
  const MIRROR_HEIGHT = 1080;
  let visible = localStorage.getItem('liveViewVisible') === '1';

  function url() {
    // rotate=off: der Rahmen bringt das Format des gedrehten Panels schon mit,
    // der Renderer soll nicht ein zweites Mal drehen.
    return window.Bildschirm?.vorschau(currentInstance).url
      || `/mirror/index.html?instance=${encodeURIComponent(currentInstance)}&preview=1&rotate=off`;
  }

  /**
   * Rahmen und Massstab aus der Drehung.
   *
   * Gezeigt wird, was an der Wand steht - nicht der Bildspeicher. Steht das
   * Panel hochkant, laeuft der Spiegel in 1080x1920 und die Vorschau ist
   * hochkant. Andersherum saehe man den liegenden Bildspeicher mit quer
   * liegendem Text, also gerade nicht das, was man vor sich hat.
   */
  function rescale() {
    const wrapper = frame.parentElement;
    if (!wrapper || section.hidden) return;

    const v = window.Bildschirm?.vorschau(currentInstance)
      || { breite: MIRROR_WIDTH, hoehe: MIRROR_HEIGHT };
    const breite = v.breite;
    const hoehe = v.hoehe;

    frame.style.width = `${breite}px`;
    frame.style.height = `${hoehe}px`;

    // Am Abschnitt messen und nicht am Rahmen: dessen Breite setzen wir gleich
    // selbst, und wer sein eigenes Ergebnis misst, kommt nie zur Ruhe.
    const platz = section.clientWidth || wrapper.clientWidth;
    if (!platz) return;

    // Hochkant ist die Hoehe der Engpass und nicht die Breite: auf volle
    // Spaltenbreite gerechnet waere die Vorschau fast zwei Bildschirme hoch.
    const maxHoehe = Math.round(window.innerHeight * 0.6);
    const scale = Math.min(platz / breite, maxHoehe / hoehe);

    wrapper.style.width = `${Math.round(breite * scale)}px`;
    wrapper.style.height = `${Math.round(hoehe * scale)}px`;
    wrapper.style.setProperty('--live-view-scale', String(scale));
  }

  // Einmal messen genuegt nicht: beim Einblenden steht die Breite des
  // Abschnitts im selben Durchlauf noch nicht fest, und ein Drehen des
  // Telefons aendert sie wieder. Der Beobachter zieht beides nach.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => rescale()).observe(section);
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
      // Noch einmal im naechsten Bild: erst dann steht das Layout des gerade
      // eingeblendeten Abschnitts.
      requestAnimationFrame(rescale);
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

  // Die Drehung aendert das Format des Rahmens. Der Inhalt im iframe richtet
  // sich allein danach - neu laden muss man ihn dafuer nicht.
  document.addEventListener('mm:drehung', () => {
    if (visible) rescale();
  });

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
  window.ModulBrowser?.zeichneKarten();
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
  window.ModulBrowser?.zeichneKarten();
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

// Hier standen setupDragAndDrop() und renderModuleList(): eine Seitenleiste
// mit ziehbaren Modulen (#module-list) und ein Vorschau-Gitter
// (#preview-grid-desktop/-mobile). Alle drei Behaelter sind mit der Umstellung
// auf Modulkarten aus dem Markup verschwunden, die beiden Funktionen kehrten
// seither an ihrer ersten Zeile wieder um. Die Karten zeichnet
// window.ModulBrowser.zeichneKarten().

function selectModule(index) {
  // Auch am window: der Modul-Browser liegt in einer eigenen Datei.
  selectedModule = index;
  window.ModulBrowser?.zeichneKarten();

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

/**
 * Ein Regler von 50 bis 200 Prozent.
 *
 * Gespeichert wird ein Faktor (1 = unveraendert), angezeigt werden Prozent:
 * "120 %" versteht man, "1.2" muss man sich uebersetzen.
 */
function darstellungsRegler(name, beschriftung, wert) {
  const zahl = Number(wert);
  const prozent = Math.round((Number.isFinite(zahl) && zahl > 0 ? zahl : 1) * 100);

  return `
    <div class="darstellung-zeile">
      <label for="${name}">${beschriftung}</label>
      <input type="range" id="${name}" name="${name}"
             min="50" max="200" step="5" value="${prozent}">
      <output for="${name}">${prozent} %</output>
    </div>`;
}

function showModuleSettings(moduleConfig, moduleInfo) {
  const settingsSection = document.getElementById('settings-section');
  const moduleSettings = document.getElementById('module-settings');

  if (settingsSection) settingsSection.style.display = 'block';
  const aktionen = document.getElementById('settings-actions');
  if (aktionen) aktionen.style.display = 'flex';

  const displayName = modulName(moduleInfo?.info?.displayName, moduleConfig.module);
  let html = `<h3>${displayName}</h3>`;
  html += '<form class="settings-form" id="module-settings-form">';

  // An und Aus.
  //
  // Stand frueher als Kaestchen in der Modulliste (#module-list) - die gibt es
  // nicht mehr. Danach fuehrte der einzige Weg ueber den Zonen-Editor: wer im
  // freien Raster arbeitete, konnte ein Modul ueberhaupt nicht mehr abschalten.
  html += '<div class="form-group">';
  html += '<div class="form-group-checkbox">';
  html += `<input type="checkbox" name="moduleEnabled" ${moduleConfig.enabled !== false ? 'checked' : ''}>`;
  html += `<span>${t('moduleActive')}</span>`;
  html += '</div>';
  html += '</div>';

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

  // Groesse und Schriftgroesse.
  //
  // Sie stehen hier oben bei der Position und nicht zwischen den Werten aus
  // dem Manifest, weil sie dem Kern gehoeren und nicht dem Modul: ein Modul
  // muss von seiner Groesse nichts wissen, damit sie sich verstellen laesst.
  const darstellung = moduleConfig.appearance || {};
  html += '<div class="form-group darstellung">';
  html += `<label>${t('appearance')}</label>`;
  html += darstellungsRegler('appearanceScale', t('moduleScale'), darstellung.scale);
  html += darstellungsRegler('appearanceFontScale', t('moduleFontScale'), darstellung.fontScale);
  html += `<p class="form-hint">${t('appearanceHint')}</p>`;
  html += '</div>';

  // Modul-spezifische Einstellungen
  const secretFields = moduleInfo?.secretFields || [];
  if (moduleInfo?.info?.config) {
    Object.entries(moduleInfo.info.config).forEach(([key, schema]) => {
      html += '<div class="form-group">';
      html += `<label>${schema.description || key}</label>`;

      if (Array.isArray(schema.options) && schema.options.length) {
        // Eine Auswahl gehoert in ein Auswahlfeld. Vorher landete sie in
        // einem Textfeld - man konnte den Wert nur abtippen und jeden
        // beliebigen Unsinn eintragen.
        const gewaehlt = moduleConfig.config?.[key] ?? schema.default;
        html += `<select name="${key}">`;
        for (const option of schema.options) {
          const beschriftung = schema.optionLabels?.[option] || option;
          html += `<option value="${option}" ${option === gewaehlt ? 'selected' : ''}>${beschriftung}</option>`;
        }
        html += '</select>';
      } else if (schema.type === 'boolean') {
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

  // Der Wert am Regler soll beim Ziehen mitlaufen - ohne ihn sieht man nur,
  // dass sich etwas bewegt, aber nicht wohin.
  for (const regler of moduleSettings.querySelectorAll('.darstellung-zeile input[type="range"]')) {
    regler.addEventListener('input', () => {
      const anzeige = regler.parentElement.querySelector('output');
      if (anzeige) anzeige.textContent = `${regler.value} %`;
    });
  }

  if (moduleConfig.module === 'untis') {
    initUntisClassPicker(moduleConfig);
  }

  if (moduleConfig.module === 'spotify') {
    initSpotifySetup();
  }

  // Hier stand ein Umschalter zwischen den drei Positionsarten
  // (#position-type-select). Das Auswahlfeld ist mit der Umstellung auf Zonen
  // aus dem Markup verschwunden; die Verdrahtung blieb stehen und tat nichts.
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
  const versteckAktionen = document.getElementById('settings-actions');
  if (versteckAktionen) versteckAktionen.style.display = 'none';
  document.getElementById('module-settings').innerHTML = `<p style="color: var(--text-secondary);">${t('pickModuleHint')}</p>`;
  selectedModule = null;
  window.ModulBrowser?.zeichneKarten();
}

/** Formularfelder, die zum Eintrag gehoeren und nicht in seine `config`. */
const AUSSERHALB_DER_MODULCONFIG = new Set([
  'position',
  'positionZone',
  'moduleEnabled',
  'appearanceScale',
  'appearanceFontScale'
]);

async function saveModuleSettings() {
  if (selectedModule === null) return;

  const form = document.getElementById('module-settings-form');
  const formData = new FormData(form);

  const moduleConfig = currentConfig.modules[selectedModule];

  // Ein nicht angehaktes Kaestchen steht gar nicht in den Formulardaten -
  // fehlt der Eintrag, ist das Modul aus.
  moduleConfig.enabled = formData.get('moduleEnabled') === 'on';

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

  // Groesse und Schriftgroesse gehoeren zum Rahmen, nicht in die Einstellungen
  // des Moduls - deshalb neben `config` und nicht darin. Steht beides auf 100
  // Prozent, faellt der Eintrag ganz weg: der Standard hat in der Datei nichts
  // zu suchen.
  //
  // Erst auf null pruefen, dann umrechnen: Number(null) ist 0 und nicht NaN.
  // Fehlten die Regler im Formular, stuende danach scale: 0 in der Datei - der
  // Spiegel biegt das zwar zurecht, aber in der Konfiguration staende Unsinn.
  const rohGroesse = formData.get('appearanceScale');
  const rohSchrift = formData.get('appearanceFontScale');
  if (rohGroesse !== null && rohSchrift !== null) {
    const scale = Number(rohGroesse);
    const fontScale = Number(rohSchrift);

    if (!Number.isFinite(scale) || !Number.isFinite(fontScale)) {
      // Nichts anfassen - lieber der alte Wert als ein kaputter.
    } else if (scale === 100 && fontScale === 100) {
      delete moduleConfig.appearance;
    } else {
      moduleConfig.appearance = { scale: scale / 100, fontScale: fontScale / 100 };
    }
  }

  // Speichere alle Formular-Daten
  const moduleInfo = availableModules.find(m => m.name === moduleConfig.module);
  const secretFields = moduleInfo?.secretFields || [];

  for (const [key, value] of formData.entries()) {
    // Platzierung und Darstellung gehoeren nicht in die Einstellungen des
      // Moduls. Ohne diese Ausnahme landeten sie als Konfigurationswerte im
      // Modul und wuerden bei jedem Speichern mitgeschleppt.
      if (!AUSSERHALB_DER_MODULCONFIG.has(key)) {
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


/**
 * Die aktive Layout-Ansicht neu zeichnen.
 *
 * Hiess einmal so, weil sie ein festes 3x3-Gitter in #preview-grid-desktop und
 * #preview-grid-mobile zeichnete. Beide Behaelter gibt es im Markup nicht mehr -
 * die Funktion lief an vierzehn Aufrufstellen ins Leere, und damit blieb jede
 * Aenderung am Layout unsichtbar, bis jemand die Seite neu lud.
 *
 * Der Name bleibt, weil er an diesen vierzehn Stellen steht. Der Inhalt
 * aktualisiert jetzt den Editor, der gerade sichtbar ist.
 */
function renderPreview() {
  if (visualEditor) visualEditor.updateConfig(currentConfig);
  if (zonenEditor) zonenEditor.updateConfig(currentConfig);
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
      window.ModulBrowser?.zeichneKarten();
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
      window.ModulBrowser?.zeichneKarten();
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

  if (!saveBtn) return;

  // --- Layout-Modus ---------------------------------------------------------
  //
  // Zwei Bedienkonzepte auf denselben Daten:
  //
  //   zonen    sechs grosse Flaechen im 3x3-Grundraster. Mit dem Daumen
  //            bedienbar - aber eben nur sechs Plaetze.
  //   raster   das Raster aus den Einstellungen, jede Zelle einzeln, Griffe
  //            an den Ecken.
  //
  // Hier stand einmal ein Schalter zwischen "klassisch" und "visuell", der auf
  // #classic-preview-desktop und #visual-editor-desktop zeigte. Beide Behaelter
  // gab es im Markup nicht: der Editor wurde nie gezeichnet, und das
  // Rasterformular schrieb Werte, die niemand las. Wer 6x12 einstellte, sah
  // weiter sechs Zonen. tests/layout-verdrahtung.test.js wacht jetzt darueber,
  // dass jeder Behaelter, den dieser Code sucht, auch existiert.

  function getLayoutMode() {
    const gespeichert = localStorage.getItem('layoutMode');
    if (gespeichert === 'zonen' || gespeichert === 'raster') return gespeichert;

    // Alte Werte ("visual", "classic") und der erste Start: auf einem Telefon
    // sind Zonen die bessere Wahl, auf einem breiten Bildschirm das Raster.
    return window.innerWidth < 768 ? 'zonen' : 'raster';
  }

  function setLayoutMode(mode) {
    localStorage.setItem('layoutMode', mode);
    applyLayoutMode(mode);
  }

  function applyLayoutMode(mode) {
    const zonenBehaelter = document.getElementById('zonen-editor');
    const rasterBehaelter = document.getElementById('visual-editor-container');
    if (!zonenBehaelter || !rasterBehaelter) return;

    const freiesRaster = mode === 'raster';
    zonenBehaelter.hidden = freiesRaster;
    rasterBehaelter.hidden = !freiesRaster;

    for (const knopf of document.querySelectorAll('.layout-modus-knopf')) {
      const aktiv = knopf.dataset.modus === mode;
      knopf.classList.toggle('aktiv', aktiv);
      knopf.setAttribute('aria-pressed', String(aktiv));
    }

    // Erst umrechnen, dann zeichnen: der Editor soll die Module gleich an
    // ihrem Platz im Raster finden und nicht erst nach dem ersten Ziehen.
    if (freiesRaster) uebernehmeZonenInsRaster();

    initVisualEditor();
    renderPreview();
  }


  // Layout-Modus beim Start setzen und die Knoepfe verdrahten.
  for (const knopf of document.querySelectorAll('.layout-modus-knopf')) {
    knopf.addEventListener('click', () => setLayoutMode(knopf.dataset.modus));
  }
  applyLayoutMode(getLayoutMode());

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
        renderPreview();
        showNotification('✓ Grid-Einstellungen gespeichert!', 'success');
      }
    } catch (error) {
      console.error('Fehler beim Speichern der Grid-Einstellungen:', error);
      alert('Fehler beim Speichern der Grid-Einstellungen.');
    }
  });

  // Hilfsfunktion: Aktualisiere die aktive Layout-Ansicht.
  // Beide Namen zeigen auf dieselbe Arbeit - renderPreview() steht an vierzehn
  // Stellen, refreshActiveLayoutView an sieben.
  function refreshActiveLayoutView() {
    renderPreview();
  }

  // Mache Funktionen global verfügbar
  window.applyLayoutMode = applyLayoutMode;
  window.getLayoutMode = getLayoutMode;
  window.setLayoutMode = setLayoutMode;
  window.refreshActiveLayoutView = refreshActiveLayoutView;
}

// ==================== VISUAL EDITOR ====================

// Ein Editor, nicht zwei. Vorher gab es visualEditorDesktop und
// visualEditorMobile fuer zwei Behaelter, die es im Markup beide nicht gab.
// visualEditor selbst ist schon oben deklariert.
let zonenEditor = null;

/**
 * Zonen einmalig in echte Rasterkoordinaten umrechnen.
 *
 * Solange ALLE Module auf Zonen stehen, ersetzt der Renderer das eingestellte
 * Raster durch das 3x3-Zonenraster (siehe buildGridCSS). Wer 6x12 einstellt,
 * sieht davon nichts - genau der Widerspruch zwischen Einstellungen und
 * Editor, der jahrelang zu sehen war.
 *
 * Beim Wechsel ins freie Raster werden Zonen deshalb umgerechnet. Die Flaeche
 * bleibt dieselbe: eine Zone belegt ein Drittel, und ein Drittel von zwoelf
 * Zeilen sind vier. Danach ist jedes Modul frei verschiebbar.
 */
function uebernehmeZonenInsRaster() {
  const zonen = window.MMZonen;
  if (!zonen || !currentConfig || !Array.isArray(currentConfig.modules)) return 0;

  const raster = currentConfig.gridSettings || {};
  const spalten = Math.max(1, Number(raster.columns) || 3);
  const zeilen = Math.max(1, Number(raster.rows) || 3);

  const faktorSpalte = spalten / zonen.ZONEN_RASTER.columns;
  const faktorZeile = zeilen / zonen.ZONEN_RASTER.rows;

  let umgerechnet = 0;

  for (const modul of currentConfig.modules) {
    const zonenId = zonen.alsZone(modul.position);
    if (!zonenId) continue;   // hat schon eine eigene Rasterposition

    const feld = zonen.gitter(zonenId);
    const groesse = zonen.groesse(modul.position);
    const z = zonen.zone(zonenId);
    if (!feld || !z) continue;

    const spalte = Math.round((feld.col - 1) * faktorSpalte) + 1;
    const zeile = Math.round((feld.row - 1) * faktorZeile) + 1;

    // "unten" geht ueber die ganze Breite - das steht als 1/-1 in der Zone und
    // nicht in colSpan. Ohne diesen Fall waere das Modul nach dem Umrechnen
    // nur noch ein Drittel breit.
    const breite = feld.volleBreite
      ? spalten
      : Math.max(1, Math.round(groesse.colSpan * faktorSpalte));
    const hoehe = Math.max(1, Math.round(groesse.rowSpan * faktorZeile));

    modul.position = {
      column: Math.min(spalte, spalten),
      row: Math.min(zeile, zeilen),
      columnSpan: Math.min(breite, spalten - Math.min(spalte, spalten) + 1),
      rowSpan: Math.min(hoehe, zeilen - Math.min(zeile, zeilen) + 1),
      // Ausrichtung aus der Zone mitnehmen, damit der Inhalt liegen bleibt,
      // wo er lag.
      align: z.align,
      justify: z.justify
    };

    umgerechnet += 1;
  }

  if (umgerechnet > 0) {
    saveConfigAndRefresh();
    showNotification(`${umgerechnet} × ${t('zonesConverted')}`, 'success');
  }

  return umgerechnet;
}

function initVisualEditor() {
  const rasterBehaelter = document.getElementById('visual-editor-container');
  if (rasterBehaelter && !visualEditor && window.VisualGridEditor) {
    visualEditor = new window.VisualGridEditor(
      '#visual-editor-container',
      currentConfig,
      async (updatedConfig) => {
        currentConfig = updatedConfig;
        await saveConfigAndRefresh();
      }
    );
  }

  const zonenBehaelter = document.getElementById('zonen-editor');
  if (zonenBehaelter && !zonenEditor && window.ZonenEditor) {
    zonenEditor = new window.ZonenEditor('#zonen-editor', currentConfig,
      async (updatedConfig) => {
        currentConfig = updatedConfig;
        await saveConfigAndRefresh();
      });
  }
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
      renderPreview();
      showNotification('✓ Layout gespeichert!', 'success');
    }
  } catch (error) {
    console.error('Fehler beim Speichern des Layouts:', error);
    alert('Fehler beim Speichern des Layouts.');
  }
}

window.selectModule = selectModule;
