// ESLint Flat Config.
//
// Bewusst schlank gehalten: die Regeln sollen echte Fehler finden
// (Tippfehler in Variablennamen, doppelte Deklarationen, verschluckte
// Zuweisungen), nicht den Stil vorschreiben. Formatierung ist hier kein
// Fehlerfall - dafuer waere Prettier zustaendig.
import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  WebSocket: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Image: 'readonly',
  Audio: 'readonly',
  getComputedStyle: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  crypto: 'readonly',
  CSS: 'readonly',
  FormData: 'readonly',
  btoa: 'readonly',
  atob: 'readonly',
  AbortController: 'readonly',
  Sortable: 'readonly'
};

// Die Web-UI besteht aus mehreren klassischen <script>-Dateien, die sich
// Funktionen ueber den globalen Scope teilen. Fuer ESLint sind das Globals.
const webuiSharedGlobals = {
  t: 'readonly',
  setLanguage: 'readonly',
  currentLanguage: 'readonly',
  getPositionName: 'readonly',
  getCurrentLanguage: 'readonly',
  translations: 'readonly'
};

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  global: 'writable',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  btoa: 'readonly',
  atob: 'readonly'
};

const rules = {
  ...js.configs.recommended.rules,
  // Ungenutzte Variablen sind ein Hinweis, kein Fehler - und Argumente mit
  // fuehrendem Unterstrich sind bewusst ungenutzt.
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Das faengt "if (x = 1)" - eine der wenigen Verwechslungen, die still
  // falsches Verhalten erzeugen.
  'no-cond-assign': ['error', 'always'],
  'no-constant-condition': ['error', { checkLoops: false }]
};

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'logs/**', 'src/webui/public/vendor/**']
  },
  {
    // Tests richten sich per installDom() eine Renderer-Umgebung ein und
    // benutzen danach document und window wie im Browser.
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...nodeGlobals,
        document: 'readonly',
        window: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        WebSocket: 'readonly'
      }
    },
    rules
  },
  {
    files: ['src/main/**/*.js', 'modules/**/backend.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: nodeGlobals
    },
    rules
  },
  {
    // Renderer und Web-UI laufen im Browser, werden aber teils auch in Node
    // geladen (Modul-Klassen haben einen CommonJS-Fallback).
    files: ['src/renderer/**/*.js', 'src/preload.js', 'modules/**/index.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...browserGlobals, ...nodeGlobals }
    },
    rules
  },
  {
    // Ein Service Worker laeuft in einem eigenen globalen Scope - weder
    // window noch document existieren dort.
    files: ['src/webui/public/sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly'
      }
    },
    rules
  },
  {
    // i18n.js deklariert die geteilten Globals - dort duerfen sie nicht
    // zusaetzlich als vordefiniert gelten, sonst meldet ESLint no-redeclare.
    files: ['src/webui/public/i18n.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals
    },
    rules
  },
  {
    files: ['src/webui/**/*.js'],
    ignores: ['src/webui/public/i18n.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...browserGlobals, ...webuiSharedGlobals }
    },
    rules
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: nodeGlobals
    },
    rules
  }
];
