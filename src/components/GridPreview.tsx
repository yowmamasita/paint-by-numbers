import React from 'react';
import type { ProcessedGrid } from '../ImageProcessor';

interface GridPreviewProps {
  grid: ProcessedGrid[];
  gridSize: number;
}

export function GridPreview({ grid, gridSize }: GridPreviewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const renderedGridRef = React.useRef<string>('');

  React.useEffect(() => {
    if (!canvasRef.current || grid.length === 0) return;

    // Create a unique key for the current grid state
    const gridKey = JSON.stringify(grid);
    
    // Only redraw if the grid data has changed
    if (gridKey === renderedGridRef.current) return;
    renderedGridRef.current = gridKey;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const cellSize = Math.floor(canvas.width / gridSize);

    // Clear canvas
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    grid.forEach(({ color, colorIndex, x, y }) => {
      const xPos = x * cellSize;
      const yPos = y * cellSize;

      // Fill cell with color
      ctx.fillStyle = color;
      ctx.fillRect(xPos, yPos, cellSize, cellSize);

      // Draw cell border
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(xPos, yPos, cellSize, cellSize);

      // Draw number with contrasting background
      const textSize = cellSize * 0.4;
      ctx.font = `bold ${textSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Add white background behind number for better visibility
      const text = colorIndex.toString();
      const textWidth = ctx.measureText(text).width;
      const padding = textSize * 0.3;
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(
        xPos + cellSize/2 - textWidth/2 - padding/2,
        yPos + cellSize/2 - textSize/2 - padding/2,
        textWidth + padding,
        textSize + padding
      );

      // Draw number
      ctx.fillStyle = '#4c1d95';
      ctx.fillText(
        text,
        xPos + cellSize/2,
        yPos + cellSize/2
      );
    });
  }, [grid]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={400}
      className="w-full max-w-md mx-auto border-4 border-purple-100 rounded-2xl shadow-lg"
    />
  );
}