const fs = require('fs');
const path = require('path');

class ModuleLoader {
  constructor(modulesPath) {
    this.modulesPath = modulesPath;
    this.loadedModules = new Map();
  }

  scanModules() {
    const modules = [];
    
    if (!fs.existsSync(this.modulesPath)) {
      return modules;
    }

    const entries = fs.readdirSync(this.modulesPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const modulePath = path.join(this.modulesPath, entry.name);
        const moduleJsonPath = path.join(modulePath, 'module.json');
        
        if (fs.existsSync(moduleJsonPath)) {
          try {
            const moduleInfo = JSON.parse(fs.readFileSync(moduleJsonPath, 'utf8'));
            modules.push({
              name: entry.name,
              path: modulePath,
              info: moduleInfo
            });
          } catch (error) {
            console.error(`Fehler beim Laden von Modul ${entry.name}:`, error);
          }
        }
      }
    }

    return modules;
  }

  loadModule(moduleName, config = {}) {
    if (this.loadedModules.has(moduleName)) {
      return this.loadedModules.get(moduleName);
    }

    const modules = this.scanModules();
    const module = modules.find(m => m.name === moduleName);

    if (!module) {
      throw new Error(`Modul ${moduleName} nicht gefunden`);
    }

    const moduleIndexPath = path.join(module.path, 'index.js');
    
    if (!fs.existsSync(moduleIndexPath)) {
      throw new Error(`Modul ${moduleName} hat keine index.js`);
    }

    // Lade Modul-Klasse
    delete require.cache[require.resolve(moduleIndexPath)];
    const ModuleClass = require(moduleIndexPath);
    
    const moduleInstance = new ModuleClass(config);
    this.loadedModules.set(moduleName, {
      instance: moduleInstance,
      info: module.info,
      path: module.path
    });

    return this.loadedModules.get(moduleName);
  }

  getModuleStyles(moduleName) {
    const module = this.loadedModules.get(moduleName);
    if (!module) return '';

    const stylesPath = path.join(module.path, 'styles.css');
    if (fs.existsSync(stylesPath)) {
      return fs.readFileSync(stylesPath, 'utf8');
    }

    return '';
  }

  getAllLoadedModules() {
    return Array.from(this.loadedModules.entries()).map(([name, data]) => ({
      name,
      info: data.info,
      instance: data.instance
    }));
  }

  /**
   * Lädt das Backend-Modul eines Moduls (falls vorhanden)
   * @param {string} moduleName - Name des Moduls
   * @returns {object|null} - Backend-Modul mit routes-Array oder null
   */
  loadBackendModule(moduleName) {
    const modules = this.scanModules();
    const module = modules.find(m => m.name === moduleName);

    if (!module) {
      return null;
    }

    const backendPath = path.join(module.path, 'backend.js');
    
    if (!fs.existsSync(backendPath)) {
      return null; // Kein Backend-Modul vorhanden
    }

    try {
      // Lade Backend-Modul
      delete require.cache[require.resolve(backendPath)];
      const backendModule = require(backendPath);
      
      console.log(`Backend-Modul ${moduleName} geladen`);
      return backendModule;
    } catch (error) {
      console.error(`Fehler beim Laden des Backend-Moduls ${moduleName}:`, error);
      return null;
    }
  }

  /**
   * Registriert alle API-Routen für alle Module mit Backend
   * @param {object} app - Express App
   * @param {object} context - Context-Objekt mit instanceName, ConfigManager, etc.
   */
  registerBackendRoutes(app, context) {
    const modules = this.scanModules();
    let routesRegistered = 0;

    for (const module of modules) {
      const backend = this.loadBackendModule(module.name);
      
      if (!backend) continue;

      // Neue Variante: registerRoutes Funktion
      if (typeof backend.registerRoutes === 'function') {
        try {
          backend.registerRoutes(app, context);
          console.log(`  [${module.name}] Backend-Routen registriert (via registerRoutes)`);
          routesRegistered++;
        } catch (error) {
          console.error(`Fehler beim Registrieren der Backend-Routen für ${module.name}:`, error);
        }
        continue;
      }

      // Alte Variante: routes Array
      if (backend.routes && Array.isArray(backend.routes)) {
        for (const route of backend.routes) {
          const { method, path, handler } = route;
          
          if (!method || !path || !handler) {
            console.warn(`Ungültige Route in Modul ${module.name}:`, route);
            continue;
          }

          // Registriere Route mit Context
          const wrappedHandler = (req, res) => handler(req, res, context);
          
          switch (method.toUpperCase()) {
            case 'GET':
              app.get(path, wrappedHandler);
              break;
            case 'POST':
              app.post(path, wrappedHandler);
              break;
            case 'PUT':
              app.put(path, wrappedHandler);
              break;
            case 'DELETE':
              app.delete(path, wrappedHandler);
              break;
            default:
              console.warn(`Unbekannte HTTP-Methode ${method} für Route ${path} in Modul ${module.name}`);
              continue;
          }

          console.log(`  [${module.name}] ${method.toUpperCase()} ${path}`);
          routesRegistered++;
        }
      }
    }

    if (routesRegistered > 0) {
      console.log(`${routesRegistered} Backend-Routen von Modulen registriert`);
    }
  }
}

module.exports = ModuleLoader;
