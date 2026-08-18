import { deltaE2000, rgbToLab, readableTextColor, hexToRgb, type Lab } from './color';
import { PALETTE_SETS, prepare, type PaletteSetId, type PreparedColor } from './colors';
import { buildHistogram, kMeansPalette, selectFromFixedPalette } from './quantize';

export interface ProcessedCell {
  /** 1-based index into `palette`. */
  colorIndex: number;
  hex: string;
  x: number;
  y: number;
}

export interface PaletteEntry {
  index: number; // 1-based, matches the number printed in the cell
  name: string;
  hex: string;
  /** How many cells use this colour -- shown in the legend. */
  count: number;
  /** Black or white, whichever stays readable on top of `hex`. */
  ink: string;
}

export interface PaintByNumbers {
  cells: ProcessedCell[];
  cols: number;
  rows: number;
  palette: PaletteEntry[];
  sourceWidth: number;
  sourceHeight: number;
}

export interface ProcessOptions {
  /** Cells along the longest edge. The short edge follows the aspect ratio. */
  detail: number;
  maxColors: number;
  paletteId: PaletteSetId | 'auto';
  /** Majority-filter passes that clean up isolated speckle cells. */
  smoothing: number;
}

export interface ImageAnalysis {
  minDetail: number;
  maxDetail: number;
  suggestedDetail: number;
  complexity: number;
}

export const DETAIL_LIMITS = { min: 8, max: 140 } as const;
export const COLOR_LIMITS = { min: 2, max: 24 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Decode a file into a bitmap, honouring EXIF orientation so photos taken on a
 * phone are not silently rotated 90 degrees.
 */
const decode = async (file: File | Blob): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older Safari rejects the options bag rather than ignoring it.
    return await createImageBitmap(file);
  }
};

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Prefer OffscreenCanvas so this module can run inside a Web Worker; fall back
 * to a detached <canvas> on the main thread.
 */
const makeCanvas = (width: number, height: number): { ctx: Ctx2D } => {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D canvas context.');
    return { ctx: ctx as OffscreenCanvasRenderingContext2D };
  }

  if (typeof document === 'undefined') {
    throw new Error('No canvas implementation is available in this environment.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D canvas context.');
  return { ctx };
};

/** Grid dimensions for a given detail level, preserving the image's aspect. */
export const gridDimensions = (
  imageWidth: number,
  imageHeight: number,
  detail: number,
): { cols: number; rows: number } => {
  const d = clamp(Math.round(detail), DETAIL_LIMITS.min, DETAIL_LIMITS.max);
  if (imageWidth <= 0 || imageHeight <= 0) return { cols: d, rows: d };

  if (imageWidth >= imageHeight) {
    return { cols: d, rows: Math.max(1, Math.round((d * imageHeight) / imageWidth)) };
  }
  return { cols: Math.max(1, Math.round((d * imageWidth) / imageHeight)), rows: d };
};

/**
 * Estimate how much detail the image can support, so the slider starts
 * somewhere sensible.
 *
 * The old version padded the image out to a square with white bars before
 * measuring, which added two hard artificial edges and diluted every metric
 * with blank pixels. It also ran its "Sobel" on the red channel only.
 */
export const analyzeImageComplexity = async (file: File | Blob): Promise<ImageAnalysis> => {
  const bitmap = await decode(file);
  try {
    const long = Math.max(bitmap.width, bitmap.height) || 1;
    const scale = Math.min(1, 256 / long);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const { ctx } = makeCanvas(w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);

    // Luma, so an edge between two equally bright colours still registers.
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }

    let edgeEnergy = 0;
    let samples = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        // Proper 3x3 Sobel.
        const gx =
          -luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1] +
          luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1];
        const gy =
          -luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1] +
          luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1];
        edgeEnergy += Math.min(255, Math.hypot(gx, gy) / 4);
        samples++;
      }
    }

    const complexity = samples > 0 ? clamp(edgeEnergy / samples / 40, 0, 1) : 0.5;

    const minDetail = Math.round(16 + complexity * 12);
    const maxDetail = Math.round(52 + complexity * 58);
    const suggestedDetail = Math.round(minDetail + (maxDetail - minDetail) * 0.42);

    return { minDetail, maxDetail, suggestedDetail, complexity };
  } finally {
    bitmap.close?.();
  }
};

/**
 * Turn an image into a numbered grid.
 *
 * Notable differences from the original:
 *  - the grid is cols x rows derived from the aspect ratio, not N x N, so a
 *    landscape photo is no longer squashed into a square;
 *  - cell colour is the linear-light mean of the cell, not whichever exact
 *    24-bit value happened to occur most often (in a photograph almost every
 *    pixel is unique, so that "dominant colour" was effectively one arbitrary
 *    pixel per cell);
 *  - the palette is chosen to fit the image instead of being the first N
 *    entries of an alphabetical list;
 *  - transparent pixels are composited over white rather than averaged as
 *    black.
 */
