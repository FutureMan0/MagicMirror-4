#!/usr/bin/env node
/**
 * Erzeugt die App-Icons.
 *
 * Bewusst ohne Bildbibliothek: `sharp` oder ImageMagick wären eine native
 * Abhängigkeit, die auf dem Pi übersetzt werden müsste - für etwas, das sich
 * praktisch nie ändert. Stattdessen wird hier direkt in einen Pixelpuffer
 * gezeichnet und mit `zlib` als PNG geschrieben; beides bringt Node mit.
 *
 * Gezeichnet wird vierfach überabgetastet und dann verkleinert - das ergibt
 * saubere Kanten ohne echte Kantenglättung.
 *
 *   npm run icons:build
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/webui/public/icons');

const SUPERSAMPLE = 4;

// Farben aus dem Token-Set (src/renderer/styles/tokens.css).
const BACKGROUND = [5, 8, 12, 255];
const ACCENT = [0, 212, 255, 255];
const GLASS = [255, 255, 255, 22];

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
  }

  blend(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const alpha = a / 255;
    const inv = 1 - alpha;

    this.data[i] = this.data[i] * inv + r * alpha;
    this.data[i + 1] = this.data[i + 1] * inv + g * alpha;
    this.data[i + 2] = this.data[i + 2] * inv + b * alpha;
    this.data[i + 3] = Math.max(this.data[i + 3], a);
  }

  /** Gefülltes Rechteck mit runden Ecken. */
  roundedRect(x, y, w, h, radius, color) {
    for (let py = Math.floor(y); py < y + h; py += 1) {
      for (let px = Math.floor(x); px < x + w; px += 1) {
        if (this.insideRounded(px + 0.5, py + 0.5, x, y, w, h, radius)) {
          this.blend(px, py, color);
        }
      }
    }
  }

  /** Rahmen mit runden Ecken - außen minus innen. */
  roundedFrame(x, y, w, h, radius, thickness, color) {
    for (let py = Math.floor(y); py < y + h; py += 1) {
      for (let px = Math.floor(x); px < x + w; px += 1) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        const outside = this.insideRounded(cx, cy, x, y, w, h, radius);
        const inside = this.insideRounded(
          cx, cy,
          x + thickness, y + thickness,
          w - thickness * 2, h - thickness * 2,
          Math.max(0, radius - thickness)
        );
        if (outside && !inside) this.blend(px, py, color);
      }
    }
  }

  insideRounded(px, py, x, y, w, h, radius) {
    if (px < x || py < y || px > x + w || py > y + h) return false;

    const left = x + radius;
    const right = x + w - radius;
    const top = y + radius;
    const bottom = y + h - radius;

    // Gerade Bereiche: alles innerhalb ist drin.
    if (px >= left && px <= right) return true;
    if (py >= top && py <= bottom) return true;

    // Ecken: Abstand zum jeweiligen Mittelpunkt.
    const cx = px < left ? left : right;
    const cy = py < top ? top : bottom;
    return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
  }

  /** Verkleinert per Mittelwert - das ist die Kantenglättung. */
  downsample(factor) {
    const size = this.size / factor;
    const out = new Canvas(size);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let r = 0, g = 0, b = 0, a = 0;

        for (let sy = 0; sy < factor; sy += 1) {
          for (let sx = 0; sx < factor; sx += 1) {
            const i = ((y * factor + sy) * this.size + (x * factor + sx)) * 4;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
            a += this.data[i + 3];
          }
        }

        const n = factor * factor;
        const i = (y * size + x) * 4;
        out.data[i] = r / n;
        out.data[i + 1] = g / n;
        out.data[i + 2] = b / n;
        out.data[i + 3] = a / n;
      }
    }

    return out;
  }
}

// --- PNG-Kodierung ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(canvas) {
  const { size, data } = canvas;

  // Jede Zeile bekommt ein Filter-Byte (0 = keine Filterung).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < size * 4; x += 1) {
      raw[offset++] = data[y * size * 4 + x];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;    // 8 Bit je Kanal
  header[9] = 6;    // RGBA
  header[10] = 0;   // Deflate
  header[11] = 0;   // Standardfilter
  header[12] = 0;   // nicht interlaced

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Das Motiv -------------------------------------------------------------

/**
 * Ein hochkant stehender Spiegel: dunkle Fläche, leuchtender Rahmen, ein
 * angedeuteter Lichtreflex.
 *
 * `padding` gibt den Anteil an, der frei bleibt. Maskable-Icons werden von
 * Android beschnitten, deshalb brauchen sie deutlich mehr Rand.
 */
function drawIcon(size, { padding, background = true }) {
  const scale = size * SUPERSAMPLE;
  const canvas = new Canvas(scale);

  if (background) {
    canvas.roundedRect(0, 0, scale, scale, scale * 0.22, BACKGROUND);
  }

  const inset = scale * padding;
  const usable = scale - inset * 2;

  const mirrorWidth = usable * 0.58;
  const mirrorHeight = usable;
  const mirrorX = inset + (usable - mirrorWidth) / 2;
  const mirrorY = inset;
  const radius = mirrorWidth * 0.46;
  const thickness = Math.max(scale * 0.035, 2);

  canvas.roundedRect(mirrorX, mirrorY, mirrorWidth, mirrorHeight, radius, GLASS);
  canvas.roundedFrame(mirrorX, mirrorY, mirrorWidth, mirrorHeight, radius, thickness, ACCENT);

  // Lichtreflex: ein schmaler Streifen im oberen Drittel.
  const glintWidth = mirrorWidth * 0.16;
  const glintHeight = mirrorHeight * 0.3;
  canvas.roundedRect(
    mirrorX + mirrorWidth * 0.22,
    mirrorY + mirrorHeight * 0.16,
    glintWidth,
    glintHeight,
    glintWidth / 2,
    [255, 255, 255, 60]
  );

  return canvas.downsample(SUPERSAMPLE);
}

// --- Erzeugen --------------------------------------------------------------

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
