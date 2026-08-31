/**
 * Pixelpuffer und PNG - ohne Bildbibliothek.
 *
 * `sharp` oder ImageMagick wären eine native Abhängigkeit, die auf dem Pi
 * übersetzt werden müsste. Für Icons und ein Bootlogo, die sich praktisch nie
 * ändern, ist das der falsche Preis. Gezeichnet wird deshalb direkt in einen
 * Pixelpuffer, gelesen und geschrieben wird mit `zlib`; beides bringt Node mit.
 *
 * Benutzt von scripts/build-icons.mjs und scripts/build-boot-logo.mjs.
 */
import { deflateSync, inflateSync } from 'node:zlib';

export class Canvas {
  /** Nicht nur quadratisch: ein mitgebrachtes Bootlogo hat jedes Format. */
  constructor(width, height = width) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  blend(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
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
    const width = this.width / factor;
    const height = this.height / factor;
    const out = new Canvas(width, height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0, g = 0, b = 0, a = 0;

        for (let sy = 0; sy < factor; sy += 1) {
          for (let sx = 0; sx < factor; sx += 1) {
            const i = ((y * factor + sy) * this.width + (x * factor + sx)) * 4;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
            a += this.data[i + 3];
          }
        }

        const n = factor * factor;
        const i = (y * width + x) * 4;
        out.data[i] = r / n;
        out.data[i + 1] = g / n;
        out.data[i + 2] = b / n;
        out.data[i + 3] = a / n;
      }
    }

    return out;
  }
}

/**
 * Dreht im Uhrzeigersinn - dieselbe Richtung, in die auch der Renderer dreht.
 *
 * Der Bildspeicher bleibt liegend, gedreht wird das Bild darin: nur so steht
 * das Logo auf einem hochkant montierten Panel aufrecht, ohne dass dafür der
 * Framebuffer selbst gedreht werden muss. Ein gedrehter Framebuffer wäre die
 * eine Drehung zu viel - der Spiegel dreht danach noch einmal per CSS.
 */
export function rotiere(canvas, grad) {
  const winkel = ((Number(grad) % 360) + 360) % 360;
  if (winkel === 0) return canvas;
  if (![90, 180, 270].includes(winkel)) {
    throw new Error(`Nur 0, 90, 180 und 270 Grad - nicht ${grad}`);
  }

  const gedreht = winkel === 180;
  const out = new Canvas(
    gedreht ? canvas.width : canvas.height,
    gedreht ? canvas.height : canvas.width
  );

  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      let sx, sy;
      if (winkel === 90) {
        sx = y;
        sy = canvas.height - 1 - x;
      } else if (winkel === 180) {
        sx = canvas.width - 1 - x;
        sy = canvas.height - 1 - y;
      } else {
        sx = canvas.width - 1 - y;
        sy = x;
      }

      const ziel = (y * out.width + x) * 4;
      const quelle = (sy * canvas.width + sx) * 4;
      out.data[ziel] = canvas.data[quelle];
      out.data[ziel + 1] = canvas.data[quelle + 1];
      out.data[ziel + 2] = canvas.data[quelle + 2];
      out.data[ziel + 3] = canvas.data[quelle + 3];
    }
  }

  return out;
}

// --- PNG -------------------------------------------------------------------

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

const SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function encodePng(canvas) {
  const { width, height, data } = canvas;

  // Jede Zeile bekommt ein Filter-Byte (0 = keine Filterung).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < width * 4; x += 1) {
      raw[offset++] = data[y * width * 4 + x];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;    // 8 Bit je Kanal
  header[9] = 6;    // RGBA
  header[10] = 0;   // Deflate
  header[11] = 0;   // Standardfilter
  header[12] = 0;   // nicht interlaced

  return Buffer.concat([
    SIGNATUR,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Liest ein PNG - genug davon, um ein mitgebrachtes Logo drehen zu können.
 *
 * Unterstützt werden 8 Bit RGB und RGBA ohne Interlace. Das deckt ab, was
 * jedes Zeichenprogramm exportiert; alles Weitere (Palette, 16 Bit, Adam7)
 * wird ausdrücklich abgelehnt statt still falsch gelesen - ein
 * durcheinandergeratenes Bootlogo wäre schwer zu erklären.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATUR)) {
    throw new Error('Das ist keine PNG-Datei.');
  }

  let width = 0;
  let height = 0;
  let kanaele = 0;
  const teile = [];

  let pos = 8;
  while (pos < buffer.length) {
    const laenge = buffer.readUInt32BE(pos);
    const typ = buffer.subarray(pos + 4, pos + 8).toString('ascii');
    const daten = buffer.subarray(pos + 8, pos + 8 + laenge);
    pos += 12 + laenge;

    if (typ === 'IHDR') {
      width = daten.readUInt32BE(0);
      height = daten.readUInt32BE(4);
      const tiefe = daten[8];
      const farbtyp = daten[9];
      const interlace = daten[12];

      if (tiefe !== 8) throw new Error(`Nur 8 Bit je Kanal - nicht ${tiefe}.`);
      if (interlace !== 0) throw new Error('Interlaced PNG wird nicht gelesen.');
      if (farbtyp === 2) kanaele = 3;
      else if (farbtyp === 6) kanaele = 4;
      else throw new Error(`Nur RGB und RGBA - Farbtyp ${farbtyp} nicht.`);
    } else if (typ === 'IDAT') {
      teile.push(daten);
    } else if (typ === 'IEND') {
      break;
    }
  }

  if (!width || !height) throw new Error('Die Datei hat keinen IHDR-Block.');

  const roh = inflateSync(Buffer.concat(teile));
  const zeile = width * kanaele;
  const canvas = new Canvas(width, height);

  // Filter rückgängig machen. Die fünf Typen stehen in RFC 2083; sie beziehen
  // sich immer auf das Byte links (a), oben (b) und links-oben (c).
  const vorher = Buffer.alloc(zeile);
  const jetzt = Buffer.alloc(zeile);

  for (let y = 0; y < height; y += 1) {
    const start = y * (zeile + 1);
    const filter = roh[start];
    roh.copy(jetzt, 0, start + 1, start + 1 + zeile);

    for (let i = 0; i < zeile; i += 1) {
      const a = i >= kanaele ? jetzt[i - kanaele] : 0;
      const b = vorher[i];
      const c = i >= kanaele ? vorher[i - kanaele] : 0;

      let wert = jetzt[i];
      if (filter === 1) wert += a;
      else if (filter === 2) wert += b;
      else if (filter === 3) wert += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        wert += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) {
        throw new Error(`Unbekannter Zeilenfilter ${filter}.`);
      }

      jetzt[i] = wert & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const ziel = (y * width + x) * 4;
      const quelle = x * kanaele;
      canvas.data[ziel] = jetzt[quelle];
      canvas.data[ziel + 1] = jetzt[quelle + 1];
      canvas.data[ziel + 2] = jetzt[quelle + 2];
      canvas.data[ziel + 3] = kanaele === 4 ? jetzt[quelle + 3] : 255;
    }

    jetzt.copy(vorher);
  }

  return canvas;
}
