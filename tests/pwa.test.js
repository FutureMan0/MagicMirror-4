const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'src/webui/public');

const read = (relative) => fs.readFileSync(path.join(PUBLIC, relative), 'utf8');

test('das Manifest ist gültig und vollständig', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));

  assert.equal(manifest.display, 'standalone', 'sonst startet es mit Browser-Leiste');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.start_url.startsWith('/'));
  assert.equal(manifest.scope, '/');

  // Android braucht ein maskable Icon, sonst legt es das normale in einen
  // weissen Kreis - das sieht aus wie ein Fehler.
  const purposes = manifest.icons.map(icon => icon.purpose);
  assert.ok(purposes.includes('maskable'), 'kein maskable Icon');
  assert.ok(purposes.includes('any'), 'kein normales Icon');

  const sizes = manifest.icons.map(icon => icon.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
});

test('alle im Manifest genannten Dateien existieren', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const referenced = [
    ...manifest.icons.map(icon => icon.src),
    ...(manifest.shortcuts || []).flatMap(s => (s.icons || []).map(icon => icon.src))
  ];

  for (const src of new Set(referenced)) {
    assert.ok(
      fs.existsSync(path.join(PUBLIC, src)),
      `${src} ist im Manifest genannt, existiert aber nicht`
    );
  }
});

// Ein PNG mit falschem Kopf wird stillschweigend nicht angezeigt.
test('die Icons sind echte PNGs mit der angegebenen Grösse', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));

  for (const icon of manifest.icons) {
    const buffer = fs.readFileSync(path.join(PUBLIC, icon.src));

    assert.deepEqual(
      [...buffer.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${icon.src}: keine PNG-Signatur`
    );

    // IHDR beginnt bei Byte 16: Breite und Höhe als 32-Bit-Werte.
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const [expectedW, expectedH] = icon.sizes.split('x').map(Number);

    assert.equal(width, expectedW, `${icon.src}: Breite stimmt nicht`);
    assert.equal(height, expectedH, `${icon.src}: Höhe stimmt nicht`);

    // Das Bild darf nicht vollständig leer sein.
    assert.ok(buffer.length > 300, `${icon.src} ist verdächtig klein`);
  }
});

test('die Icons lassen sich dekodieren und sind nicht leer', () => {
  const buffer = fs.readFileSync(path.join(PUBLIC, 'icons/icon-192.png'));

  // IDAT-Blöcke einsammeln und entpacken.
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const size = 192;
  assert.equal(raw.length, size * (size * 4 + 1), 'unerwartete Bildgrösse nach dem Entpacken');

  // Mindestens ein Pixel muss deckend sein, sonst ist das Icon unsichtbar.
  let opaque = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (raw[y * (size * 4 + 1) + 1 + x * 4 + 3] > 200) opaque += 1;
    }
  }

  assert.ok(opaque > size * size * 0.5, `nur ${opaque} deckende Pixel - das Icon ist zu leer`);
});

// Der wichtigste Punkt am ganzen Service Worker: ein zwischengespeicherter
// Konfigurationsstand waere schlimmer als gar keine Offline-Faehigkeit. Man
// saehe einen Zustand, den es nicht mehr gibt - und schriebe ihn womoeglich
// zurueck.
test('der Service Worker fasst /api/ nicht an', () => {
  const sw = read('sw.js');

  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  assert.match(
    fetchHandler,
    /pathname\.startsWith\('\/api\/'\)\)\s*return;/,
    'API-Anfragen werden nicht ausgenommen'
  );

  // Und die Ausnahme muss VOR jeder Zwischenspeicherung stehen.
  const apiCheck = fetchHandler.indexOf("startsWith('/api/')");
  const firstRespond = fetchHandler.indexOf('respondWith');
  assert.ok(apiCheck > -1 && firstRespond > -1);
  assert.ok(apiCheck < firstRespond, 'die API-Ausnahme steht zu spät');
});

test('der Service Worker übernimmt nicht ungefragt', () => {
  const sw = read('sw.js');
  const installHandler = sw.slice(
    sw.indexOf("addEventListener('install'"),
    sw.indexOf("addEventListener('activate'")
  );

  assert.doesNotMatch(
    installHandler, /skipWaiting\(\)/,
    'ein Wechsel mitten in einer offenen Bearbeitung würde sie verwerfen'
  );
  assert.match(sw, /SKIP_WAITING/, 'es gibt keinen Weg, bewusst zu übernehmen');
});

test('jede zwischengespeicherte Datei existiert auch', () => {
  const sw = read('sw.js');
  const list = sw.slice(sw.indexOf('SHELL_ASSETS = ['), sw.indexOf('];', sw.indexOf('SHELL_ASSETS = [')));

  for (const match of list.matchAll(/'([^']+)'/g)) {
    const asset = match[1];
    if (asset === '/') continue;

    assert.ok(
      fs.existsSync(path.join(PUBLIC, asset.replace(/^\//, ''))),
      `${asset} steht in SHELL_ASSETS, existiert aber nicht - der Zwischenspeicher bliebe lückenhaft`
    );
  }
});

// Eine App, die ohne Internet laufen soll, darf kein Skript von ausserhalb
// nachladen.
test('nichts wird von einem fremden Server geladen', () => {
  const html = read('index.html');

  assert.doesNotMatch(html, /src="https?:\/\//, 'externes Skript im HTML');
  assert.doesNotMatch(html, /href="https?:\/\/[^"]*\.css/, 'externes Stylesheet im HTML');
  assert.ok(fs.existsSync(path.join(PUBLIC, 'vendor/Sortable.min.js')), 'Sortable fehlt lokal');
});

test('die Angaben für randlose Displays und iOS stimmen', () => {
  const html = read('index.html');

  // Ohne viewport-fit=cover liefert env(safe-area-inset-*) immer 0.
  assert.match(html, /viewport-fit=cover/);

  // Zoom zu verbieten ist eine Barriere - und iOS ignoriert es ohnehin.
  assert.doesNotMatch(html, /user-scalable=no/);
  assert.doesNotMatch(html, /maximum-scale=1/);

  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /rel="manifest"/);
});

test('die sicheren Bereiche werden tatsächlich benutzt', () => {
  const css = read('mobile.css');

  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /100dvh/, 'ohne dvh liegt der untere Rand auf iOS ausserhalb');
});
