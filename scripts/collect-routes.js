#!/usr/bin/env node
/**
 * Registriert alle Modul-Backends gegen ein Express-Attrappe und gibt die
 * entstandenen Routen als JSON aus.
 *
 * Läuft bewusst als eigener Prozess: die Backends öffnen beim Registrieren
 * Ports, Timer und serielle Schnittstellen und halten den Event-Loop offen.
 * Am Ende wird deshalb hart beendet.
 *
 * Nutzung:  node scripts/collect-routes.js
 */
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ModuleLoader = require(path.join(ROOT, 'src/main/moduleLoader.js'));
const ConfigManager = require(path.join(ROOT, 'src/main/configManager.js'));

const routes = [];
const record = (method) => (routePath) => {
  if (typeof routePath === 'string') routes.push(`${method} ${routePath}`);
};

const fakeApp = {
  get: record('GET'),
  post: record('POST'),
  put: record('PUT'),
  delete: record('DELETE'),
  use: () => {}
};

// Die Konsolenausgabe der Backends darf das JSON auf stdout nicht verunreinigen.
// Die Umleitung bleibt dauerhaft bestehen: die exit-Handler der Backends loggen
// beim Beenden noch einmal, und das wuerde sonst hinter dem JSON landen.
console.log = (...args) => console.error(...args);

const loader = new ModuleLoader(path.join(ROOT, 'modules'));
const modules = loader.scanModules().map(m => m.name);

loader.registerBackendRoutes(fakeApp, {
  instanceName: process.env.MM_TEST_INSTANCE || 'route-scan',
  ConfigManager,
  fetch: () => Promise.reject(new Error('Netzwerk in diesem Werkzeug nicht verfuegbar'))
});

process.stdout.write(JSON.stringify({ modules, routes: routes.sort() }, null, 2) + '\n');

// Backends halten Ports und Timer offen - hart beenden.
process.exit(0);
