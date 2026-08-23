#!/usr/bin/env node
/**
 * Lädt die Schriftschnitte von Google Fonts herunter, legt sie unter
 * src/renderer/assets/fonts/ ab und erzeugt src/renderer/styles/fonts.css.
 *
 * Läuft nicht automatisch: Schriften ändern sich selten, und das Ergebnis
 * ist eingecheckt. Bei Bedarf `npm run fonts:build`.
 *
 * Nur die Subsets latin und latin-ext - alles andere wäre totes Gewicht auf
 * einem Gerät, das nur deutsche und englische Texte anzeigt.
 */
import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.join(ROOT, 'src/renderer/assets/fonts');
const CSS_PATH = path.join(ROOT, 'src/renderer/styles/fonts.css');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const WANTED_SUBSETS = new Set(['latin', 'latin-ext']);

const FAMILIES = [
  // Sans - Grundschrift aller Themes.
  { query: 'Inter:wght@100..900', slug: 'inter' },
  // Display - Cyberpunk.
  { query: 'Rajdhani:wght@300;400;500;600;700', slug: 'rajdhani' },
  // Serif - Newspaper und Nature.
  { query: 'Source+Serif+4:opsz,wght@8..60,200..900', slug: 'source-serif-4' }
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// Google gliedert die Antwort in Blöcke mit vorangestelltem /* subset */.
function parseBlocks(css) {
  const blocks = [];
  const re = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/gi;
  for (const match of css.matchAll(re)) {
    blocks.push({ subset: match[1], body: match[2] });
  }
  return blocks;
}

function field(body, name) {
  return body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim() ?? null;
}

await mkdir(FONT_DIR, { recursive: true });

// Alte Dateien entfernen, sonst bleiben Schnitte liegen, die niemand mehr
// referenziert.
for (const file of await readdir(FONT_DIR)) {
  if (file.endsWith('.woff2')) await unlink(path.join(FONT_DIR, file));
}

const faces = [];

for (const family of FAMILIES) {
  const css = await fetchText(`https://fonts.googleapis.com/css2?family=${family.query}&display=swap`);
  const blocks = parseBlocks(css).filter(block => WANTED_SUBSETS.has(block.subset));

  if (blocks.length === 0) {
    throw new Error(`Keine passenden Subsets für ${family.query} gefunden`);
  }

  let index = 0;
  for (const block of blocks) {
    const url = block.body.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!url) continue;

    const weight = field(block.body, 'font-weight') || '400';
    const style = field(block.body, 'font-style') || 'normal';
    const familyName = (field(block.body, 'font-family') || '').replace(/['"]/g, '');
    const unicodeRange = field(block.body, 'unicode-range');

    const fileName = `${family.slug}-${block.subset}-${weight.replace(/\s+/g, '-')}-${style}-${index}.woff2`;

    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    await writeFile(path.join(FONT_DIR, fileName), bytes);

    faces.push({ familyName, weight, style, unicodeRange, fileName, subset: block.subset, size: bytes.length });
    index += 1;
  }
}

faces.sort((a, b) =>
  a.familyName.localeCompare(b.familyName)
  || (a.subset === b.subset ? 0 : a.subset === 'latin' ? -1 : 1)
  || String(a.weight).localeCompare(String(b.weight))
);

const totalKb = Math.round(faces.reduce((sum, face) => sum + face.size, 0) / 1024);

const header = `/*
 * Selbst gehostete Schriften.
 *
 * Vorher kamen Roboto über einen <link> und Rajdhani über ein @import in
 * themes/cyberpunk.css von Google. Beides ist ein Netzwerk-Roundtrip beim
 * Booten - auf einem Gerät, das zu diesem Zeitpunkt womöglich noch gar kein
 * Netz hat. Der Spiegel fiel dann stillschweigend auf eine Systemschrift
 * zurück, und das @import verzögerte zusätzlich das Theme.
 *
 * Nur die Subsets latin und latin-ext, insgesamt rund ${totalKb} KB.
 *
 * Lizenzen (alle SIL Open Font License 1.1, Weitergabe ausdrücklich erlaubt):
 *   Inter           - Rasmus Andersson
 *   Rajdhani        - Indian Type Foundry
 *   Source Serif 4  - Adobe
 * Siehe src/renderer/assets/fonts/LICENSE.md
 *
 * Erzeugt - nicht von Hand bearbeiten. Neu erzeugen mit:
 *   npm run fonts:build
 */

@layer base {
`;

const body = faces.map(face => `  @font-face {
    font-family: '${face.familyName}';
    font-style: ${face.style};
    font-weight: ${face.weight};
    font-display: swap;
    src: url('../assets/fonts/${face.fileName}') format('woff2');
    unicode-range: ${face.unicodeRange};
  }`).join('\n\n');

await writeFile(CSS_PATH, header + body + '\n}\n');

console.log(`${faces.length} Schnitte, ${totalKb} KB -> ${path.relative(ROOT, CSS_PATH)}`);
