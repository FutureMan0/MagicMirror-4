// Internationalisierung (i18n) für Magic Mirror Config UI

const translations = {
  de: {
    moduleOn: 'An',
    moduleOff: 'Aus',
    livePreviewBackdrop: 'Spiegel im Hintergrund',
    back: 'Zurück',
    positionHint: 'Feiner einstellen im Reiter Layout.',
    positionCustom: 'Dieses Modul hat eine von Hand gesetzte Position. Sie bleibt erhalten; im Reiter Layout lässt sie sich auf eine Zone umstellen.',
    zoneHint: 'Modul in eine Zone ziehen — oder antippen, dann die Zone.',
    zoneFrei: 'Freie Position',
    zoneTapZone: 'Jetzt eine Zone antippen.',
    zoneTapModule: 'Ein Modul antippen, dann eine Zone.',
    offlineBanner: 'Keine Verbindung zum Spiegel — Änderungen sind vorübergehend gesperrt.',
    offlineShort: 'Keine Verbindung zum Spiegel',
    pickModuleHint: 'Links ein Modul antippen, um es einzustellen.',
    livePreviewHint: 'zeigt den Spiegel, wie er gerade aussieht',
    classPick: 'Klasse wählen…',
    classesLoad: 'Klassen laden',
    statusFailed: 'Status konnte nicht geladen werden.',
    disconnect: 'Verbindung trennen',
    spotifyPremium: 'Spotify verlangt für eigene Apps ein Premium-Konto',
    openDashboard: 'Dashboard öffnen',
    connectSpotify: 'Mit Spotify verbinden',
    redeemCode: 'Code einlösen',
    pleaseSelect: 'Bitte markieren',
    modulesLoading: 'Lade Module...',
    privacyStateFailed: 'Der Zustand ließ sich nicht laden.',
    noSensor: 'Kein Sensor eingerichtet.',
    haNotConfigured: 'Home Assistant ist nicht eingerichtet.',
    haControlOff: 'Schalten ist ausgeschaltet. In den Einstellungen des Moduls „Schalten erlauben" einschalten.',
    haNoEntities: 'Keine Entitäten eingetragen.',
    themesFailed: 'Themes konnten nicht geladen werden.',
    classesLoading: 'Klassen laden …',
    classesNone: 'Keine Klassen gefunden',
    // Nachgetragen: diese Texte standen fest im Markup und blieben deshalb
    // deutsch, auch wenn die Oberflaeche auf Englisch stand.
    layoutVisual: 'Visuell',
    layoutClassic: 'Klassisch',
    liveView: 'Live-Ansicht',
    reload: 'Neu laden',
    control: 'Steuerung',
    privacy: 'Privatsphäre',
    privacyShort: 'Privat',
    loading: 'Wird geladen …',
    editorGrid: 'Raster',
    editorEditOn: 'Bearbeiten: an',
    editorEditOff: 'Bearbeiten: aus',
    editorReset: 'Zurücksetzen',
    appTitle: 'MagicMirror⁴',
    instance: 'Instanz:',
    modules: 'Module',
    preview: 'Vorschau',
    appStore: 'App Store',
    settings: 'Einstellungen',
    livePreview: 'Live-Vorschau',
    moduleSettings: 'Modul-Einstellungen',
    selectModuleHint: 'Wähle ein Modul links, um es zu konfigurieren.',
    dragDropHint: 'Ziehe Module aus der Liste auf die gewünschte Position im Grid.',
    save: 'Speichern',
    cancel: 'Abbrechen',
    theme: 'Design',
    themeDark: 'Dunkel',
    themeLight: 'Hell',
    themeOled: 'OLED',
    language: 'Sprache',
    position: 'Position',
    positionTopLeft: 'Oben Links',
    positionTopCenter: 'Oben Mitte',
    positionTopRight: 'Oben Rechts',
    positionMiddleLeft: 'Mitte Links',
    positionMiddleCenter: 'Mitte',
    positionMiddleRight: 'Mitte Rechts',
    positionBottomLeft: 'Unten Links',
    positionBottomCenter: 'Unten Mitte',
    positionBottomRight: 'Unten Rechts',
    update: 'Aktualisieren',
    updateAvailable: 'Update verfügbar!',
    systemUpToDate: 'System ist auf dem neuesten Stand.',
    checking: 'Prüfe...',
    checkNow: 'Jetzt prüfen',
    installUpdate: 'Update jetzt installieren',
    updateAvailableText: 'Ein neues Update von GitHub ist verfügbar!',
    mirrorTheme: 'Spiegel-Theme',
    themeDefault: 'Standard',
    themeCyberpunk: 'Cyberpunk',
    gridSettings: 'Grid-Einstellungen',
    columns: 'Spalten',
    rows: 'Zeilen',
    gap: 'Abstand',
    padding: 'Innenabstand',
    applyGridSettings: 'Grid-Einstellungen anwenden',
    positionType: 'Positions-Typ',
    layout: 'Layout',
    layoutEditor: 'Layout-Editor',
    layoutMode: 'Layout-Modus',
    classicGridMode: 'Klassisches Grid (Vorschau)',
    visualEditorMode: 'Visueller Editor (Experimentell)',
    layoutModeHint: 'Wähle einen Modus. Der Visuelle Editor ist experimentell – bei Problemen bitte das Klassische Grid verwenden.',
    visualEditorDesc: 'Visueller Editor mit Drag & Drop und Resize-Funktionen.',
    visualEditorNote: 'Hinweis: Dieses Feature ist experimentell. Bei Problemen bitte zum Klassischen Grid wechseln.',
    addModule: '+ Modul hinzufügen',
    searchPlaceholder: 'Suchen...'
  },
  en: {
    moduleOn: 'On',
    moduleOff: 'Off',
    livePreviewBackdrop: 'Mirror as backdrop',
    back: 'Back',
    positionHint: 'Fine-tune it in the Layout tab.',
    positionCustom: 'This module uses a custom position. It stays as it is; the Layout tab can switch it to a zone.',
    zoneHint: 'Drag a module into a zone — or tap it, then the zone.',
    zoneFrei: 'Custom position',
    zoneTapZone: 'Now tap a zone.',
    zoneTapModule: 'Tap a module, then a zone.',
    offlineBanner: 'No connection to the mirror — changes are locked for now.',
    offlineShort: 'No connection to the mirror',
    pickModuleHint: 'Tap a module on the left to configure it.',
    livePreviewHint: 'shows the mirror exactly as it looks right now',
    classPick: 'Choose class…',
    classesLoad: 'Load classes',
    statusFailed: 'Status could not be loaded.',
    disconnect: 'Disconnect',
    spotifyPremium: 'Spotify requires a Premium account for your own apps',
    openDashboard: 'Open dashboard',
    connectSpotify: 'Connect to Spotify',
    redeemCode: 'Redeem code',
    pleaseSelect: 'Please select',
    modulesLoading: 'Loading modules…',
    privacyStateFailed: 'The state could not be loaded.',
    noSensor: 'No sensor configured.',
    haNotConfigured: 'Home Assistant is not set up.',
    haControlOff: 'Switching is off. Enable “Allow switching” in the module settings.',
    haNoEntities: 'No entities configured.',
    themesFailed: 'Themes could not be loaded.',
    classesLoading: 'Loading classes …',
    classesNone: 'No classes found',
    layoutVisual: 'Visual',
    layoutClassic: 'Classic',
    liveView: 'Live view',
    reload: 'Reload',
    control: 'Control',
    privacy: 'Privacy',
    privacyShort: 'Privacy',
    loading: 'Loading …',
    editorGrid: 'Grid',
    editorEditOn: 'Editing: on',
    editorEditOff: 'Editing: off',
    editorReset: 'Reset',
    appTitle: 'MagicMirror⁴',
    instance: 'Instance:',
    modules: 'Modules',
    preview: 'Preview',
    appStore: 'App Store',
    settings: 'Settings',
    livePreview: 'Live Preview',
    moduleSettings: 'Module Settings',
    selectModuleHint: 'Select a module on the left to configure it.',
    dragDropHint: 'Drag modules from the list to the desired position in the grid.',
    save: 'Save',
    cancel: 'Cancel',
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeOled: 'OLED',
    language: 'Language',
    position: 'Position',
    positionTopLeft: 'Top Left',
    positionTopCenter: 'Top Center',
    positionTopRight: 'Top Right',
    positionMiddleLeft: 'Middle Left',
    positionMiddleCenter: 'Center',
    positionMiddleRight: 'Middle Right',
    positionBottomLeft: 'Bottom Left',
    positionBottomCenter: 'Bottom Center',
    positionBottomRight: 'Bottom Right',
    update: 'Update',
    updateAvailable: 'Update available!',
    systemUpToDate: 'System is up to date.',
    checking: 'Checking...',
    checkNow: 'Check now',
    installUpdate: 'Install update now',
    updateAvailableText: 'A new update from GitHub is available!',
    mirrorTheme: 'Mirror Theme',
    themeDefault: 'Default',
    themeCyberpunk: 'Cyberpunk',
    gridSettings: 'Grid Settings',
    columns: 'Columns',
    rows: 'Rows',
    gap: 'Gap',
    padding: 'Padding',
    applyGridSettings: 'Apply Grid Settings',
    positionType: 'Position Type',
    layout: 'Layout',
    layoutEditor: 'Layout Editor',
    layoutMode: 'Layout Mode',
    classicGridMode: 'Classic Grid (Preview)',
    visualEditorMode: 'Visual Editor (Experimental)',
    layoutModeHint: 'Choose a mode. The Visual Editor is experimental – if you encounter issues, please use the Classic Grid.',
    visualEditorDesc: 'Visual Editor with Drag & Drop and Resize functions.',
    visualEditorNote: 'Note: This feature is experimental. If you encounter issues, please switch to the Classic Grid.',
    addModule: '+ Add Module',
    searchPlaceholder: 'Search...'
  }
};

