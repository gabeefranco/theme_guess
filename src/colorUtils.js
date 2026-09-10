// Color math: hex/rgb helpers, interpolation, and a perceptual (CIELAB)
// distance used to score how close a guessed color is to the real one.

export function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(full, 16) || 0;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function isValidHex(hex) {
  return /^#?[0-9a-f]{6}$/i.test(hex);
}

export function lerpRgb(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function srgbToLinear(c) {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function rgbToXyz({ r, g, b }) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return {
    x: R * 0.4124 + G * 0.3576 + B * 0.1805,
    y: R * 0.2126 + G * 0.7152 + B * 0.0722,
    z: R * 0.0193 + G * 0.1192 + B * 0.9505,
  };
}

const REF_WHITE = { x: 0.95047, y: 1.0, z: 1.08883 };

function xyzToLab({ x, y, z }) {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / REF_WHITE.x);
  const fy = f(y / REF_WHITE.y);
  const fz = f(z / REF_WHITE.z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function hexToLab(hex) {
  return xyzToLab(rgbToXyz(hexToRgb(hex)));
}

export function deltaE76(labA, labB) {
  return Math.sqrt((labA.l - labB.l) ** 2 + (labA.a - labB.a) ** 2 + (labA.b - labB.b) ** 2);
}

// 100 at identical colors, decaying smoothly as perceptual distance grows.
export function similarityFromHex(hexA, hexB) {
  const dE = deltaE76(hexToLab(hexA), hexToLab(hexB));
  const sim = 100 * Math.exp(-dE / 45);
  return Math.max(0, Math.min(100, sim));
}
