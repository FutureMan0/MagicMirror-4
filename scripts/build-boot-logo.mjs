#!/usr/bin/env node
/**
 * Erzeugt das Bootlogo - in der Drehung der Anzeige.
 *
 * Warum die Drehung ins Bild und nicht in den Framebuffer: der Spiegel dreht
 * seinen Inhalt per CSS (siehe src/renderer/renderer.js). Wäre der Framebuffer
 * bereits gedreht, käme diese Drehung ein zweites Mal obendrauf und der
 * Spiegel stünde quer. Das Bootlogo muss deshalb selbst gedreht sein: liegender
 * Bildspeicher, aufrechtes Bild darin.
 *
 *   npm run logo:build                          # Drehung aus display1.json
 *   node scripts/build-boot-logo.mjs --rotate 90 --out /pfad/logo.png
 *   node scripts/build-boot-logo.mjs --input mein-logo.png
 *
 * Ohne --input entsteht dasselbe Motiv wie auf den App-Icons. Mit --input wird
 * ein mitgebrachtes PNG gelesen und nur gedreht - damit lässt sich ein eigenes
 * Logo einsetzen, ohne dass hier eine Bildbibliothek dazukommt.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Canvas, encodePng, decodePng, rotiere } from './lib/png.mjs';
import { drawIcon, ACCENT } from './lib/motiv.mjs';
import { zeichneText, textBreite, hoeheFuerBreite } from './lib/schrift.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function argument(name, rueckfall = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : rueckfall;
}

/**
 * Die Drehung dieser Anzeige.
 *
 * Aus derselben Datei, aus der sie auch der Spiegel liest - sonst zeigte der
 * Startbildschirm in eine andere Richtung als das, was danach kommt.
 */
async function drehungAusKonfiguration(instanz) {
  const kandidaten = [
    path.join(ROOT, 'config/instances', `${instanz}.json`),
    path.join(ROOT, 'config/config.json')
  ];

  for (const datei of kandidaten) {
    try {
      const config = JSON.parse(await readFile(datei, 'utf8'));
      const grad = Number(config?.display?.rotation);
      if ([0, 90, 180, 270].includes(grad)) return grad;
    } catch {
      // Keine Datei, kaputtes JSON, kein Eintrag: der nächste Kandidat.
    }
  }

  return 0;
}

/** Ein fertiges Bild in ein groesseres einsetzen. */
function setzeEin(ziel, quelle, x, y) {
  for (let sy = 0; sy < quelle.height; sy += 1) {
    for (let sx = 0; sx < quelle.width; sx += 1) {
      const i = (sy * quelle.width + sx) * 4;
      const a = quelle.data[i + 3];
      if (!a) continue;
      ziel.blend(x + sx, y + sy, [quelle.data[i], quelle.data[i + 1], quelle.data[i + 2], a]);
    }
  }
}

/**
 * Das Bootlogo: die Spiegelmarke und darunter der Schriftzug.
 *
 * Dieselbe Marke wie auf den App-Icons - erkennt man sie beim Hochfahren
 * wieder, weiss man, dass das Geraet das Richtige tut, bevor sonst irgendetwas
 * zu sehen ist.
 *
 * Der Schriftzug entsteht dreifach ueberabgetastet und wird dann verkleinert;
 * die Marke bringt ihre Glaettung schon mit.
 */
function bauLogo(breite) {
  const SS = 3;
  const hoehe = Math.round(breite * 0.56);
  const logo = new Canvas(breite, hoehe);

  const markeHoehe = Math.round(hoehe * 0.62);
  const marke = drawIcon(markeHoehe, { padding: 0.06, background: false });
  setzeEin(logo, marke, Math.round((breite - markeHoehe) / 2), Math.round(hoehe * 0.03));

  // Mit Leerzeichen: in Grossbuchstaben liefen "MAGIC" und "MIRROR" sonst zu
  // einem Wort zusammen.
  const text = 'MAGIC MIRROR4 OS';
  // Die Vier hochgestellt - MagicMirror⁴ schreibt sich so.
  const hochgestellt = new Set([text.indexOf('4')]);

  const SPERRUNG = 0.16;
  // Die Groesse aus dem Platz rechnen und nicht umgekehrt: bei fester Groesse
  // lief der Schriftzug ueber den Rand. 84 % der Breite lassen links und
  // rechts Luft.
  const schrift = Math.min(
    Math.round(hoehe * 0.17),
    Math.floor(hoeheFuerBreite(text, breite * 0.88, SPERRUNG))
  );

  const zeile = new Canvas(breite * SS, Math.round(schrift * 1.7) * SS);
  const breiteText = textBreite(text, schrift * SS, SPERRUNG);

  zeichneText(zeile, text, {
    x: Math.round((breite * SS - breiteText) / 2),
    y: 0,
    hoehe: schrift * SS,
    dicke: Math.max(2, schrift * SS * 0.15),
    farbe: ACCENT,
    sperrung: SPERRUNG,
    hochgestellt
  });

  setzeEin(logo, zeile.downsample(SS), 0, Math.round(hoehe * 0.72));

  return logo;
}

const instanz = argument('instance', 'display1');
const grad = Number(argument('rotate', await drehungAusKonfiguration(instanz)));
const groesse = Number(argument('size', '900'));
const eingabe = argument('input');
const ziel = path.resolve(ROOT, argument('out', 'assets/boot/boot-logo.png'));

if (![0, 90, 180, 270].includes(grad)) {
  console.error(`Drehung muss 0, 90, 180 oder 270 sein - nicht "${grad}".`);
  process.exit(1);
}

const ohneText = process.argv.includes('--ohne-text');

let bild;
if (eingabe) {
  bild = decodePng(await readFile(path.resolve(process.cwd(), eingabe)));
} else if (ohneText) {
  // Nur die Marke, ohne Schriftzug. Ohne eigenen Hintergrund: den malt
  // Plymouth, und zwar in derselben Farbe - ein zweiter dunkler Kasten darauf
  // hätte nur sichtbare Kanten.
  bild = drawIcon(groesse, { padding: 0.18, background: false });
} else {
  bild = bauLogo(groesse);
}

const gedreht = rotiere(bild, grad);

await mkdir(path.dirname(ziel), { recursive: true });
await writeFile(ziel, encodePng(gedreht));

const quelle = eingabe ? path.basename(eingabe) : 'MagicMirror⁴';
console.log(`${quelle} → ${ziel} (${gedreht.width}x${gedreht.height}, ${grad}°)`);