// Position Names für Übersetzung
const positionNames = {
  de: {
    'top_left': 'Oben Links',
    'top_center': 'Oben Mitte',
    'top_right': 'Oben Rechts',
    'middle_left': 'Mitte Links',
    'middle_center': 'Mitte',
    'middle_right': 'Mitte Rechts',
    'bottom_left': 'Unten Links',
    'bottom_center': 'Unten Mitte',
    'bottom_right': 'Unten Rechts'
  },
  en: {
    'top_left': 'Top Left',
    'top_center': 'Top Center',
    'top_right': 'Top Right',
    'middle_left': 'Middle Left',
    'middle_center': 'Center',
    'middle_right': 'Middle Right',
    'bottom_left': 'Bottom Left',
    'bottom_center': 'Bottom Center',
    'bottom_right': 'Bottom Right'
  }
};

// Aktuelle Sprache (wird aus LocalStorage geladen)
let currentLanguage = localStorage.getItem('language') || 'de';

/** Die eingestellte Sprache - fuer alles, was nicht ueber t() laeuft. */
function getCurrentLanguage() {
  return currentLanguage;
}

// Übersetzungsfunktion
function t(key) {
  return translations[currentLanguage]?.[key] || translations.de[key] || key;
}

// Positionsnamen übersetzen
function getPositionName(position) {
  return positionNames[currentLanguage]?.[position] || position;
}

// Alle Elemente mit data-i18n Attribut übersetzen
function updatePageTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    const translation = t(key);

    // Text-Inhalte aktualisieren
    if (element.tagName === 'INPUT' || element.tagName === 'BUTTON') {
      // Für Buttons/Inputs nur wenn kein Icon drin ist
      if (!element.querySelector('.icon')) {
        element.textContent = translation;
      }
    } else if (element.tagName === 'SELECT') {
      // Select-Elemente nicht direkt ändern
    } else {
      element.textContent = translation;
    }
  });

  // HTML lang Attribut aktualisieren
  document.documentElement.lang = currentLanguage;
}

// Sprache ändern
function setLanguage(lang) {
  if (translations[lang]) {
    currentLanguage = lang;
    localStorage.setItem('language', lang);
    updatePageTranslations();

    // Event für andere Scripts
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
  }
}

// Initial-Setup
document.addEventListener('DOMContentLoaded', () => {
  updatePageTranslations();

  // Sprach-Selector Setup
  const languageSelect = document.getElementById('language-select');
  if (languageSelect) {
    languageSelect.value = currentLanguage;
    languageSelect.addEventListener('change', (e) => {
      setLanguage(e.target.value);
    });
  }
});
