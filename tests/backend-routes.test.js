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

// Der Config-Lookup ueber m.module (nicht m.name) hatte frueher ein ganzes
// Backend stillgelegt, bevor auch nur eine Route entstand. Der Waechter bleibt
// - nur haengt er jetzt an einem Modul, das es noch gibt.
test('aktivierte Backends registrieren ihre Routen', () => {
  assert.ok(
    result.routes.length > 0,
    'gar keine Modul-Route registriert - Config-Lookup vermutlich wieder kaputt'
  );
});

test('beide Backend-Konventionen werden weiterhin unterstuetzt', () => {
  // untis nutzt die alte Form: module.exports = { routes: [...] }
  assert.ok(
    result.routes.includes('POST /api/untis/timetable'),
    'routes[]-Konvention (untis) nicht mehr unterstuetzt'
  );

  // spotify und die Forge-Module nutzen registerRoutes(app, context)
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
