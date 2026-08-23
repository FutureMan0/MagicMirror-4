/**
 * Liest und normalisiert module.json.
 *
 * Wird von Haupt- und Renderer-Prozess gemeinsam benutzt, damit es genau eine
 * Auslegung des Manifests gibt.
 *
 * Der wichtigste Zusatz gegenüber v1 ist `secrets`. Vorher musste jedes Modul
 * mit einem API-Schlüssel an ZWEI Stellen im Kern eingetragen werden:
 * `sensitiveFieldsMapping` in configManager.js und ein switch in
 * renderer/moduleLoader.js. Ein Modul war damit nicht mehr "Ordner reinlegen".
 *
 *   "secrets": [
 *     { "key": "apiKey", "env": "OPENWEATHERMAP_API_KEY",
 *       "label": "OpenWeatherMap API Key", "exposeToRenderer": false }
 *   ]
 *
 * `exposeToRenderer: false` heißt, dass der Wert den Browser nie erreicht -
 * das Modul muss über sein Backend gehen.
 */

const VALID_CONFIG_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object']);

/** Erzeugt aus einem Modulnamen eine sinnvolle ENV-Variable. */
function defaultEnvName(moduleName, key) {
  const toUpper = (value) => value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()
    .replace(/^_+|_+$/g, '');

  return `${toUpper(moduleName)}_${toUpper(key)}`;
}

function normalizeSecrets(raw, moduleName) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => (typeof entry === 'string' ? { key: entry } : entry))
    .filter((entry) => entry && typeof entry.key === 'string' && entry.key)
    .map((entry) => ({
      key: entry.key,
      env: entry.env || defaultEnvName(moduleName, entry.key),
      label: entry.label || entry.key,
      // Standard ist "ja", damit bestehende Module (Wetter braucht den
      // Schlüssel im Browser) unverändert weiterlaufen.
      exposeToRenderer: entry.exposeToRenderer !== false
    }));
}

function normalizeConfigSchema(raw, moduleName, warn) {
  const schema = {};
  if (!raw || typeof raw !== 'object') return schema;

  for (const [key, field] of Object.entries(raw)) {
    if (!field || typeof field !== 'object') continue;

    if (field.type && !VALID_CONFIG_TYPES.has(field.type)) {
      warn(`${moduleName}.${key}: unbekannter Typ "${field.type}"`);
    }

    schema[key] = {
      type: VALID_CONFIG_TYPES.has(field.type) ? field.type : 'string',
      default: field.default,
      description: field.description || key,
      ...(field.min !== undefined ? { min: field.min } : {}),
      ...(field.max !== undefined ? { max: field.max } : {}),
      ...(field.options ? { options: field.options } : {})
    };
  }

  return schema;
}

/**
 * Bringt ein Manifest in eine feste Form - egal ob v1 oder v2.
 */
function normalizeManifest(raw, moduleName, { warn = () => {} } = {}) {
  const manifest = raw && typeof raw === 'object' ? raw : {};

  return {
    apiVersion: manifest.apiVersion === 2 ? 2 : 1,
    name: manifest.name || moduleName,
    displayName: manifest.displayName || manifest.name || moduleName,
    version: manifest.version || '0.0.0',
    description: manifest.description || '',
    author: manifest.author || '',

    entry: manifest.entry || 'index.js',
    styles: manifest.styles || 'styles.css',
    backend: manifest.backend || 'backend.js',

    hidden: manifest.hidden === true,
    singleton: manifest.singleton === true,
    headless: manifest.headless === true,

    secrets: normalizeSecrets(manifest.secrets, moduleName),
    provides: Array.isArray(manifest.provides) ? manifest.provides : [],
    consumes: Array.isArray(manifest.consumes) ? manifest.consumes : [],

    config: normalizeConfigSchema(manifest.config, moduleName, warn)
  };
}

/** Liefert die Standardwerte aus dem Config-Schema. */
function defaultsFromManifest(manifest) {
  const defaults = {};
  for (const [key, field] of Object.entries(manifest.config || {})) {
    if (field.default !== undefined) defaults[key] = field.default;
  }
  return defaults;
}

module.exports = { normalizeManifest, defaultsFromManifest, defaultEnvName };
