import type { jsPDF } from 'jspdf';
import { hexToRgb } from './color';
import type { PaintByNumbers } from './ImageProcessor';
import { drawGrid } from './render';

export interface PdfOptions {
  /** Add a second page showing what the finished picture should look like. */
  includeColorReference: boolean;
  title: string;
}

const MARGIN = 12;
const FOOTER = 'paintbynumbers.sarmiento.cc';

/**
 * Build the printable sheet.
 *
 * Fixes over the original:
 *  - page orientation follows the picture, and the grid keeps its aspect ratio
 *    instead of being forced square;
 *  - the legend gets real colour swatches, is laid out in columns and flows
 *    onto another page instead of running off the bottom edge;
 *  - grid lines are drawn as lines rather than one rectangle per cell, which
 *    keeps a 140-column sheet from ballooning the file;
 *  - text widths come from `getTextWidth()` rather than the deprecated
 *    `getStringUnitWidth()` scaled by a hardcoded font size.
 *
 * jsPDF is imported on demand: it drags in html2canvas and dompurify, which are
 * ~220 kB we do not want in the initial page load for a feature most visitors
 * only reach at the very end.
 */
export const generatePDF = async (result: PaintByNumbers, options: PdfOptions): Promise<void> => {
  const { jsPDF } = await import('jspdf');
  const { cols, rows, cells, palette } = result;

  const landscape = cols > rows;
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const headerHeight = 14;
  const legendRows = Math.ceil(palette.length / legendColumns(pageWidth));
  const legendHeight = 8 + legendRows * 6;
  const footerHeight = 8;

  const availableWidth = pageWidth - 2 * MARGIN;
  const availableHeight = pageHeight - 2 * MARGIN - headerHeight - legendHeight - footerHeight;

  const cell = Math.min(availableWidth / cols, availableHeight / rows);
  const gridWidth = cell * cols;
  const gridHeight = cell * rows;
  const startX = MARGIN + (availableWidth - gridWidth) / 2;
  const startY = MARGIN + headerHeight;

  // --- header ---------------------------------------------------------------
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor(30, 41, 59);
  pdf.text(options.title || 'Paint by Numbers', pageWidth / 2, MARGIN + 2, { align: 'center' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(120, 130, 145);
  pdf.text(
    `${cols} x ${rows} cells  |  ${palette.length} colour${palette.length === 1 ? '' : 's'}`,
    pageWidth / 2,
    MARGIN + 7,
    { align: 'center' },
  );

  // --- grid lines -----------------------------------------------------------
  pdf.setDrawColor(150, 160, 175);
  pdf.setLineWidth(0.12);
  for (let x = 0; x <= cols; x++) {
    const px = startX + x * cell;
    pdf.line(px, startY, px, startY + gridHeight);
  }
  for (let y = 0; y <= rows; y++) {
    const py = startY + y * cell;
    pdf.line(startX, py, startX + gridWidth, py);
  }

  // Heavier border around the whole picture.
  pdf.setDrawColor(60, 70, 85);
  pdf.setLineWidth(0.4);
  pdf.rect(startX, startY, gridWidth, gridHeight);

  // --- numbers --------------------------------------------------------------
  const fontSize = Math.max(2.4, Math.min(11, cell * 1.9));
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(fontSize);
  pdf.setTextColor(40, 50, 65);

  for (const c of cells) {
    pdf.text(
      String(c.colorIndex),
      startX + c.x * cell + cell / 2,
      startY + c.y * cell + cell / 2,
      { align: 'center', baseline: 'middle' },
    );
  }

  // --- legend ---------------------------------------------------------------
  drawLegend(pdf, palette, MARGIN, startY + gridHeight + 8, pageWidth, pageHeight);

  drawFooter(pdf, pageWidth, pageHeight);

  // --- optional colour reference page ---------------------------------------
  if (options.includeColorReference) {
    pdf.addPage(undefined, landscape ? 'landscape' : 'portrait');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(30, 41, 59);
    pdf.text('Colour reference', pageWidth / 2, MARGIN + 2, { align: 'center' });

    const canvas = document.createElement('canvas');
    // ~150 dpi across the printed width is plenty for a reference image.
    const targetPx = Math.min(1600, Math.max(700, Math.round((availableWidth / 25.4) * 150)));
    drawGrid(canvas, result, {
      mode: 'color',
      cellSize: Math.max(2, Math.floor(targetPx / cols)),
      showNumbers: false,
      showGridLines: false,
    });

    const refHeight = pageHeight - 2 * MARGIN - headerHeight - footerHeight;
    const scale = Math.min(availableWidth / cols, refHeight / rows);
    pdf.addImage(
      // JPEG, and explicitly compressed. jsPDF defaults `compression` to 'NONE',
      // which embedded this page as a raw RGB stream and turned a routine sheet
      // into a 13 MB download.
      canvas.toDataURL('image/jpeg', 0.9),
      'JPEG',
      MARGIN + (availableWidth - scale * cols) / 2,
      MARGIN + headerHeight,
      scale * cols,
      scale * rows,
      undefined,
      'MEDIUM',
    );

    drawFooter(pdf, pageWidth, pageHeight);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  pdf.save(`paint-by-numbers-${stamp}.pdf`);
};

const legendColumns = (pageWidth: number): number => (pageWidth > 240 ? 5 : 3);

const drawLegend = (
  pdf: jsPDF,
  palette: PaintByNumbers['palette'],
  marginX: number,
  startY: number,
  pageWidth: number,
  pageHeight: number,
): void => {
  const columns = legendColumns(pageWidth);
  const usableWidth = pageWidth - 2 * marginX;
  const columnWidth = usableWidth / columns;
  const rowHeight = 6;
  const swatch = 4;

  let y = startY;

  const heading = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(30, 41, 59);
    pdf.text('Colour key', marginX, y);
    y += 5;
  };

  heading();

  palette.forEach((entry, i) => {
    const col = i % columns;
    if (col === 0 && i > 0) y += rowHeight;

    // Flow onto a new page rather than drawing past the bottom edge.
    if (col === 0 && y > pageHeight - marginX - 8) {
      drawFooter(pdf, pageWidth, pageHeight);
      pdf.addPage();
      y = marginX + 4;
      heading();
    }

    const x = marginX + col * columnWidth;
    const { r, g, b } = hexToRgb(entry.hex);

    pdf.setFillColor(r, g, b);
    pdf.setDrawColor(120, 130, 145);
    pdf.setLineWidth(0.2);
    pdf.rect(x, y - swatch + 1, swatch, swatch, 'FD');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(30, 41, 59);
    const label = `${entry.index}`;
    pdf.text(label, x + swatch + 1.5, y);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(80, 90, 105);
    const numberWidth = pdf.getTextWidth(label);
    const nameX = x + swatch + 1.5 + numberWidth + 1.5;
    const room = columnWidth - (nameX - x) - 2;
    pdf.text(truncate(pdf, entry.name, room), nameX, y);
  });
};

/** Trim a label with an ellipsis so it cannot spill into the next column. */
const truncate = (pdf: jsPDF, text: string, maxWidth: number): string => {
  if (maxWidth <= 0) return '';
  if (pdf.getTextWidth(text) <= maxWidth) return text;

  let out = text;
  while (out.length > 1 && pdf.getTextWidth(`${out}…`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
};

const drawFooter = (pdf: jsPDF, pageWidth: number, pageHeight: number): void => {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(150, 158, 170);
  pdf.text(FOOTER, pageWidth / 2, pageHeight - 6, { align: 'center' });
};
