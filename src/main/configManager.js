const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { normalizeManifest } = require('../shared/manifest');
require('dotenv').config();

/**
 * Platzhalter für ein gesetztes, aber nicht ausgeliefertes Geheimnis.
 *
 * loadConfig({ redact: true }) ersetzt jeden sensiblen Wert dadurch, und
 * saveConfig() erkennt ihn wieder und lässt den gespeicherten Wert unberührt.
 * So kann die Web-UI eine Konfiguration laden, bearbeiten und zurückschreiben,
 * ohne dass das Passwort jemals den Pi verlässt.
 */
const SECRET_PLACEHOLDER = '__SET__';

class ConfigManager {
  constructor(instanceName = 'display1') {
    this.instanceName = instanceName;
    this.configPath = path.join(__dirname, '../../config');
    this.instanceConfigPath = path.join(this.configPath, 'instances', `${instanceName}.json`);
    this.mainConfigPath = path.join(this.configPath, 'config.json');
    this.envPath = path.join(__dirname, '../../.env');

    // Welche Felder als Geheimnis gelten, steht im module.json des jeweiligen
    // Moduls. Vorher stand hier eine feste Tabelle - ein neues Modul mit
    // API-Schlüssel musste dafür den Kern anfassen.
    this.modulesDir = path.join(__dirname, '../../modules');
    this._manifestCache = null;
  }

  /**
   * Liest die Manifeste aller Module ein. Innerhalb einer ConfigManager-
   * Instanz gecacht - loadConfig() wird pro Anfrage neu erzeugt, ein
   * dauerhafter Cache würde also nur veralten.
   */
  _manifests() {
    if (this._manifestCache) return this._manifestCache;

    const manifests = new Map();
    let entries = [];
    try {
      entries = fs.readdirSync(this.modulesDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.modulesDir, entry.name, 'module.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifests.set(entry.name, normalizeManifest(raw, entry.name));
      } catch (error) {
        console.error(`Manifest von ${entry.name} ist fehlerhaft:`, error.message);
      }
    }

    this._manifestCache = manifests;
    return manifests;
  }

  /** Geheimnis-Deklarationen eines Moduls. */
  _secretsOf(moduleName) {
    return this._manifests().get(moduleName)?.secrets || [];
  }

  /** Namen der als Geheimnis behandelten Felder - für die Web-UI. */
  getSecretFields(moduleName) {
    return this._secretsOf(moduleName).map((secret) => secret.key);
  }

