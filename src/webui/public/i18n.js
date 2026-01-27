// Internationalisierung (i18n) für Magic Mirror Config UI

const translations = {
  de: {
    appTitle: 'MagicMirror⁴',
    instance: 'Instanz:',
    modules: 'Module',
    preview: 'Vorschau',
    appStore: 'App Store',
    settings: 'Einstellungen',
    livePreview: 'Live Preview',
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
    update: 'Update',
    updateAvailable: 'Update verfügbar!',
    systemUpToDate: 'System ist auf dem neuesten Stand.',
    checking: 'Prüfe...',
    checkNow: 'Jetzt prüfen',
    installUpdate: 'Update jetzt installieren',
    updateAvailableText: 'Ein neues Update von GitHub ist verfügbar!',
    mirrorTheme: 'Mirror Theme',
    themeDefault: 'Standard',
    themeCyberpunk: 'Cyberpunk',
    gridSettings: 'Grid-Einstellungen',
    columns: 'Spalten',
    rows: 'Zeilen',
    gap: 'Abstand',
    padding: 'Padding',
    applyGridSettings: 'Grid-Einstellungen anwenden',
    positionType: 'Positions-Typ',
    layout: 'Layout',
    layoutEditor: 'Layout Editor'
  },
  en: {
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
    layoutEditor: 'Layout Editor'
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
