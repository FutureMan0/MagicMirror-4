#!/usr/bin/env node
/**
 * Erzeugt die App-Icons.
 *
 * Pixelpuffer und PNG-Kodierung liegen in scripts/lib/png.mjs, das Motiv in
 * scripts/lib/motiv.mjs - dasselbe Motiv trägt auch das Bootlogo
 * (scripts/build-boot-logo.mjs).
 *
 *   npm run icons:build
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from './lib/png.mjs';
import { drawIcon } from './lib/motiv.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/webui/public/icons');

await mkdir(OUT, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, padding: 0.16 },
  { file: 'icon-512.png', size: 512, padding: 0.16 },
  // Android beschneidet maskable Icons bis auf einen Kreis - alles Wichtige
  // muss innerhalb von 80 % der Kantenlänge liegen.
  { file: 'maskable-192.png', size: 192, padding: 0.28 },
  { file: 'maskable-512.png', size: 512, padding: 0.28 },
  { file: 'apple-touch-icon-180.png', size: 180, padding: 0.16 },
  { file: 'favicon-32.png', size: 32, padding: 0.12 }
];

for (const target of targets) {
  const canvas = drawIcon(target.size, { padding: target.padding });
  await writeFile(path.join(OUT, target.file), encodePng(canvas));
  console.log(`${target.file} (${target.size}x${target.size})`);
}

console.log(`\n${targets.length} Icons in ${path.relative(ROOT, OUT)}`);
