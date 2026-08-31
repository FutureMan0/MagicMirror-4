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

import { encodePng, decodePng, rotiere } from './lib/png.mjs';
import { drawIcon } from './lib/motiv.mjs';

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

const instanz = argument('instance', 'display1');
const grad = Number(argument('rotate', await drehungAusKonfiguration(instanz)));
const groesse = Number(argument('size', '512'));
const eingabe = argument('input');
const ziel = path.resolve(ROOT, argument('out', 'assets/boot/boot-logo.png'));

if (![0, 90, 180, 270].includes(grad)) {
  console.error(`Drehung muss 0, 90, 180 oder 270 sein - nicht "${grad}".`);
  process.exit(1);
}

let bild;
if (eingabe) {
  bild = decodePng(await readFile(path.resolve(process.cwd(), eingabe)));
} else {
  // Ohne eigenen Hintergrund: den malt Plymouth, und zwar in derselben Farbe.
  // Ein zweiter dunkler Kasten darauf hätte nur sichtbare Kanten.
  bild = drawIcon(groesse, { padding: 0.18, background: false });
}

const gedreht = rotiere(bild, grad);

await mkdir(path.dirname(ziel), { recursive: true });
await writeFile(ziel, encodePng(gedreht));

const quelle = eingabe ? path.basename(eingabe) : 'MagicMirror⁴';
console.log(`${quelle} → ${ziel} (${gedreht.width}x${gedreht.height}, ${grad}°)`);
