import type { PaintByNumbers } from './ImageProcessor';

export type RenderMode = 'color' | 'outline';

export interface RenderOptions {
  mode: RenderMode;
  /** Cell size in CSS pixels. */
  cellSize: number;
  showNumbers: boolean;
  showGridLines: boolean;
}

export const NUMBER_MIN_CELL = 11;

/**
 * Draw the grid into a canvas, sizing the backing store for the device pixel
 * ratio so the numbers are not blurry on a retina screen.
 *
 * The original drew into a fixed 400x400 canvas with
 * `cellSize = Math.floor(400 / gridSize)`, which left an unpainted strip on the
 * right and bottom (40px of it at gridSize 45) and ignored the aspect ratio.
 */
export const drawGrid = (
  canvas: HTMLCanvasElement,
  result: PaintByNumbers,
  options: RenderOptions,
): void => {
  const { cols, rows, cells, palette } = result;
  const { mode, cellSize, showNumbers, showGridLines } = options;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssWidth = cols * cellSize;
  const cssHeight = rows * cellSize;

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const inkFor = new Map(palette.map((p) => [p.index, p.ink]));

  // Fills first, then a single pass of grid lines, so borders are not
  // overpainted by the neighbouring cell drawn afterwards.
  if (mode === 'color') {
    for (const cell of cells) {
      ctx.fillStyle = cell.hex;
      ctx.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize + 0.5, cellSize + 0.5);
    }
  }

  if (showGridLines) {
    ctx.strokeStyle = mode === 'color' ? 'rgba(0,0,0,0.18)' : '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
      const px = Math.round(x * cellSize) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssHeight);
    }
    for (let y = 0; y <= rows; y++) {
      const py = Math.round(y * cellSize) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(cssWidth, py);
    }
    ctx.stroke();
  }

  if (showNumbers && cellSize >= NUMBER_MIN_CELL) {
    const fontSize = Math.max(6, Math.floor(cellSize * 0.52));
    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const cell of cells) {
      // Pick black or white per swatch instead of stamping an opaque white box
      // behind the digit, which used to hide most of the colour it labelled.
      ctx.fillStyle = mode === 'color' ? inkFor.get(cell.colorIndex) ?? '#000000' : '#1e293b';
      ctx.fillText(
        String(cell.colorIndex),
        cell.x * cellSize + cellSize / 2,
        cell.y * cellSize + cellSize / 2 + fontSize * 0.04,
      );
    }
  }
};

/** Render at a fixed cell size and hand back a PNG blob. */
export const renderToBlob = (
  result: PaintByNumbers,
  options: RenderOptions,
): Promise<Blob | null> => {
  const canvas = document.createElement('canvas');
  drawGrid(canvas, result, options);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
};
