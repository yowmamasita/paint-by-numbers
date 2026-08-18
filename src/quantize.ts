import { deltaE2000, labToHex, type Lab } from './color';
import { prepare, type PaletteColor, type PreparedColor } from './colors';

/**
 * A weighted set of distinct colours, used so palette selection runs over a few
 * thousand buckets instead of every cell in the grid.
 */
export interface ColorHistogram {
  labs: Lab[];
  weights: number[];
}

const BIN = 5;

export const buildHistogram = (labs: Lab[]): ColorHistogram => {
  const buckets = new Map<number, { L: number; a: number; b: number; w: number }>();

  for (const lab of labs) {
    const kl = Math.round(lab.L / BIN);
    const ka = Math.round(lab.a / BIN);
    const kb = Math.round(lab.b / BIN);
    // a and b are offset so the key stays a small non-negative integer.
    const key = (kl * 128 + (ka + 64)) * 128 + (kb + 64);

    const existing = buckets.get(key);
    if (existing) {
      existing.L += lab.L;
      existing.a += lab.a;
      existing.b += lab.b;
      existing.w += 1;
    } else {
      buckets.set(key, { L: lab.L, a: lab.a, b: lab.b, w: 1 });
    }
  }

  const out: ColorHistogram = { labs: [], weights: [] };
  for (const b of buckets.values()) {
    out.labs.push({ L: b.L / b.w, a: b.a / b.w, b: b.b / b.w });
    out.weights.push(b.w);
  }
  return out;
};

/**
 * Pick the `k` entries of `candidates` that best represent the histogram.
 *
 * This replaces the original `COLORS.slice(0, maxColors)`, which just took the
 * first N of an alphabetically sorted list -- so asking for 12 colours gave you
 * Apricot through Green Yellow and left the image with no red, yellow, orange
 * or white to work with, regardless of what was actually in the picture.
 *
 * Greedy forward selection, then a swap-improvement pass to escape the obvious
 * local optimum. Cost is total weighted CIEDE2000 to the nearest chosen colour.
 */
