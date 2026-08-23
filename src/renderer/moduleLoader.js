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
      // Lade Modul als Script-Tag statt via eval.
      // script.onload feuert erst nach der Ausfuehrung des Scripts, das Modul
      // hat sich zu diesem Zeitpunkt also bereits registriert.
      await this.loadModuleScript(moduleName);

      // Prüfe ob die Klasse registriert wurde
      if (!window.MagicMirrorModules || !window.MagicMirrorModules[moduleName]) {
        console.error(`Modul ${moduleName} hat sich nicht registriert`);
        return false;
      }

      const ModuleClass = window.MagicMirrorModules[moduleName];
      this.moduleClasses.set(moduleName, ModuleClass);

      // Lade Styles. Ueber IPC, wenn wir in Electron laufen - sonst per HTTP,
      // damit dieselbe Ansicht auch in einem normalen Browser funktioniert.
      const styles = await this.fetchModuleStyles(moduleName);
      if (styles) {
        this.injectStyles(moduleName, styles);
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
   * Holt das Stylesheet eines Moduls - per IPC oder per HTTP.
   */
  async fetchModuleStyles(moduleName) {
    if (window.electronAPI && window.electronAPI.getModuleStyles) {
      const result = await window.electronAPI.getModuleStyles(moduleName);
      return result.success ? result.styles : '';
    }

    try {
      const response = await fetch(`../../modules/${moduleName}/styles.css`);
      // Ein Modul ohne Stylesheet ist voellig in Ordnung.
      return response.ok ? await response.text() : '';
    } catch {
      return '';
    }
  }

  /**
   * Erstellt eine Instanz eines geladenen Moduls
   * @param {string} moduleName - Name des Moduls
   * @param {object} config - Konfiguration für das Modul
   * @param {object} envConfig - Umgebungsvariablen
   * @param {string} language - Aktuelle Sprache
   * @returns {Promise<{ok: boolean, element: HTMLElement, error?: string}>}
   *
   * Liefert bewusst ein Ergebnisobjekt statt nur eines Elements: bei einem
   * Fehler entsteht ebenfalls ein Element (der Platzhalter), und der Aufrufer
   * konnte bisher nicht unterscheiden, ob das Modul lief oder nur so aussah.
   * Der Smoke-Test haengt genau daran.
   */
  async createModuleInstance(moduleName, config = {}, envConfig = {}, language = 'en', instanceKey = null) {
    // Lade Modul, falls noch nicht geladen
    if (!this.moduleClasses.has(moduleName)) {
      const loaded = await this.loadModule(moduleName);
      if (!loaded) {
        const message = 'Modul konnte nicht geladen werden';
        return { ok: false, error: message, element: this.createPlaceholder(moduleName, message) };
      }
    }

    const ModuleClass = this.moduleClasses.get(moduleName);

    try {
      // Merge config mit envConfig (für API-Keys etc.) und language
      const mergedConfig = this.mergeConfig(moduleName, config, envConfig, language);

      // Erstelle Instanz
      const instance = new ModuleClass(mergedConfig);
      this.loadedModules.set(instanceKey || moduleName, instance);

      if (typeof instance.render !== 'function') {
        const message = 'Modul hat keine render() Methode';
        console.error(`Modul ${moduleName}: ${message}`);
        return { ok: false, error: message, element: this.createPlaceholder(moduleName, message) };
      }

      // init() ist optional und darf asynchron vorbereiten, bevor gezeichnet wird.
      if (typeof instance.init === 'function') {
        await instance.init();
      }

      const element = await instance.render();

      // null ist erlaubt: ein Modul ohne Anzeige (etwa der Praesenzsensor mit
      // hideUI). Dann entsteht auch kein Container.
      return { ok: true, element: element || null, headless: !element };
    } catch (error) {
      console.error(`Fehler beim Erstellen der Modul-Instanz ${moduleName}:`, error);
      return {
        ok: false,
        error: error.message,
        element: this.createPlaceholder(moduleName, `Fehler: ${error.message}`)
      };
    }
  }

  /**
   * Merge Modul-Config mit globaler Sprache.
   *
   * Hier stand ein switch, der für weather, untis und spotify die
   * Zugangsdaten aus dem env-Objekt in die Modul-Konfiguration schob. Damit
   * musste jedes neue Modul mit API-Schlüssel den Kern anfassen.
   *
   * Der Hauptprozess setzt die deklarierten Werte jetzt schon beim Laden der
   * Konfiguration ein (siehe ConfigManager) - und lässt die weg, die laut
   * Manifest gar nicht in den Browser gehören.
   */
  mergeConfig(moduleName, config, envConfig, language) {
    return { ...config, language };
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

    const styleElement = document.createElement('style');
    styleElement.id = styleId;

    // Modul-CSS wird nach dem Theme-Stylesheet in den <head> gehängt und
    // würde deshalb bei gleicher Spezifität gewinnen. Genau deswegen stand im
    // alten cyberpunk.css 21 mal !important. In @layer module verpackt kann
    // ein Theme (@layer theme) unbedingt durchgreifen - ohne dass die Module
    // dafür angepasst werden müssen.
    //
    // Module dürfen ihre eigenen Layer mitbringen; @layer verschachtelt sich
    // sauber zu module.<eigener-name>.
    styleElement.textContent = `@layer module {\n${css}\n}`;

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
   * Liefert die laufende Instanz zu einem Instanz-Schlüssel
   */
  getInstance(instanceKey) {
    return this.loadedModules.get(instanceKey) || null;
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
