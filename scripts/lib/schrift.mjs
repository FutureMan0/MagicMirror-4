/**
 * Ein Strichalphabet - gerade so viel, wie „MAGICMIRROR⁴ OS" braucht.
 *
 * Warum nicht die Projektschrift: die liegt als woff2 vor, und ein woff2 zu
 * lesen hiesse einen Schriftparser mitzubringen. Fuer neun verschiedene Zeichen
 * auf einem Bootlogo ist das der falsche Preis - dieselbe Ueberlegung wie bei
 * den Icons, die deshalb ohne Bildbibliothek entstehen.
 *
 * Jedes Zeichen ist eine Handvoll Linienzuege in einem Einheitsquadrat:
 * x von 0 (links) bis 1 (rechts), y von 0 (oben) bis 1 (unten). Gezeichnet
 * wird mit runden Enden ueber den Abstand zur Strecke - zusammen mit dem
 * vierfachen Ueberabtasten der Leinwand ergibt das saubere Kanten.
 */

/** Punkte auf einem Bogen. y zeigt nach unten, 0° ist rechts, 90° unten. */
function bogen(cx, cy, rx, ry, vonGrad, bisGrad, schritte = 28) {
  const punkte = [];
  for (let i = 0; i <= schritte; i += 1) {
    const grad = vonGrad + (bisGrad - vonGrad) * (i / schritte);
    const rad = (grad * Math.PI) / 180;
    punkte.push([cx + Math.cos(rad) * rx, cy + Math.sin(rad) * ry]);
  }
  return punkte;
}

// vorschub = Breite des Zeichens in Vielfachen der Zeilenhoehe.
const GLYPHEN = {
  M: { vorschub: 0.92, zuege: [[[0, 1], [0, 0], [0.5, 0.58], [1, 0], [1, 1]]] },
  A: {
    vorschub: 0.82,
    zuege: [
      [[0, 1], [0.5, 0], [1, 1]],
      [[0.19, 0.64], [0.81, 0.64]]
    ]
  },
  G: {
    vorschub: 0.84,
    zuege: [
      bogen(0.5, 0.5, 0.5, 0.5, 310, 50),
      [[1, 0.86], [1, 0.52], [0.58, 0.52]]
    ]
  },
  I: { vorschub: 0.26, zuege: [[[0.5, 0], [0.5, 1]]] },
  C: { vorschub: 0.8, zuege: [bogen(0.5, 0.5, 0.5, 0.5, 310, 50)] },
  R: {
    // Breiter als die uebrigen Buchstaben: der Bauch wird beim Normieren in
    // x gestaucht, und bei 0.78 sah er aus wie ein Knick statt wie ein Bogen.
    vorschub: 0.9,
    zuege: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.5, 0]],
      bogen(0.5, 0.29, 0.32, 0.29, 270, 90),
      [[0.5, 0.58], [0, 0.58]],
      [[0.42, 0.58], [1, 1]]
    ]
  },
  O: { vorschub: 0.88, zuege: [bogen(0.5, 0.5, 0.5, 0.5, 0, 360)] },
  S: {
    vorschub: 0.76,
    zuege: [[
      [0.94, 0.19], [0.78, 0.04], [0.34, 0.02], [0.08, 0.17], [0.1, 0.36],
      [0.5, 0.49], [0.9, 0.63], [0.92, 0.82], [0.66, 0.97], [0.22, 0.95], [0.06, 0.8]
    ]]
  },
  4: {
    vorschub: 0.82,
    zuege: [
      [[0.74, 0], [0.04, 0.71], [1, 0.71]],
      [[0.74, 0], [0.74, 1]]
    ]
  },
  ' ': { vorschub: 0.34, zuege: [] }
};

/** Eine Strecke mit runden Enden in den Puffer zeichnen. */
function strecke(canvas, x0, y0, x1, y1, dicke, farbe) {
  const r = dicke / 2;
  const links = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
  const rechts = Math.min(canvas.width - 1, Math.ceil(Math.max(x0, x1) + r + 1));
  const oben = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
  const unten = Math.min(canvas.height - 1, Math.ceil(Math.max(y0, y1) + r + 1));

  const dx = x1 - x0;
  const dy = y1 - y0;
  const laenge2 = dx * dx + dy * dy;

  for (let py = oben; py <= unten; py += 1) {
    for (let px = links; px <= rechts; px += 1) {
      const cx = px + 0.5;
      const cy = py + 0.5;

      // Fusspunkt auf der Strecke, auf [0,1] begrenzt - das ergibt die runden
      // Enden ganz von selbst.
      let t = laenge2 === 0 ? 0 : ((cx - x0) * dx + (cy - y0) * dy) / laenge2;
      t = Math.min(1, Math.max(0, t));

      const ax = x0 + dx * t - cx;
      const ay = y0 + dy * t - cy;
      if (ax * ax + ay * ay <= r * r) canvas.blend(px, py, farbe);
    }
  }
}

