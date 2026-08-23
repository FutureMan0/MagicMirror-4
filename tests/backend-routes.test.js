const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Die Backends oeffnen beim Registrieren Ports, Timer und serielle
// Schnittstellen und halten damit den Event-Loop offen. Deshalb laeuft das
// Einsammeln in einem eigenen Prozess.
function collect() {
  const output = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/collect-routes.js')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }
  );
  return JSON.parse(output);
}

const result = collect();

// Regressionstest fuer den Fehler, der den Sensor komplett stilllegte:
// backend.js suchte den Config-Eintrag ueber m.name, die Config benutzt aber
// m.module. Die Funktion kehrte deshalb zurueck, BEVOR eine einzige Route
// registriert wurde - das Frontend pollte dauerhaft einen 404.
test('mmWave-Backend registriert seine Routen', () => {
  const presence = result.routes.filter(route => route.includes('/api/presence/'));

  assert.ok(
    presence.length > 0,
    'keine /api/presence/* Route registriert - Config-Lookup vermutlich wieder kaputt'
  );
  assert.ok(presence.includes('GET /api/presence/status'));
});

test('beide Backend-Konventionen werden weiterhin unterstuetzt', () => {
  // untis nutzt die alte Form: module.exports = { routes: [...] }
  assert.ok(
    result.routes.includes('POST /api/untis/timetable'),
    'routes[]-Konvention (untis) nicht mehr unterstuetzt'
  );

  // spotify und mmwave nutzen registerRoutes(app, context)
  assert.ok(
    result.routes.includes('GET /api/spotify/auth-url'),
    'registerRoutes-Konvention (spotify) nicht mehr unterstuetzt'
  );
});

test('scanModules findet alle Modulordner mit Manifest', () => {
  assert.ok(result.modules.includes('clock'));
  assert.ok(result.modules.includes('weather'));
  assert.ok(result.modules.length >= 5);
});
