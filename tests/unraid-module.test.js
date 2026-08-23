const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const unraid = require(path.join(ROOT, 'modules/unraid/backend.js'));

const { defaults, buildRequests, transform, testConnection } = unraid._definition;
const config = (extra = {}) => ({ ...defaults, ...extra });

const READY = { serverUrl: 'https://tower.local', apiKey: 'geheim' };

test('ohne Adresse oder Schlüssel wird nichts angefragt', () => {
  assert.deepEqual(buildRequests(config({ apiKey: 'x' })), []);
  assert.deepEqual(buildRequests(config({ serverUrl: 'https://tower.local' })), []);
  assert.deepEqual(buildRequests(config({ serverUrl: 'tower.local', apiKey: 'x' })), []);
});

test('der Schlüssel geht als x-api-key mit, nicht als Bearer', () => {
  const [request] = buildRequests(config(READY));

  assert.equal(request.headers['x-api-key'], 'geheim');
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.method, 'POST', 'GraphQL wird per POST angesprochen');
  assert.match(request.url, /\/graphql$/);
});

// Eine einzelne grosse Abfrage wuerde komplett scheitern, sobald ein Feld im
// Schema fehlt - GraphQL antwortet dann mit einem Fehler fuer die ganze
// Abfrage. Genau deshalb je Abschnitt eine eigene.
test('je Abschnitt wird eine eigene Abfrage gestellt', () => {
  const requests = buildRequests(config(READY));

  assert.equal(requests.length, 3, 'System, Array und Docker sind standardmässig an');
  const queries = requests.map(r => r.body.query);
  assert.equal(new Set(queries).size, 3, 'die Abfragen sind nicht verschieden');
});

test('abgeschaltete Abschnitte werden nicht abgefragt', () => {
  const requests = buildRequests(config({ ...READY, showDocker: false, showSystem: false }));
  assert.equal(requests.length, 1);
  assert.match(requests[0].body.query, /array/);
});

test('VMs werden nur auf Wunsch abgefragt', () => {
  assert.equal(buildRequests(config(READY)).length, 3);
  assert.equal(buildRequests(config({ ...READY, showVms: true })).length, 4);
});

test('Unraid läuft üblicherweise mit selbstsigniertem Zertifikat', () => {
  assert.equal(buildRequests(config(READY))[0].allowInsecureTls, true);
  assert.equal(
    buildRequests(config({ ...READY, allowInsecureTls: false }))[0].allowInsecureTls,
    false
  );
});

test('rechnet Kilobyte in verständliche Grössen um', () => {
  const result = transform([
    { data: { metrics: { cpu: { percentTotal: 12 }, memory: { percentTotal: 40, used: 4194304, total: 16777216 } } } },
    { data: { array: { state: 'STARTED', capacity: { kilobytes: { used: 1073741824, total: 2147483648 } }, disks: [] } } },
    { data: { docker: { containers: [] } } }
  ], config(READY));

  assert.equal(result.system.cpuPercent, 12);
  assert.equal(result.system.memoryUsedGb, 4);
  assert.equal(result.system.memoryTotalGb, 16);
  assert.equal(result.array.usedGb, 1024);
  assert.equal(Math.round(result.array.percent), 50);
});

// GraphQL liefert Fehler mit HTTP 200 - ohne diese Prüfung würde ein
// fehlendes Feld als "alles in Ordnung, aber leer" durchgehen.
test('ein fehlgeschlagener Abschnitt fehlt einzeln und wird benannt', () => {
  const result = transform([
    { data: { metrics: { cpu: { percentTotal: 5 }, memory: {} } } },
    { errors: [{ message: 'Cannot query field "parityCheckStatus"' }] },
    { data: { docker: { containers: [{ names: ['a'], state: 'running' }] } } }
  ], config(READY));

  assert.ok(result.system, 'System ist da');
  assert.equal(result.array, undefined, 'Array fehlt');
  assert.ok(result.docker, 'Docker ist da');

  assert.equal(result.unavailable.length, 1);
  assert.equal(result.unavailable[0].section, 'array');
  assert.match(result.unavailable[0].reason, /parityCheckStatus/);
});

test('eine ganz fehlende Antwort wird ebenfalls gemeldet', () => {
  const result = transform([null, undefined, {}], config(READY));
  assert.equal(result.unavailable.length, 3);
});

// Unraid liefert die Temperatur je nach Fassung als Zahl oder Zeichenkette,
// und bei schlafenden Platten gar nicht.
test('Plattentemperaturen werden robust gelesen', () => {
  const result = transform([
    { data: { metrics: {} } },
    {
      data: {
        array: {
          state: 'STARTED',
          capacity: { kilobytes: {} },
          disks: [
            { name: 'disk1', temp: 38, fsUsed: 50, fsSize: 100 },
            { name: 'disk2', temp: '42' },
            { name: 'disk3', temp: null },
            { name: 'disk4', temp: '*' }
          ]
        }
      }
    },
    { data: { docker: { containers: [] } } }
  ], config(READY));

  const disks = result.array.disks;
  assert.equal(disks[0].temp, 38);
  assert.equal(disks[1].temp, 42, 'eine Zeichenkette muss auch gehen');
  assert.equal(disks[2].temp, null, 'schlafende Platte - kein Fehler');
  assert.equal(disks[3].temp, null, 'unbrauchbarer Wert wird verworfen');
  assert.equal(Math.round(disks[0].percent), 50);
});

test('die Zahl der Platten wird begrenzt', () => {
  const disks = Array.from({ length: 30 }, (_, i) => ({ name: `disk${i}`, temp: 30 }));
  const result = transform([
    { data: { metrics: {} } },
    { data: { array: { state: 'STARTED', capacity: { kilobytes: {} }, disks } } },
    { data: { docker: { containers: [] } } }
  ], config({ ...READY, maxDisks: 4 }));

  assert.equal(result.array.disks.length, 4);
});

test('laufende Container werden gezählt', () => {
  const result = transform([
    { data: { metrics: {} } },
    { data: { array: { state: 'STARTED', capacity: { kilobytes: {} }, disks: [] } } },
    {
      data: {
        docker: {
          containers: [
            { names: ['a'], state: 'running' },
            { names: ['b'], state: 'RUNNING' },
            { names: ['c'], state: 'exited' }
          ]
        }
      }
    }
  ], config(READY));

  assert.equal(result.docker.total, 3);
  assert.equal(result.docker.running, 2, 'Gross- und Kleinschreibung müssen egal sein');
});

// Bei einem versionsabhaengigen Schema ist "welche Abschnitte gehen" die
// nuetzliche Auskunft - nicht "geht irgendwas".
test('der Verbindungstest nennt die verfügbaren Abschnitte', async () => {
  const request = async ({ body }) => {
    if (body.query.includes('vms')) {
      return { data: { errors: [{ message: 'Unknown type "VmDomain"' }] } };
    }
    return { data: { data: {} } };
  };

  const result = await testConnection(config(READY), request);

  assert.equal(result.ok, true);
  assert.ok(result.available.includes('array'));
  assert.ok(result.unavailable.some(u => u.section === 'vms'));
});

test('fehlende Angaben werden benannt, statt es zu versuchen', async () => {
  const never = async () => { throw new Error('darf nicht aufgerufen werden'); };

  assert.match((await testConnection(config({ apiKey: 'x' }), never)).error, /Adresse/);
  assert.match((await testConnection(config({ serverUrl: 'https://x' }), never)).error, /Schlüssel/);
});
