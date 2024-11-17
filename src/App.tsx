import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Image as ImageIcon, Eye, Download } from 'lucide-react';
import { processImage, analyzeImageComplexity } from './ImageProcessor';
import { generatePDF } from './PDFGenerator';
import { GridPreview } from './components/GridPreview';
import type { ProcessedGrid } from './ImageProcessor';

function App() {
  const [gridSize, setGridSize] = useState(20);
  const [maxColors, setMaxColors] = useState(12);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [processedGrid, setProcessedGrid] = useState<ProcessedGrid[]>([]);
  const [gridSizeRange, setGridSizeRange] = useState({ min: 10, max: 40 });
  const [imageFile, setImageFile] = useState<File | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    setProcessing(true);
    setPreview(URL.createObjectURL(file));
    setImageFile(file);
    setProcessedGrid([]);

    try {
      const analysis = await analyzeImageComplexity(file);
      setGridSizeRange({
        min: analysis.minGridSize,
        max: analysis.maxGridSize
      });
      
      const initialGridSize = Math.round((analysis.minGridSize + analysis.maxGridSize) / 2);
      setGridSize(initialGridSize);
    } catch (error) {
      console.error('Error analyzing image:', error);
      alert('Error processing image. Please try again.');
    } finally {
      setProcessing(false);
    }
  }, []);

  const handlePreview = async () => {
    if (!imageFile) return;

    setProcessing(true);
    try {
      const grid = await processImage(imageFile, gridSize, maxColors);
      setProcessedGrid(grid);
    } catch (error) {
      console.error('Error processing image:', error);
      alert('Error generating preview. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (processedGrid.length > 0) {
      generatePDF(processedGrid, gridSize, maxColors);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    multiple: false
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-blue-50 to-purple-50 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-indigo-600 mb-4 font-display">
            Paint by Numbers Generator
          </h1>
          <p className="text-lg text-indigo-400">
            Turn your favorite pictures into fun coloring activities!
          </p>
        </header>

        <div className="bg-white rounded-3xl shadow-xl p-8 mb-8 border-4 border-purple-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="order-1">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-pink-600">
                <span className="inline-block w-8 h-8 rounded-full bg-pink-500 text-white text-lg font-bold flex items-center justify-center shadow-md">1</span>
                <ImageIcon className="w-6 h-6" />
                Upload Image
              </h2>

              <div
                {...getRootProps()}
                className={`border-4 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors h-[300px] flex flex-col items-center justify-center
                  ${isDragActive ? 'border-pink-400 bg-pink-50' : 'border-pink-200 hover:border-pink-300'}`}
              >
                <input {...getInputProps()} />
                <Upload className="w-16 h-16 mb-4 text-pink-400" />
                {isDragActive ? (
                  <p className="text-pink-500 text-lg font-medium">Drop your image here!</p>
                ) : (
                  <p className="text-pink-400 text-lg">
                    Drag & drop an image here, or click to select
                  </p>
                )}
                {preview && (
                  <img
                    src={preview}
                    alt="Preview"
                    className="mt-4 max-h-32 rounded-xl shadow-md"
                  />
                )}
              </div>
            </div>

            <div className="order-2">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-blue-600">
                <span className="inline-block w-8 h-8 rounded-full bg-blue-500 text-white text-lg font-bold flex items-center justify-center shadow-md">2</span>
                <Eye className="w-6 h-6" />
                Settings
              </h2>

              <div className="space-y-6 bg-blue-50 p-6 rounded-2xl border-4 border-blue-100">
                <div>
                  <label className="block text-lg font-medium text-blue-700 mb-2">
                    Grid Size: {gridSize}x{gridSize}
                  </label>
                  <input
                    type="range"
                    min={gridSizeRange.min}
                    max={gridSizeRange.max}
                    value={gridSize}
                    onChange={(e) => setGridSize(Number(e.target.value))}
                    className="w-full h-3 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <p className="mt-2 text-sm text-blue-500">
                    Suggested range: {gridSizeRange.min} - {gridSizeRange.max}
                  </p>
                </div>

                <div>
                  <label className="block text-lg font-medium text-blue-700 mb-2">
                    Maximum Colors: {maxColors}
                  </label>
                  <input
                    type="range"
                    min="2"
                    max="24"
                    value={maxColors}
                    onChange={(e) => setMaxColors(Number(e.target.value))}
                    className="w-full h-3 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <p className="mt-2 text-sm text-blue-500">
                    Choose between 2 and 24 colors
                  </p>
                </div>

                <button
                  onClick={handlePreview}
                  disabled={!imageFile || processing}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl hover:from-blue-600 hover:to-indigo-600 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all text-lg font-medium shadow-md"
                >
                  <Eye className="w-5 h-5" />
                  Generate Preview
                </button>
              </div>
            </div>
          </div>
        </div>

        {processedGrid.length > 0 && (
          <div className="bg-white rounded-3xl shadow-xl p-8 border-4 border-purple-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-purple-600">Preview</h2>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all text-lg font-medium shadow-md"
              >
                <Download className="w-5 h-5" />
                Download PDF
              </button>
            </div>
            <GridPreview grid={processedGrid} gridSize={gridSize} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;