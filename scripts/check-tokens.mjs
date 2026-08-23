#!/usr/bin/env node
/**
 * Prüft, dass Modul-Stylesheets und Themes keine rohen Farbwerte enthalten.
 *
 * Der Grund: Ein Theme kann nur umfärben, was über Tokens läuft. Sobald ein
 * Modul `color: #00ff7f` schreibt, ist diese Stelle für jedes Theme
 * unerreichbar - und das fällt niemandem auf, weil im Standard-Theme alles
 * richtig aussieht. Ohne diesen Test verfällt die Token-Disziplin in einem
 * Monat wieder.
 *
 * Erlaubt bleiben:
 *   - Werte in themes/<name>/theme.css innerhalb von :root - dort werden die
 *     Tokens ja gerade definiert.
 *   - color-mix(...) auf Tokens.
 *   - Reines Schwarz und Weiß, wo es um Nicht-Farbe geht (z.B. der weiße
 *     Hintergrund hinter einem QR-Code, der sonst nicht scannbar wäre).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Rohe Farbwerte: Hex, rgb(), rgba(), hsl(), hsla().
const COLOR_LITERAL = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d)/;

const ALLOWED_EXACT = new Set(['#ffffff', '#fff', '#000000', '#000']);

async function collect(dir, filter, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

/** Zeilennummern, die innerhalb eines :root-Blocks liegen. */
function rootLines(css) {
  const inside = new Set();
  const lines = css.split('\n');
  let depth = 0;
  let inRoot = false;

  lines.forEach((line, index) => {
    if (!inRoot && /(^|\s|,)(:root|html\[data-[^\]]+\])\s*(,|\{)/.test(line)) {
      inRoot = true;
      depth = 0;
    }
    if (inRoot) {
      inside.add(index + 1);
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0 && line.includes('}')) inRoot = false;
    }
  });

  return inside;
}

const targets = [
  ...await collect(path.join(ROOT, 'modules'), (f) => f.endsWith('.css')),
  ...await collect(path.join(ROOT, 'themes'), (f) => f.endsWith('.css')),
  // Die gemeinsame Optik der Daten-Module unterliegt denselben Regeln.
  path.join(ROOT, 'src/renderer/styles/data-module.css')
];

const problems = [];

for (const file of targets) {
  const relative = path.relative(ROOT, file);
  const isTheme = relative.startsWith('themes' + path.sep);
  const raw = await readFile(file, 'utf8');
  const css = stripComments(raw);
  const declarationLines = isTheme ? rootLines(css) : new Set();

  css.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;
    // In einem Theme dürfen die Tokens selbst mit echten Farben belegt werden.
    if (declarationLines.has(lineNumber)) return;

    const withoutAllowed = line.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) =>
      ALLOWED_EXACT.has(hex.toLowerCase()) ? '' : hex
    );

    if (COLOR_LITERAL.test(withoutAllowed)) {
      problems.push({ file: relative, line: lineNumber, text: line.trim() });
    }
  });
}

if (problems.length > 0) {
  console.error('Rohe Farbwerte gefunden. Ein Theme kann diese Stellen nicht umfärben:\n');
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line}`);
    console.error(`    ${problem.text}`);
  }
  console.error('\nStattdessen ein Token benutzen (siehe src/renderer/styles/tokens.css),');
  console.error('oder color-mix(in srgb, var(--mm-...) N%, transparent) für Abstufungen.');
  process.exit(1);
}

console.log(`${targets.length} Stylesheets geprüft, keine rohen Farbwerte.`);
