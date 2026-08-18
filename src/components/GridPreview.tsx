import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PaintByNumbers } from '../ImageProcessor';
import { drawGrid, NUMBER_MIN_CELL, type RenderMode } from '../render';

interface GridPreviewProps {
  result: PaintByNumbers;
  mode: RenderMode;
  showNumbers: boolean;
  zoom: number;
}

export function GridPreview({ result, mode, showNumbers, zoom }: GridPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  // Track the container width so the grid can be sized to fit it.
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    // clientWidth includes the container's padding, so using it directly made
    // the canvas a few pixels too wide and clipped the last column.
    const update = () => {
      const style = window.getComputedStyle(el);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setAvailable(Math.max(0, el.clientWidth - padding));
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitCell = available > 0 ? available / result.cols : 0;
  const cellSize = Math.max(3, Math.min(64, fitCell * zoom));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cellSize <= 0 || result.cells.length === 0) return;

    // Redraw whenever anything visible changes. The old component memoised on
    // JSON.stringify(grid) -- stringifying a few thousand objects on every
    // render -- and its effect did not depend on the grid size at all, so a
    // size change could leave the previous drawing on screen.
    drawGrid(canvas, result, {
      mode,
      cellSize,
      showNumbers,
      showGridLines: true,
    });
  }, [result, mode, showNumbers, cellSize]);

  const numbersHidden = showNumbers && cellSize < NUMBER_MIN_CELL;

  return (
    <div className="space-y-3">
      <div
        ref={wrapperRef}
        className="w-full overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3"
      >
        <canvas
          ref={canvasRef}
          className="mx-auto block rounded-lg bg-white shadow-sm"
          role="img"
          aria-label={`Paint by numbers grid, ${result.cols} by ${result.rows} cells, ${result.palette.length} colours`}
        />
      </div>
      {numbersHidden && (
        <p className="text-center text-sm text-amber-700">
          Cells are too small to show numbers here &mdash; zoom in, or lower the detail. The PDF
          still prints them.
        </p>
      )}
    </div>
  );
}
