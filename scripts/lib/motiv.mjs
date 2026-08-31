/**
 * Das Motiv: ein hochkant stehender Spiegel.
 *
 * Steht in einer eigenen Datei, weil es an zwei Stellen gebraucht wird - für
 * die App-Icons und für das Bootlogo. Beide sollen dasselbe zeigen: erkennt
 * man den Spiegel beim Hochfahren wieder, weiß man, dass das Gerät das
 * Richtige tut, bevor irgendetwas anderes zu sehen ist.
 */
import { Canvas } from './png.mjs';

const SUPERSAMPLE = 4;

// Farben aus dem Token-Set (src/renderer/styles/tokens.css).
export const BACKGROUND = [5, 8, 12, 255];
export const ACCENT = [0, 212, 255, 255];
export const GLASS = [255, 255, 255, 22];

/**
 * Dunkle Fläche, leuchtender Rahmen, ein angedeuteter Lichtreflex.
 *
 * Gezeichnet wird vierfach überabgetastet und dann verkleinert - das ergibt
 * saubere Kanten ohne echte Kantenglättung.
 *
 * `padding` gibt den Anteil an, der frei bleibt. Maskable-Icons werden von
 * Android beschnitten, deshalb brauchen sie deutlich mehr Rand.
 */
export function drawIcon(size, { padding, background = true }) {
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
