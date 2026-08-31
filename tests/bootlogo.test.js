// Bootlogo und Startdateien auf dem Pi.
//
// Gedreht wird das BILD, nicht der Framebuffer. Ein per video=...,rotate=
// gedrehter Framebuffer würde auch X drehen - und der Spiegel dreht danach
// noch einmal per CSS. Er stünde quer, und zwar erst an der Wand sichtbar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const png = () => import('../scripts/lib/png.mjs');

/** Ein kleines Bild mit unterscheidbaren Ecken. */
async function probe(breite = 4, hoehe = 3) {
  const { Canvas } = await png();
  const bild = new Canvas(breite, hoehe);
  for (let y = 0; y < hoehe; y += 1) {
    for (let x = 0; x < breite; x += 1) {
      const i = (y * breite + x) * 4;
      bild.data[i] = x * 40;
      bild.data[i + 1] = y * 40;
      bild.data[i + 2] = (x + y) * 20;
      bild.data[i + 3] = 255;
    }
  }
  return bild;
}

test('viermal 90 Grad ergibt wieder das Ausgangsbild', async () => {
  const { rotiere } = await png();
  const start = await probe();

  let bild = start;
  for (let i = 0; i < 4; i += 1) bild = rotiere(bild, 90);

  assert.equal(bild.width, start.width);
  assert.equal(bild.height, start.height);
  assert.deepEqual([...bild.data], [...start.data], 'die Drehung verliert oder verschiebt Pixel');
});

test('bei 90 und 270 Grad tauschen Breite und Höhe', async () => {
  const { rotiere } = await png();
  const start = await probe(4, 3);

  for (const grad of [90, 270]) {
    const gedreht = rotiere(start, grad);
    assert.equal(gedreht.width, 3, `${grad}°: die Breite folgt nicht der Höhe`);
    assert.equal(gedreht.height, 4, `${grad}°: die Höhe folgt nicht der Breite`);
  }

  const halb = rotiere(start, 180);
  assert.equal(halb.width, 4);
  assert.equal(halb.height, 3);
});

test('90 Grad dreht im Uhrzeigersinn - wie der Spiegel', async () => {
  const { rotiere } = await png();
  const start = await probe(4, 3);

  // Die linke obere Ecke muss nach rechts oben wandern. Andersherum stünde das
  // Logo auf dem Kopf, sobald das Panel hochkant hängt.
  const gedreht = rotiere(start, 90);
  const obenLinks = [...start.data.slice(0, 4)];
  const obenRechts = [...gedreht.data.slice((gedreht.width - 1) * 4, gedreht.width * 4)];

  assert.deepEqual(obenRechts, obenLinks);
});

test('geschriebene PNG lassen sich wieder lesen', async () => {
  const { encodePng, decodePng } = await png();
  const start = await probe(6, 5);

  const gelesen = decodePng(encodePng(start));

  assert.equal(gelesen.width, 6);
  assert.equal(gelesen.height, 5);
  assert.deepEqual([...gelesen.data], [...start.data]);
});

// Ein durcheinandergeratenes Bootlogo wäre schwer zu erklären - deshalb lieber
// eine klare Fehlermeldung als ein still falsch gelesenes Bild.
test('unlesbare Formate werden abgelehnt, nicht geraten', async () => {
  const { decodePng, rotiere } = await png();
  const bild = await probe();

  assert.throws(() => decodePng(Buffer.from('kein png')), /keine PNG-Datei/);
  assert.throws(() => rotiere(bild, 45), /Nur 0, 90, 180 und 270/);
});

test('die Drehung kommt aus derselben Datei wie beim Spiegel', () => {
  const quelle = lies('scripts/build-boot-logo.mjs');

  assert.match(quelle, /config\/instances/, 'die Instanzkonfiguration wird nicht gelesen');
  assert.match(quelle, /config\?\.display\?\.rotation/);
  assert.match(quelle, /\[0, 90, 180, 270\]\.includes\(grad\)/);
});

test('cmdline.txt bleibt eine Zeile und wird vorher gesichert', () => {
  const skript = lies('scripts/rpi/boot-splash.sh');

  // Eine zweite Zeile in cmdline.txt macht den Pi unbootbar.
  assert.match(skript, /tr -d '\\n' < "\$CMDLINE"/, 'die Zeile wird nicht zusammengezogen');
  assert.match(skript, /printf '%s\\n' "\$zeile" > "\$CMDLINE"/, 'geschrieben wird nicht genau eine Zeile');

  // Vor der ersten Änderung eine Sicherung - und --aus spielt sie zurück.
  assert.match(skript, /\[ -f "\$datei\.vor-mm4" \] \|\| cp "\$datei" "\$datei\.vor-mm4"/);
  assert.match(skript, /--aus/);
});

test('der Framebuffer wird nicht gedreht', () => {
  // Ohne Kommentarzeilen: der Kopf des Skripts erklärt gerade, warum es
  // video=...,rotate= NICHT benutzt - das darf hier nicht als Treffer zählen.
  const skript = lies('scripts/rpi/boot-splash.sh')
    .split('\n')
    .filter(zeile => !zeile.trim().startsWith('#'))
    .join('\n');

  // video=...,rotate= würde auch X drehen. Der Spiegel dreht danach per CSS
  // noch einmal - er stünde quer.
  assert.doesNotMatch(skript, /video=[^\s"]*rotate=/, 'hier wird der Framebuffer gedreht');
  assert.doesNotMatch(skript, /display_rotate/, 'display_rotate dreht den ganzen Bildspeicher');
});

test('der Installer richtet Bootlogo und WLAN-Band ein', () => {
  const installer = lies('rpi-install.sh');

  assert.match(installer, /scripts\/rpi\/boot-splash\.sh/);
  assert.match(installer, /scripts\/rpi\/wifi-24ghz\.sh/);

  // Beide dürfen die Installation nicht abbrechen: ein Spiegel ohne Bootlogo
  // ist ein Spiegel, ein abgebrochener Installer ist keiner.
  assert.match(installer, /if ! "\$INSTALL_DIR\/scripts\/rpi\/boot-splash\.sh"; then/);
  assert.match(installer, /if ! "\$INSTALL_DIR\/scripts\/rpi\/wifi-24ghz\.sh"; then/);
});

test('das WLAN-Band wird nicht mitten in der Installation umgeschaltet', () => {
  const skript = lies('scripts/rpi/wifi-24ghz.sh');

  // Läuft die Installation über SSH auf 5 GHz, risse ein sofortiges Umschalten
  // die Sitzung ab - mitten im Herunterladen.
  assert.doesNotMatch(skript, /nmcli connection up/, 'hier wird sofort neu verbunden');
  assert.match(skript, /802-11-wireless\.band bg/, 'das 2,4-GHz-Band wird nicht gesetzt');
  assert.match(skript, /freq_list=/, 'wpa_supplicant bleibt unbehandelt');
});