export const processImage = async (
  file: File | Blob,
  options: ProcessOptions,
): Promise<PaintByNumbers> => {
  const bitmap = await decode(file);

  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    if (sourceWidth === 0 || sourceHeight === 0) {
      throw new Error('That image appears to be empty.');
    }

    const { cols, rows } = gridDimensions(sourceWidth, sourceHeight, options.detail);

    // Render the image at an exact multiple of the grid so every cell gets the
    // same number of samples and no edge strip is dropped. `Math.floor` on the
    // old cell size discarded up to gridSize-1 pixels off the right and bottom,
    // and produced a zero-sized getImageData (which throws) whenever the image
    // was smaller than the grid.
    const perCell = clamp(Math.floor(1800 / Math.max(cols, rows)), 2, 10);
    const sampleW = cols * perCell;
    const sampleH = rows * perCell;

    const { ctx } = makeCanvas(sampleW, sampleH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sampleW, sampleH);
    ctx.drawImage(bitmap, 0, 0, sampleW, sampleH);

    const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

    // sRGB -> linear lookup; averaging in gamma space darkens midtones.
    const toLinear = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      toLinear[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    const fromLinear = (v: number) => {
      const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      return clamp(Math.round(c * 255), 0, 255);
    };

    const cellLabs: Lab[] = new Array(cols * rows);

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        let rs = 0;
        let gs = 0;
        let bs = 0;

        for (let sy = 0; sy < perCell; sy++) {
          const rowStart = ((gy * perCell + sy) * sampleW + gx * perCell) * 4;
          for (let sx = 0; sx < perCell; sx++) {
            const i = rowStart + sx * 4;
            rs += toLinear[data[i]];
            gs += toLinear[data[i + 1]];
            bs += toLinear[data[i + 2]];
          }
        }

        const n = perCell * perCell;
        cellLabs[gy * cols + gx] = rgbToLab({
          r: fromLinear(rs / n),
          g: fromLinear(gs / n),
          b: fromLinear(bs / n),
        });
      }
    }

    // --- choose the palette -------------------------------------------------
    const wanted = clamp(Math.round(options.maxColors), COLOR_LIMITS.min, COLOR_LIMITS.max);
    const histogram = buildHistogram(cellLabs);

    let palette: PreparedColor[];
    if (options.paletteId === 'auto') {
      palette = prepare(kMeansPalette(histogram, wanted));
    } else {
      const set = PALETTE_SETS[options.paletteId] ?? PALETTE_SETS.crayola;
      palette = selectFromFixedPalette(histogram, prepare(set.colors), wanted);
    }
    if (palette.length === 0) palette = prepare(PALETTE_SETS.crayola.colors.slice(0, 1));

    // --- assign every cell to its nearest palette colour --------------------
    const assignment = new Int32Array(cols * rows);
    for (let i = 0; i < cellLabs.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const d = deltaE2000(cellLabs[i], palette[p].lab);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      assignment[i] = best;
    }

    // --- clean up speckle ---------------------------------------------------
    for (let pass = 0; pass < clamp(Math.round(options.smoothing), 0, 3); pass++) {
      smoothOnce(assignment, cols, rows, palette.length);
    }

    // --- build the legend, keeping only colours that actually get used ------
    const counts = new Map<number, number>();
    for (let i = 0; i < assignment.length; i++) {
      counts.set(assignment[i], (counts.get(assignment[i]) ?? 0) + 1);
    }

    const used = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    // Generated palettes can land several colours on the same descriptive name
    // ("Light Blue" four times is not a usable key), so number the repeats.
    const nameTotals = new Map<string, number>();
    for (const [paletteIdx] of used) {
      const n = palette[paletteIdx].name;
      nameTotals.set(n, (nameTotals.get(n) ?? 0) + 1);
    }
    const nameSeen = new Map<string, number>();

    const numberOf = new Map<number, number>();
    const legend: PaletteEntry[] = used.map(([paletteIdx, count], i) => {
      numberOf.set(paletteIdx, i + 1);
      const hex = palette[paletteIdx].hex;
      const baseName = palette[paletteIdx].name;

      let name = baseName;
      if ((nameTotals.get(baseName) ?? 0) > 1) {
        const seen = (nameSeen.get(baseName) ?? 0) + 1;
        nameSeen.set(baseName, seen);
        name = `${baseName} ${seen}`;
      }

      return {
        index: i + 1,
        name,
        hex,
        count,
        ink: readableTextColor(hexToRgb(hex)),
      };
    });

    const cells: ProcessedCell[] = new Array(cols * rows);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        const p = assignment[i];
        cells[i] = {
          colorIndex: numberOf.get(p)!,
          hex: palette[p].hex,
          x: gx,
          y: gy,
        };
      }
    }

    return { cells, cols, rows, palette: legend, sourceWidth, sourceHeight };
  } finally {
    bitmap.close?.();
  }
};

/**
 * One majority-filter pass: a cell surrounded by a clear majority of a single
 * other colour adopts it. Removes lone speckles that are impossible to paint
 * without a magnifier.
 */
const smoothOnce = (assignment: Int32Array, cols: number, rows: number, paletteSize: number) => {
  const source = Int32Array.from(assignment);
  const tally = new Int32Array(paletteSize);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      tally.fill(0);
      let neighbours = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          tally[source[ny * cols + nx]]++;
          neighbours++;
        }
      }

      let bestColor = -1;
      let bestCount = 0;
      for (let p = 0; p < paletteSize; p++) {
        if (tally[p] > bestCount) {
          bestCount = tally[p];
          bestColor = p;
        }
      }

      // Only override when the surroundings are strongly in agreement.
      const own = source[y * cols + x];
      if (bestColor >= 0 && bestColor !== own && bestCount >= Math.ceil(neighbours * 0.625)) {
        assignment[y * cols + x] = bestColor;
      }
    }
  }
};
