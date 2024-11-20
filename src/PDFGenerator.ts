import { jsPDF } from 'jspdf';
import type { ProcessedGrid } from './ImageProcessor';
import { COLORS } from './colors';

export const generatePDF = (
  grid: ProcessedGrid[],
  gridSize: number,
  maxColors: number
): void => {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const availableWidth = pageWidth - 2 * margin;
  const availableHeight = pageHeight - 2 * margin;
  
  // Calculate grid cell size to fit page
  const cellSize = Math.min(
    availableWidth / gridSize,
    (availableHeight - 30) / gridSize // Reserve even more space for legend
  );
  
  // Center the grid on the page
  const startX = margin + (availableWidth - cellSize * gridSize) / 2;
  const startY = margin + 15;
  
  // Draw title
  pdf.setFontSize(16);
  pdf.text('Paint by Numbers', pageWidth / 2, margin, { align: 'center' });
  // Set subtitle: https://paintbynumbers.sarmiento.cc/
  pdf.setFontSize(10);
  pdf.text('https://paintbynumbers.sarmiento.cc/', pageWidth / 2, margin + 5, { align: 'center' });
  
  // Draw grid
  pdf.setLineWidth(0.1);
  grid.forEach(({ colorIndex, x, y }) => {
    const cellX = startX + x * cellSize;
    const cellY = startY + y * cellSize;
    
    // Draw cell border
    pdf.rect(cellX, cellY, cellSize, cellSize);
    
    // Add number in cell with larger font size
    pdf.setFontSize(Math.min(14, cellSize * 0.8)); // Significantly increased font size
    pdf.text(
      colorIndex.toString(),
      cellX + cellSize / 2,
      cellY + cellSize / 2,
      { align: 'center', baseline: 'middle' }
    );
  });
  
  // Add color legend in flowing paragraph style
  const legendY = startY + cellSize * gridSize + margin;
  pdf.setFontSize(10);
  pdf.text('Color Legend:', margin, legendY);
  
  const legendColors = COLORS.slice(0, maxColors);
  let currentX = margin;
  let currentY = legendY + 5;
  const lineHeight = 5;
  
  legendColors.forEach((color, index) => {
    const text = `${index + 1}:${color.name}  `;
    const textWidth = pdf.getStringUnitWidth(text) * 10 * 0.352778;
    
    if (currentX + textWidth > pageWidth - margin) {
      currentX = margin;
      currentY += lineHeight;
    }
    
    pdf.text(text, currentX, currentY);
    currentX += textWidth;
  });
  
  pdf.save('paint-by-numbers.pdf');
};