export const selectFromFixedPalette = (
  hist: ColorHistogram,
  candidates: PreparedColor[],
  k: number,
): PreparedColor[] => {
  const n = candidates.length;
  const m = hist.labs.length;
  const want = Math.max(1, Math.min(k, n));
  if (m === 0) return candidates.slice(0, want);

  // dist[c * m + j] = perceptual distance from bucket j to candidate c.
  const dist = new Float32Array(n * m);
  for (let c = 0; c < n; c++) {
    const lab = candidates[c].lab;
    for (let j = 0; j < m; j++) {
      dist[c * m + j] = deltaE2000(hist.labs[j], lab);
    }
  }

  // Larger than any achievable CIEDE2000, so "not yet covered" is finite and
  // the gain arithmetic below stays a plain subtraction.
  const UNCOVERED = 1000;

  const chosen: number[] = [];
  const best = new Float32Array(m).fill(UNCOVERED);

  // --- greedy forward selection -------------------------------------------
  while (chosen.length < want) {
    let bestCandidate = -1;
    let bestGain = -Infinity;

    for (let c = 0; c < n; c++) {
      if (chosen.includes(c)) continue;
      let gain = 0;
      const off = c * m;
      for (let j = 0; j < m; j++) {
        const d = dist[off + j];
        if (d < best[j]) gain += hist.weights[j] * (best[j] - d);
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestCandidate = c;
      }
    }

    if (bestCandidate < 0) break;
    chosen.push(bestCandidate);
    const off = bestCandidate * m;
    for (let j = 0; j < m; j++) {
      if (dist[off + j] < best[j]) best[j] = dist[off + j];
    }
  }

  // --- swap improvement ----------------------------------------------------
  // Track nearest and second-nearest so evaluating "drop x, add y" is one pass.
  const recomputeTwoBest = () => {
    const b1 = new Float32Array(m).fill(UNCOVERED);
    const b2 = new Float32Array(m).fill(UNCOVERED);
    const owner = new Int32Array(m).fill(-1);
    for (const c of chosen) {
      const off = c * m;
      for (let j = 0; j < m; j++) {
        const d = dist[off + j];
        if (d < b1[j]) {
          b2[j] = b1[j];
          b1[j] = d;
          owner[j] = c;
        } else if (d < b2[j]) {
          b2[j] = d;
        }
      }
    }
    return { b1, b2, owner };
  };

  const totalCost = (b1: Float32Array) => {
    let sum = 0;
    for (let j = 0; j < m; j++) sum += hist.weights[j] * b1[j];
    return sum;
  };

  for (let round = 0; round < 3; round++) {
    const { b1, b2, owner } = recomputeTwoBest();
    let current = totalCost(b1);
    let improved = false;

    for (let ci = 0; ci < chosen.length; ci++) {
      const drop = chosen[ci];
      for (let add = 0; add < n; add++) {
        if (chosen.includes(add)) continue;
        const off = add * m;
        let cost = 0;
        for (let j = 0; j < m; j++) {
          const without = owner[j] === drop ? b2[j] : b1[j];
          const d = dist[off + j];
          cost += hist.weights[j] * (d < without ? d : without);
        }
        if (cost < current - 1e-6) {
          chosen[ci] = add;
          current = cost;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }

    if (!improved) break;
  }

  return chosen.map((c) => candidates[c]);
};

/** Squared distance in Lab -- cheap, only used to drive k-means iterations. */
const labDist2 = (p: Lab, q: Lab): number => {
  const dL = p.L - q.L;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return dL * dL + da * da + db * db;
};

/**
 * Weighted k-means++ in Lab space, for the "match my image" palette mode.
 * Deterministic seeding so the same picture always yields the same palette.
 */
export const kMeansPalette = (hist: ColorHistogram, k: number): PaletteColor[] => {
  const m = hist.labs.length;
  const want = Math.max(1, Math.min(k, m));
  if (m === 0) return [];

  const centroids: Lab[] = [];
  // Seed with the heaviest bucket, then farthest-point (k-means++ without RNG).
  let heaviest = 0;
  for (let j = 1; j < m; j++) if (hist.weights[j] > hist.weights[heaviest]) heaviest = j;
  centroids.push({ ...hist.labs[heaviest] });

  const nearest = new Float64Array(m);
  for (let j = 0; j < m; j++) nearest[j] = labDist2(hist.labs[j], centroids[0]);

  while (centroids.length < want) {
    let pick = -1;
    let bestScore = -1;
    for (let j = 0; j < m; j++) {
      const score = nearest[j] * hist.weights[j];
      if (score > bestScore) {
        bestScore = score;
        pick = j;
      }
    }
    if (pick < 0 || bestScore <= 0) break;
    centroids.push({ ...hist.labs[pick] });
    const c = centroids[centroids.length - 1];
    for (let j = 0; j < m; j++) {
      const d = labDist2(hist.labs[j], c);
      if (d < nearest[j]) nearest[j] = d;
    }
  }

  // Lloyd iterations.
  const assign = new Int32Array(m);
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (let j = 0; j < m; j++) {
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = labDist2(hist.labs[j], centroids[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      if (assign[j] !== bi) {
        assign[j] = bi;
        moved = true;
      }
    }

    const sumL = new Float64Array(centroids.length);
    const sumA = new Float64Array(centroids.length);
    const sumB = new Float64Array(centroids.length);
    const sumW = new Float64Array(centroids.length);
    for (let j = 0; j < m; j++) {
      const c = assign[j];
      const w = hist.weights[j];
      sumL[c] += hist.labs[j].L * w;
      sumA[c] += hist.labs[j].a * w;
      sumB[c] += hist.labs[j].b * w;
      sumW[c] += w;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sumW[c] > 0) {
        centroids[c] = { L: sumL[c] / sumW[c], a: sumA[c] / sumW[c], b: sumB[c] / sumW[c] };
      }
    }
    if (!moved) break;
  }

  return centroids.map((lab) => ({ name: describeLab(lab), hex: labToHex(lab) }));
};

/**
 * Rough human-readable name for a generated colour, e.g. "Deep Blue".
 *
 * Hue boundaries are the *Lab* hue angle, which is not the HSL wheel: pure red
 * sits at 40 degrees, yellow at 103, green at 136, blue at 306 and magenta at
 * 328. Using HSL-style cut points here named reds "Orange" and blues "Violet".
 */
const describeLab = (lab: Lab): string => {
  const chroma = Math.hypot(lab.a, lab.b);

  if (chroma < 8) {
    if (lab.L > 92) return 'White';
    if (lab.L > 75) return 'Light Gray';
    if (lab.L > 45) return 'Gray';
    if (lab.L > 20) return 'Dark Gray';
    return 'Black';
  }

  const hue = ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;

  // Muted, darker warm tones read as brown rather than a dull orange.
  if (hue >= 28 && hue < 78 && chroma < 55 && lab.L < 62) {
    return lab.L < 38 ? 'Dark Brown' : 'Brown';
  }

  const names: [number, string][] = [
    [15, 'Pink'],
    [47, 'Red'],
    [62, 'Orange'],
    [88, 'Amber'],
    [110, 'Yellow'],
    [128, 'Lime'],
    [175, 'Green'],
    [215, 'Teal'],
    [308, 'Blue'],
    [322, 'Violet'],
    [342, 'Magenta'],
    [360, 'Pink'],
  ];
  const base = names.find(([limit]) => hue < limit)?.[1] ?? 'Red';

  // A highly saturated colour is not "pale" even when Lab says it is light --
  // pure yellow sits at L 97 and pure green at L 88.
  if (chroma > 70) return base;

  const lightness = lab.L > 82 ? 'Pale ' : lab.L > 65 ? 'Light ' : lab.L > 40 ? '' : 'Deep ';
  return `${lightness}${base}`.trim();
};

/** Convenience wrapper used by the processor. */
export const preparePalette = (colors: PaletteColor[]): PreparedColor[] => prepare(colors);