/**
 * Die x-Ausdehnung eines Zeichens, einmal beim Laden ausgerechnet.
 *
 * Die Zuege sind von Hand gezeichnet und nutzen ihr Einheitsquadrat
 * unterschiedlich weit aus - das M bis 1.0, das I nur einen Strich bei 0.5.
 * Ohne diese Normierung waere jedes Zeichen so breit wie das Quadrat und nur
 * so weit vorgeschoben wie sein Vorschub: die Buchstaben liefen ineinander.
 */
for (const glyph of Object.values(GLYPHEN)) {
  let min = Infinity;
  let max = -Infinity;
  for (const zug of glyph.zuege) {
    for (const [x] of zug) {
      if (x < min) min = x;
      if (x > max) max = x;
    }
  }
  glyph.min = Number.isFinite(min) ? min : 0;
  glyph.spanne = Number.isFinite(max) ? max - glyph.min : 0;
}

/** Die Breite eines Textes in Pixeln, ohne ihn zu zeichnen. */
export function textBreite(text, hoehe, sperrung = 0.1) {
  let breite = 0;
  for (const zeichen of [...text]) {
    const glyph = GLYPHEN[zeichen] || GLYPHEN[' '];
    breite += glyph.vorschub * hoehe + sperrung * hoehe;
  }
  return Math.max(0, breite - sperrung * hoehe);
}

/**
 * Die Zeilenhoehe, bei der ein Text genau in eine Breite passt.
 *
 * Der Schriftzug „MAGICMIRROR4 OS" ist fuenfzehn Zeichen lang; bei fester
 * Groesse lief er ueber den Rand und wurde links abgeschnitten. Besser die
 * Groesse aus dem Platz rechnen als den Text aus dem Bild.
 */
export function hoeheFuerBreite(text, breite, sperrung = 0.1) {
  const beiEins = textBreite(text, 1, sperrung);
  return beiEins > 0 ? breite / beiEins : 0;
}

/**
 * Text zeichnen. `x`/`y` ist die linke obere Ecke der Zeile.
 *
 * `hochgestellt` nennt die Zeichen, die kleiner und angehoben gesetzt werden -
 * fuer die Vier in MagicMirror⁴. Ein echtes ⁴ waere ein zehntes Zeichen im
 * Alphabet; so bleibt es bei neun.
 */
export function zeichneText(canvas, text, {
  x, y, hoehe, dicke, farbe, sperrung = 0.1, hochgestellt = new Set()
}) {
  let stift = x;

  [...text].forEach((zeichen, index) => {
    const glyph = GLYPHEN[zeichen] || GLYPHEN[' '];
    const hoch = hochgestellt.has(index);
    const h = hoch ? hoehe * 0.55 : hoehe;
    const oben = hoch ? y : y;

    // Auf die Zeichenbreite normieren: so ist der Vorschub wirklich die Breite
    // und die Sperrung wirklich der Abstand.
    const kasten = glyph.vorschub * h;
    const skala = glyph.spanne > 0 ? kasten / glyph.spanne : 0;
    const links = stift + (glyph.spanne > 0 ? 0 : kasten / 2);
    const abbild = (gx) => links + (gx - glyph.min) * skala;

    for (const zug of glyph.zuege) {
      for (let i = 0; i < zug.length - 1; i += 1) {
        strecke(
          canvas,
          abbild(zug[i][0]), oben + zug[i][1] * h,
          abbild(zug[i + 1][0]), oben + zug[i + 1][1] * h,
          hoch ? dicke * 0.8 : dicke,
          farbe
        );
      }
    }

    stift += kasten + sperrung * hoehe;
  });

  return stift - x;
}

export const ZEICHENSATZ = Object.keys(GLYPHEN);