  // Hilfsfunktion: Lese .env Datei als Key-Value Objekt
  _readEnvFile() {
    if (!fs.existsSync(this.envPath)) {
      return {};
    }
    const envContent = fs.readFileSync(this.envPath, 'utf8');
    const envVars = {};

    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
          envVars[key.trim()] = valueParts.join('=').trim();
        }
      }
    });

    return envVars;
  }

  // Hilfsfunktion: Schreibe .env Datei aus Key-Value Objekt
  _writeEnvFile(envVars) {
    const lines = [];

    // Lese existierende Datei um Kommentare und Struktur zu erhalten
    let existingContent = '';
    if (fs.existsSync(this.envPath)) {
      existingContent = fs.readFileSync(this.envPath, 'utf8');
    }

    const existingLines = existingContent.split('\n');
    const processedKeys = new Set();

    // Durchlaufe existierende Zeilen und aktualisiere Werte
    existingLines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        // Kommentare und Leerzeilen beibehalten
        lines.push(line);
      } else {
        const [key] = trimmed.split('=');
        const cleanKey = key.trim();
        if (Object.prototype.hasOwnProperty.call(envVars, cleanKey)) {
          lines.push(`${cleanKey}=${envVars[cleanKey]}`);
          processedKeys.add(cleanKey);
        } else {
          // Behalte Zeile bei, wenn Key nicht im Update-Set
          lines.push(line);
        }
      }
    });

    // Füge neue Keys hinzu, die noch nicht in der Datei waren
    Object.keys(envVars).forEach(key => {
      if (!processedKeys.has(key)) {
        lines.push(`${key}=${envVars[key]}`);
      }
    });

    fs.writeFileSync(this.envPath, lines.join('\n'));
  }

  /**
   * Zugangsdaten entfernen, die der Code nicht mehr benutzt.
   *
   * Beim Wechsel auf PKCE ist `clientSecret` überflüssig geworden — kein
   * Codepfad liest es mehr. Alte Konfigurationen tragen es aber weiter mit,
   * im Klartext, und `GET /api/config` lieferte es aus: es steht in keinem
   * Manifest als Geheimnis, wurde also nicht maskiert.
   *
   * Ein ungenutztes Geheimnis, das trotzdem ausgeliefert wird, ist der
   * schlechteste aller Fälle. Es fliegt hier raus, mit einem Hinweis — wer
   * es einmal so gespeichert hatte, sollte es bei Spotify widerrufen.
   */
  _entferneAltlasten(config) {
    const ALTLASTEN = { spotify: ['clientSecret'] };

    for (const eintrag of config.modules || []) {
      const wegzuwerfen = ALTLASTEN[eintrag.module] || [];

      for (const schluessel of wegzuwerfen) {
        if (eintrag.config && schluessel in eintrag.config) {
          delete eintrag.config[schluessel];
          console.warn(
            `${eintrag.module}: "${schluessel}" aus der Konfiguration entfernt - ` +
            'wird seit der Umstellung auf PKCE nicht mehr gebraucht. Lag im ' +
            'Klartext; am besten bei der Gegenstelle widerrufen.'
          );
        }
      }
    }
  }


  loadConfig({ redact = false } = {}) {
    let config = {};

    // Lade Haupt-Config
    if (fs.existsSync(this.mainConfigPath)) {
      config = JSON.parse(fs.readFileSync(this.mainConfigPath, 'utf8'));
    }

    // Überschreibe mit Instanz-spezifischer Config falls vorhanden
    if (fs.existsSync(this.instanceConfigPath)) {
      const instanceConfig = JSON.parse(fs.readFileSync(this.instanceConfigPath, 'utf8'));
      config = { ...config, ...instanceConfig };
    }

    this._entferneAltlasten(config);


    // Die .env-Werte, die Module über ihr Manifest deklariert haben.
    const envVars = {};
    for (const manifest of this._manifests().values()) {
      for (const secret of manifest.secrets) {
        if (process.env[secret.env] !== undefined) {
          envVars[secret.env] = process.env[secret.env];
        }
      }
    }

    // Der Renderer bekommt die Werte über IPC; in eine HTTP-Antwort gehören
    // sie nie.
    config.env = redact ? {} : envVars;

    // Jeder Modul-Eintrag bekommt eine feste Kennung.
    //
    // Ohne sie liesse sich beim Abgleich einer geaenderten Konfiguration nur
    // ueber den Array-Index vergleichen - und ein nach oben geschobenes Modul
    // saehe dann aus wie "alle ausgetauscht", also wuerde alles neu gebaut.
    if (config.modules) {
      for (const mod of config.modules) {
        if (!mod.id) mod.id = crypto.randomUUID();
      }
    }

    // Deklarierte Geheimnisse aus der .env in die Modul-Konfiguration
    // einsetzen. Vorher stand hier ein switch mit vier fest verdrahteten
    // Modulnamen.
    if (config.modules) {
      for (const mod of config.modules) {
        if (!mod.config) mod.config = {};

        for (const secret of this._secretsOf(mod.module)) {
          const value = process.env[secret.env];
          if (value !== undefined && value !== '') {
            mod.config[secret.key] = value;
          }
        }
      }
    }

    if (redact) {
      this.redactSecrets(config);
    }

    return config;
  }

  /**
   * Ersetzt jeden deklarierten sensiblen Wert durch den Platzhalter.
   * Leere Felder bleiben leer - die Web-UI muss "nicht gesetzt" von
   * "gesetzt, aber nicht sichtbar" unterscheiden können.
   */
  redactSecrets(config) {
    if (!config.modules) return config;

    for (const mod of config.modules) {
      if (!mod.config) continue;

      for (const secret of this._secretsOf(mod.module)) {
        const value = mod.config[secret.key];
        if (value !== undefined && value !== null && value !== '') {
          mod.config[secret.key] = SECRET_PLACEHOLDER;
        }
      }
    }

    return config;
  }

  /**
   * Die Konfiguration, wie sie der Renderer bekommen darf.
   *
   * Geheimnisse mit exposeToRenderer:false werden entfernt - das Modul muss
   * dafür über sein Backend gehen. Ein WebUntis-Passwort hat im Browser
   * nichts verloren.
   */
  loadConfigForRenderer() {
    const config = this.loadConfig();
    if (!config.modules) return config;

    for (const mod of config.modules) {
      if (!mod.config) continue;

      for (const secret of this._secretsOf(mod.module)) {
        if (!secret.exposeToRenderer) {
          delete mod.config[secret.key];
        }
      }
    }

    // config.env enthält alle Werte und wird vom Renderer nicht gebraucht -
    // die Module bekommen ihre Geheimnisse über mod.config.
    config.env = {};

    return config;
  }

  saveConfig(config) {
    // Lese aktuelle .env Werte
    const envVars = this._readEnvFile();

    // Erstelle eine Kopie der Config zum Bereinigen
    const cleanConfig = JSON.parse(JSON.stringify(config));

    // Durchlaufe Module und extrahiere sensible Felder
    if (cleanConfig.modules) {
      cleanConfig.modules = cleanConfig.modules.map(mod => {
        if (!mod.config) return mod;

        for (const secret of this._secretsOf(mod.module)) {
          const value = mod.config[secret.key];

          // Der Platzhalter bedeutet "unverändert lassen". Ohne diese
          // Behandlung würde die Web-UI beim ersten Speichern das echte
          // Geheimnis mit der Zeichenkette "__SET__" überschreiben.
          if (value === SECRET_PLACEHOLDER) {
            // nichts tun - bestehenden .env-Wert behalten
          } else if (value !== undefined && value !== null && value !== '') {
            envVars[secret.env] = value;
            console.log(`Speichere ${mod.module}.${secret.key} in .env als ${secret.env}`);
          }

          // Aus der Config entfernen - Geheimnisse leben in der .env.
          delete mod.config[secret.key];
        }

        return mod;
      });
    }

    // Entferne auch das env-Objekt aus der Config (wird nur zur Laufzeit hinzugefügt)
    delete cleanConfig.env;

    // Schreibe aktualisierte .env Datei
    this._writeEnvFile(envVars);

    // Lade .env neu, damit process.env aktualisiert wird
    require('dotenv').config({ path: this.envPath, override: true });
    console.log('.env Datei aktualisiert und neu geladen');

    // Speichere bereinigte Config in Instanz-Config
    const instanceDir = path.dirname(this.instanceConfigPath);
    if (!fs.existsSync(instanceDir)) {
      fs.mkdirSync(instanceDir, { recursive: true });
    }
    fs.writeFileSync(this.instanceConfigPath, JSON.stringify(cleanConfig, null, 2));
    console.log(`Config gespeichert in ${this.instanceConfigPath} (ohne sensible Daten)`);
  }

  getInstanceName() {
    return this.instanceName;
  }
}

module.exports = ConfigManager;
module.exports.SECRET_PLACEHOLDER = SECRET_PLACEHOLDER;
