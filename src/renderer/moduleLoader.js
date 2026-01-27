// Renderer Module Loader - Browser-kompatibel
// Lädt Module dynamisch als Script-Dateien

// Globale Registry für Module
if (!window.MagicMirrorModules) {
  window.MagicMirrorModules = {};
}

class RendererModuleLoader {
  constructor() {
    this.loadedModules = new Map();
    this.moduleClasses = new Map();
  }

  /**
   * Lädt ein Modul dynamisch vom Main-Prozess
   * @param {string} moduleName - Name des Moduls
   * @returns {Promise<boolean>} - Erfolgreich geladen
   */
  async loadModule(moduleName) {
    if (this.moduleClasses.has(moduleName)) {
      return true; // Bereits geladen
    }

    try {
      // Lade Modul als Script-Tag statt via eval
      await this.loadModuleScript(moduleName);

      // Warte kurz, bis das Script geladen ist
      await new Promise(resolve => setTimeout(resolve, 100));

      // Prüfe ob die Klasse registriert wurde
      if (!window.MagicMirrorModules || !window.MagicMirrorModules[moduleName]) {
        console.error(`Modul ${moduleName} hat sich nicht registriert`);
        return false;
      }

      const ModuleClass = window.MagicMirrorModules[moduleName];
      this.moduleClasses.set(moduleName, ModuleClass);

      // Lade Styles
      const stylesResult = await window.electronAPI.getModuleStyles(moduleName);
      if (stylesResult.success && stylesResult.styles) {
        this.injectStyles(moduleName, stylesResult.styles);
      }

      console.log(`Modul ${moduleName} erfolgreich geladen`);
      return true;
    } catch (error) {
      console.error(`Fehler beim Laden des Moduls ${moduleName}:`, error);
      return false;
    }
  }

  /**
   * Lädt Modul-Script via Script-Tag
   */
  async loadModuleScript(moduleName) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = `module-script-${moduleName}`;
      script.src = `../../modules/${moduleName}/index.js`;
      script.onload = () => resolve();
      script.onerror = (error) => reject(new Error(`Script konnte nicht geladen werden: ${error}`));
      document.head.appendChild(script);
    });
  }

  /**
   * Erstellt eine Instanz eines geladenen Moduls
   * @param {string} moduleName - Name des Moduls
   * @param {object} config - Konfiguration für das Modul
   * @param {object} envConfig - Umgebungsvariablen
   * @param {string} language - Aktuelle Sprache
   * @returns {Promise<HTMLElement|null>} - Gerenderte Modul-Instanz
   */
  async createModuleInstance(moduleName, config = {}, envConfig = {}, language = 'en') {
    // Lade Modul, falls noch nicht geladen
    if (!this.moduleClasses.has(moduleName)) {
      const loaded = await this.loadModule(moduleName);
      if (!loaded) {
        return this.createPlaceholder(moduleName, 'Modul konnte nicht geladen werden');
      }
    }

    const ModuleClass = this.moduleClasses.get(moduleName);

    try {
      // Merge config mit envConfig (für API-Keys etc.) und language
      const mergedConfig = this.mergeConfig(moduleName, config, envConfig, language);

      // Erstelle Instanz
      const instance = new ModuleClass(mergedConfig);
      this.loadedModules.set(`${moduleName}-${Date.now()}`, instance);

      // Rufe render() Methode auf
      if (typeof instance.render === 'function') {
        const element = await instance.render();
        return element;
      } else {
        console.error(`Modul ${moduleName} hat keine render() Methode`);
        return this.createPlaceholder(moduleName, 'Modul hat keine render() Methode');
      }
    } catch (error) {
      console.error(`Fehler beim Erstellen der Modul-Instanz ${moduleName}:`, error);
      return this.createPlaceholder(moduleName, `Fehler: ${error.message}`);
    }
  }

  /**
   * Merge Modul-Config mit Environment-Config und globaler Sprache
   */
  mergeConfig(moduleName, config, envConfig, language) {
    const merged = { ...config, language };

    // Modul-spezifische Env-Mappings
    switch (moduleName) {
      case 'weather':
        if (!merged.apiKey && envConfig.openweathermapApiKey) {
          merged.apiKey = envConfig.openweathermapApiKey;
        }
        break;
      case 'untis':
        if (!merged.server && envConfig.untisServer) merged.server = envConfig.untisServer;
        if (!merged.username && envConfig.untisUsername) merged.username = envConfig.untisUsername;
        if (!merged.password && envConfig.untisPassword) merged.password = envConfig.untisPassword;
        if (!merged.school && envConfig.untisSchool) merged.school = envConfig.untisSchool;
        break;
      case 'spotify':
        if (!merged.clientId && envConfig.spotifyClientId) merged.clientId = envConfig.spotifyClientId;
        if (!merged.clientSecret && envConfig.spotifyClientSecret) merged.clientSecret = envConfig.spotifyClientSecret;
        break;
    }

    return merged;
  }

  /**
   * Injiziert CSS-Styles für ein Modul
   */
  injectStyles(moduleName, css) {
    const styleId = `module-styles-${moduleName}`;

    // Entferne alte Styles, falls vorhanden
    const existingStyle = document.getElementById(styleId);
    if (existingStyle) {
      existingStyle.remove();
    }

    // Erstelle neues Style-Element
    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
  }

  /**
   * Erstellt ein Platzhalter-Element für fehlgeschlagene Module
   */
  createPlaceholder(moduleName, errorMessage) {
    const placeholder = document.createElement('div');
    placeholder.className = `module-${moduleName} module-placeholder`;
    placeholder.innerHTML = `
      <div class="module-error">
        <div class="module-error-title">${moduleName}</div>
        <div class="module-error-message">${errorMessage}</div>
      </div>
    `;
    return placeholder;
  }

  /**
   * Cleanup: Zerstöre alle geladenen Module
   */
  destroyAll() {
    this.loadedModules.forEach((instance, key) => {
      if (typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch (error) {
          console.error(`Fehler beim Zerstören der Modul-Instanz ${key}:`, error);
        }
      }
    });
    this.loadedModules.clear();
  }
}

// Exportiere als globale Variable für renderer.js
window.RendererModuleLoader = RendererModuleLoader;
