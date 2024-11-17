import { COLORS } from './colors';

export interface ProcessedGrid {
  colorIndex: number;
  color: string;
  x: number;
  y: number;
}

export interface ImageAnalysis {
  minGridSize: number;
  maxGridSize: number;
  complexity: number;
}

export const analyzeImageComplexity = async (imageFile: File): Promise<ImageAnalysis> => {
  const img = await createImageBitmap(imageFile);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  // Normalize image size for analysis
  const analysisSize = 400;
  canvas.width = analysisSize;
  canvas.height = analysisSize;
  
  // Draw image maintaining aspect ratio
  const scale = Math.min(analysisSize / img.width, analysisSize / img.height);
  const scaledWidth = img.width * scale;
  const scaledHeight = img.height * scale;
  const x = (analysisSize - scaledWidth) / 2;
  const y = (analysisSize - scaledHeight) / 2;
  
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, analysisSize, analysisSize);
  ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
  
  const imageData = ctx.getImageData(0, 0, analysisSize, analysisSize);
  const { edgeComplexity, colorVariance } = calculateImageMetrics(imageData);
  
  // Normalize complexity scores (0-1)
  const complexity = (edgeComplexity * 0.7 + colorVariance * 0.3);
  
  // Calculate grid sizes based on complexity
  // More complex images need finer grids
  const minGridSize = Math.max(10, Math.round(15 + complexity * 10));
  const maxGridSize = Math.max(30, Math.round(30 + complexity * 20));
  
  return {
    minGridSize,
    maxGridSize,
    complexity
  };
};

const calculateImageMetrics = (imageData: ImageData) => {
  const { width, height, data } = imageData;
  let edgeCount = 0;
  const colorFrequency = new Map<string, number>();
  
  // Calculate edge density using Sobel operator
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      
      // Simplified Sobel operator for grayscale
      const gx = (
        -1 * data[idx - 4] +
        1 * data[idx + 4]
      );
      
      const gy = (
        -1 * data[idx - width * 4] +
        1 * data[idx + width * 4]
      );
      
      const gradient = Math.sqrt(gx * gx + gy * gy);
      if (gradient > 30) { // Threshold for edge detection
        edgeCount++;
      }
      
      // Track color frequency
      const color = rgbToHex(data[idx], data[idx + 1], data[idx + 2]);
      colorFrequency.set(color, (colorFrequency.get(color) || 0) + 1);
    }
  }
  
  // Normalize metrics
  const edgeComplexity = Math.min(1, edgeCount / (width * height * 0.1));
  const colorVariance = Math.min(1, colorFrequency.size / 1000);
  
  return { edgeComplexity, colorVariance };
};

export const processImage = async (
  imageFile: File,
  gridSize: number,
  maxColors: number
): Promise<ProcessedGrid[]> => {
  const img = await createImageBitmap(imageFile);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
  
  const cellWidth = Math.floor(img.width / gridSize);
  const cellHeight = Math.floor(img.height / gridSize);
  const grid: ProcessedGrid[] = [];
  
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const imageData = ctx.getImageData(
        x * cellWidth,
        y * cellHeight,
        cellWidth,
        cellHeight
      );
      
      const dominantColor = getDominantColor(imageData.data);
      const { index, color } = findClosestColor(dominantColor, maxColors);
      
      grid.push({
        colorIndex: index + 1,
        color,
        x,
        y,
      });
    }
  }
  
  return grid;
};

const getDominantColor = (pixels: Uint8ClampedArray): string => {
  const colorCounts = new Map<string, number>();
  
  for (let i = 0; i < pixels.length; i += 4) {
    const color = rgbToHex(pixels[i], pixels[i + 1], pixels[i + 2]);
    colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
  }
  
  let maxCount = 0;
  let dominantColor = '#000000';
  
  colorCounts.forEach((count, color) => {
    if (count > maxCount) {
      maxCount = count;
      dominantColor = color;
    }
  });
  
  return dominantColor;
};

const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

const findClosestColor = (hex: string, maxColors: number): { index: number, color: string } => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  let minDistance = Infinity;
  let closestIndex = 0;
  
  const availableColors = COLORS.slice(0, maxColors);
  
  availableColors.forEach((paletteColor, index) => {
    const pr = parseInt(paletteColor.hex.slice(1, 3), 16);
    const pg = parseInt(paletteColor.hex.slice(3, 5), 16);
    const pb = parseInt(paletteColor.hex.slice(5, 7), 16);
    
    const distance = Math.sqrt(
      Math.pow(r - pr, 2) +
      Math.pow(g - pg, 2) +
      Math.pow(b - pb, 2)
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = index;
    }
  });
  
  return {
    index: closestIndex,
    color: availableColors[closestIndex].hex
  };
};