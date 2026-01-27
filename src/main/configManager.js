const fs = require('fs');
const path = require('path');
require('dotenv').config();

class ConfigManager {
  constructor(instanceName = 'display1') {
    this.instanceName = instanceName;
    this.configPath = path.join(__dirname, '../../config');
    this.instanceConfigPath = path.join(this.configPath, 'instances', `${instanceName}.json`);
    this.mainConfigPath = path.join(this.configPath, 'config.json');
    this.envPath = path.join(__dirname, '../../.env');

    // Mapping: Modul -> Feld -> .env Variable
    this.sensitiveFieldsMapping = {
      'weather': {
        'apiKey': 'OPENWEATHERMAP_API_KEY'
      },
      'spotify': {
        'clientId': 'SPOTIFY_CLIENT_ID',
        'clientSecret': 'SPOTIFY_CLIENT_SECRET'
      },
      'untis': {
        'server': 'UNTIS_SERVER',
        'username': 'UNTIS_USERNAME',
        'password': 'UNTIS_PASSWORD',
        'school': 'UNTIS_SCHOOL'
      },
      'presence': {
        'port': 'PRESENCE_SENSOR_PORT'
      }
    };
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
        if (envVars.hasOwnProperty(cleanKey)) {
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

  loadConfig() {
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

    // Lade .env Variablen
    const envVars = {
      openweathermapApiKey: process.env.OPENWEATHERMAP_API_KEY,
      spotifyClientId: process.env.SPOTIFY_CLIENT_ID,
      spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      untisServer: process.env.UNTIS_SERVER,
      untisUsername: process.env.UNTIS_USERNAME,
      untisPassword: process.env.UNTIS_PASSWORD,
      untisSchool: process.env.UNTIS_SCHOOL,
      presenceSensorPort: process.env.PRESENCE_SENSOR_PORT || 'COM3',
      presenceTimeout: parseInt(process.env.PRESENCE_TIMEOUT || '60000'),
      presenceDimTimeout: parseInt(process.env.PRESENCE_DIM_TIMEOUT || '300000')
    };

    config.env = envVars;

    // Merge .env Werte in Module-Config (wenn in config.json leer)
    if (config.modules) {
      config.modules = config.modules.map(mod => {
        if (!mod.config) mod.config = {};

        switch (mod.module) {
          case 'weather':
            if (envVars.openweathermapApiKey) {
              mod.config.apiKey = envVars.openweathermapApiKey;
            }
            break;
          case 'spotify':
            if (envVars.spotifyClientId) {
              mod.config.clientId = envVars.spotifyClientId;
            }
            if (envVars.spotifyClientSecret) {
              mod.config.clientSecret = envVars.spotifyClientSecret;
            }
            break;
          case 'untis':
            if (envVars.untisServer) {
              mod.config.server = envVars.untisServer;
            }
            if (envVars.untisUsername) {
              mod.config.username = envVars.untisUsername;
            }
            if (envVars.untisPassword) {
              mod.config.password = envVars.untisPassword;
            }
            if (envVars.untisSchool) {
              mod.config.school = envVars.untisSchool;
            }
            break;
          case 'presence':
            if (envVars.presenceSensorPort) {
              mod.config.port = envVars.presenceSensorPort;
            }
            break;
        }

        return mod;
      });
    }

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
        const moduleMapping = this.sensitiveFieldsMapping[mod.module];

        if (moduleMapping && mod.config) {
          // Für jedes sensible Feld
          Object.keys(moduleMapping).forEach(fieldName => {
            const envVarName = moduleMapping[fieldName];

            // Wenn das Feld einen Wert hat, speichere es in .env
            if (mod.config[fieldName] !== undefined && mod.config[fieldName] !== null && mod.config[fieldName] !== '') {
              envVars[envVarName] = mod.config[fieldName];
              console.log(`Speichere ${mod.module}.${fieldName} in .env als ${envVarName}`);
            }

            // Entferne das Feld aus der Config
            delete mod.config[fieldName];
          });
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
