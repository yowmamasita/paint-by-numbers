/**
 * Colour science helpers.
 *
 * The original implementation compared colours with plain Euclidean distance in
 * sRGB, which does not match human perception at all (it treats a 20-step change
 * in dark blue as equal to a 20-step change in bright yellow). Everything here
 * works in CIE L*a*b* and uses CIEDE2000 for distance instead.
 */

export interface Rgb {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export const hexToRgb = (hex: string): Rgb => {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
};

export const rgbToHex = (r: number, g: number, b: number): string =>
  '#' +
  [r, g, b]
    .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0'))
    .join('');

/** sRGB 0-1 -> linear-light 0-1. */
export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** Linear-light 0-1 -> sRGB 0-1. */
export const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

// D65 reference white.
const Xn = 0.95047;
const Yn = 1.0;
const Zn = 1.08883;

const labF = (t: number): number =>
  t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;

export const rgbToLab = ({ r, g, b }: Rgb): Lab => {
  const rl = srgbToLinear(r / 255);
  const gl = srgbToLinear(g / 255);
  const bl = srgbToLinear(b / 255);

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / Xn;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl) / Yn;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / Zn;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
};

export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex));

const deg = (rad: number): number => (rad * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;

/**
 * CIEDE2000 colour difference. Roughly: <1 is imperceptible, ~2-3 is a just
 * noticeable difference, >10 is obviously a different colour.
 */
export const deltaE2000 = (c1: Lab, c2: Lab): number => {
  const { L: L1, a: a1, b: b1 } = c1;
  const { L: L2, a: a2, b: b2 } = c2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625))); // 25^7

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 6103515625));

  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * Rc;

  const termL = dLp / SL;
  const termC = dCp / SC;
  const termH = dHp / SH;

  return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH);
};

/** WCAG relative luminance, for picking readable text over a swatch. */
export const relativeLuminance = ({ r, g, b }: Rgb): number =>
  0.2126 * srgbToLinear(r / 255) +
  0.7152 * srgbToLinear(g / 255) +
  0.0722 * srgbToLinear(b / 255);

/** Black or white, whichever is more readable on the given background. */
export const readableTextColor = (bg: Rgb): '#000000' | '#ffffff' => {
  const l = relativeLuminance(bg);
  const contrastWithWhite = 1.05 / (l + 0.05);
  const contrastWithBlack = (l + 0.05) / 0.05;
  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
};

const labFInv = (t: number): number =>
  t > 6 / 29 ? t * t * t : (108 / 841) * (t - 4 / 29);

/** CIE L*a*b* -> sRGB, clamped into gamut. */
export const labToRgb = ({ L, a, b }: Lab): Rgb => {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = labFInv(fx) * Xn;
  const y = labFInv(fy) * Yn;
  const z = labFInv(fz) * Zn;

  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gl = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));

  return { r: to8(rl), g: to8(gl), b: to8(bl) };
};

export const labToHex = (lab: Lab): string => {
  const { r, g, b } = labToRgb(lab);
  return rgbToHex(r, g, b);
};
