import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import {
  AlertCircle,
  Download,
  FileDown,
  Grid3x3,
  Hash,
  Image as ImageIcon,
  Loader2,
  Palette,
  Sparkles,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  COLOR_LIMITS,
  DETAIL_LIMITS,
  gridDimensions,
  type ImageAnalysis,
  type PaintByNumbers,
  type ProcessOptions,
} from './ImageProcessor';
import type { PaletteSetId } from './colors';
import { generatePDF } from './PDFGenerator';
import { renderToBlob, type RenderMode } from './render';
import { GridPreview } from './components/GridPreview';
import { useProcessor } from './useProcessor';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

type PaletteChoice = PaletteSetId | 'auto';

const PALETTE_OPTIONS: { id: PaletteChoice; label: string; hint: string }[] = [
  { id: 'crayola', label: 'Crayola 24', hint: 'Named crayons you can actually buy' },
  { id: 'vivid', label: 'Vivid 24', hint: 'Brighter, better for paints' },
  { id: 'auto', label: 'Match my photo', hint: 'Colours mixed from the image itself' },
];

function App() {
  const { analyze, process } = useProcessor();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  const [detail, setDetail] = useState(32);
  const [maxColors, setMaxColors] = useState(12);
  const [paletteId, setPaletteId] = useState<PaletteChoice>('crayola');
  const [smoothing, setSmoothing] = useState(1);

  const [result, setResult] = useState<PaintByNumbers | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<RenderMode>('color');
  const [showNumbers, setShowNumbers] = useState(true);
  const [zoom, setZoom] = useState(1);

  // Each async flow carries its own token so a stale run never writes to state.
  // These must be separate counters: analysis and processing overlap (picking a
  // file starts both), and sharing one counter let the processing run cancel
  // the analysis, so the suggested detail level was never applied.
  const analyzeRunRef = useRef(0);
  const processRunRef = useRef(0);

  // The original leaked one blob URL per upload. Revoke on replace and unmount.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const reset = useCallback(() => {
    analyzeRunRef.current++;
    processRunRef.current++;
    setFile(null);
    setPreviewUrl(null);
    setAnalysis(null);
    setImageSize(null);
    setResult(null);
    setError(null);
    setBusy(false);
  }, []);

  const onDrop = useCallback(
    async (accepted: File[], rejections: FileRejection[]) => {
      if (rejections.length > 0) {
        setError(
          rejections[0].errors[0]?.code === 'file-too-large'
            ? 'That image is larger than 25 MB. Try a smaller one.'
            : 'That file is not an image we can read. Try a PNG, JPEG, GIF or WebP.',
        );
        return;
      }
      const picked = accepted[0];
      if (!picked) return;

      const token = ++analyzeRunRef.current;
      setError(null);
      setResult(null);
      setFile(picked);
      setPreviewUrl(URL.createObjectURL(picked));
      setBusy(true);

      try {
        const [info, dimensions] = await Promise.all([analyze(picked), readDimensions(picked)]);
        if (token !== analyzeRunRef.current) return;

        setAnalysis(info);
        setImageSize(dimensions);
        setDetail(info.suggestedDetail);
      } catch (err) {
        if (token !== analyzeRunRef.current) return;
        setBusy(false);
        setError(messageFor(err));
      }
    },
    [analyze],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'image/bmp': ['.bmp'],
    },
    maxSize: MAX_FILE_BYTES,
    multiple: false,
    noClick: true,
    noKeyboard: true,
  });

  const options = useMemo<ProcessOptions>(
    () => ({ detail, maxColors, paletteId, smoothing }),
    [detail, maxColors, paletteId, smoothing],
  );

  // Regenerate whenever the picture or any setting changes, debounced so
  // dragging a slider does not queue a run per pixel.
  useEffect(() => {
    if (!file) return;

    const token = ++processRunRef.current;
    setBusy(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const next = await process(file, options);
        if (token !== processRunRef.current) return;
        setResult(next);
      } catch (err) {
        if (token !== processRunRef.current) return;
        setError(messageFor(err));
      } finally {
        if (token === processRunRef.current) setBusy(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [file, options, process]);

  const projectedGrid = useMemo(() => {
    if (!imageSize) return null;
    return gridDimensions(imageSize.width, imageSize.height, detail);
  }, [imageSize, detail]);

  const [exporting, setExporting] = useState(false);

  const handlePdf = useCallback(async () => {
    if (!result) return;
    setExporting(true);
    try {
      await generatePDF(result, { includeColorReference: true, title: 'Paint by Numbers' });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setExporting(false);
    }
  }, [result]);

  const handlePng = useCallback(async () => {
    if (!result) return;
    try {
      const blob = await renderToBlob(result, {
        mode: viewMode,
        cellSize: 28,
        showNumbers,
        showGridLines: true,
      });
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `paint-by-numbers-${viewMode}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(messageFor(err));
    }
  }, [result, viewMode, showNumbers]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-sky-50 to-violet-50">
      <div {...getRootProps()} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <input {...getInputProps()} />

        <header className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-800 sm:text-4xl">
            Paint by Numbers
          </h1>
          <p className="mt-2 text-base text-slate-500 sm:text-lg">
            Turn any picture into a printable colouring sheet.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="flex-1 text-sm">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="rounded-lg p-1 hover:bg-rose-100"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* ---------------- upload ---------------- */}
          <section className="lg:col-span-2">
            <div className="h-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-800">
                <ImageIcon className="h-5 w-5 text-rose-500" />
                Your picture
              </h2>

              {previewUrl ? (
                <div className="space-y-4">
                  <img
                    src={previewUrl}
                    alt="The picture you uploaded"
                    className="mx-auto max-h-56 w-auto rounded-2xl border border-slate-200 object-contain shadow-sm"
                  />
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-xs uppercase tracking-wide text-slate-400">Image</dt>
                      <dd className="font-medium text-slate-700">
                        {imageSize ? `${imageSize.width} × ${imageSize.height}` : '—'}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-xs uppercase tracking-wide text-slate-400">Grid</dt>
                      <dd className="font-medium text-slate-700">
                        {projectedGrid ? `${projectedGrid.cols} × ${projectedGrid.rows}` : '—'}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={open}
                      className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                    >
                      Choose another
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={open}
                  className={`flex h-64 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center transition ${
                    isDragActive
                      ? 'border-rose-400 bg-rose-50'
                      : 'border-slate-300 hover:border-rose-300 hover:bg-rose-50/50'
                  }`}
                >
                  <Upload className="mb-3 h-10 w-10 text-rose-400" />
                  <span className="font-medium text-slate-700">
                    {isDragActive ? 'Drop it here' : 'Drop an image, or click to choose'}
                  </span>
                  <span className="mt-1 text-sm text-slate-400">
                    PNG, JPEG, GIF or WebP &middot; up to 25 MB
                  </span>
                </button>
              )}
            </div>
          </section>

          {/* ---------------- settings ---------------- */}
          <section className="lg:col-span-3">
            <div className="h-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-800">
                <Sparkles className="h-5 w-5 text-sky-500" />
                Settings
              </h2>

              <div className="space-y-6">
                <Slider
                  icon={<Grid3x3 className="h-4 w-4" />}
                  label="Detail"
                  value={detail}
                  min={DETAIL_LIMITS.min}
                  max={DETAIL_LIMITS.max}
                  onChange={setDetail}
                  display={
                    projectedGrid ? `${projectedGrid.cols} × ${projectedGrid.rows} cells` : `${detail}`
                  }
                  hint={
                    analysis
                      ? `Suggested for this picture: around ${analysis.suggestedDetail}`
                      : 'Higher means smaller cells and more work to colour in'
                  }
                />

                <Slider
                  icon={<Palette className="h-4 w-4" />}
                  label="Colours"
                  value={maxColors}
                  min={COLOR_LIMITS.min}
                  max={COLOR_LIMITS.max}
                  onChange={setMaxColors}
                  display={
                    result ? `${result.palette.length} used of ${maxColors}` : `${maxColors}`
                  }
                  hint="The best-fitting colours for your picture are picked automatically"
                />

                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-slate-700">Colour set</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {PALETTE_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setPaletteId(option.id)}
                        aria-pressed={paletteId === option.id}
                        className={`rounded-xl border p-3 text-left transition ${
                          paletteId === option.id
                            ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="block text-sm font-medium text-slate-800">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                          {option.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <Slider
                  icon={<Sparkles className="h-4 w-4" />}
                  label="Simplify"
                  value={smoothing}
                  min={0}
                  max={3}
                  onChange={setSmoothing}
                  display={['Off', 'Light', 'Medium', 'Strong'][smoothing]}
                  hint="Cleans up lone speckled cells that are fiddly to colour"
                />
              </div>
            </div>
          </section>
        </div>

        {/* ---------------- result ---------------- */}
        {(result || busy) && (
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                Preview
                {busy && <Loader2 className="h-4 w-4 animate-spin text-sky-500" />}
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="View mode">
                  {(['color', 'outline'] as RenderMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      aria-pressed={viewMode === mode}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        viewMode === mode
                          ? 'bg-white text-slate-800 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {mode === 'color' ? 'Coloured' : 'To print'}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowNumbers((v) => !v)}
                  aria-pressed={showNumbers}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                    showNumbers
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <Hash className="h-4 w-4" />
                  Numbers
                </button>

                <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                    className="rounded-lg p-1.5 text-slate-600 hover:bg-white"
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center text-xs font-medium tabular-nums text-slate-600">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                    className="rounded-lg p-1.5 text-slate-600 hover:bg-white"
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {result ? (
              <>
                <GridPreview
                  result={result}
                  mode={viewMode}
                  showNumbers={showNumbers}
                  zoom={zoom}
                />

                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Colour key
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {result.palette.map((entry) => (
                      <li
                        key={entry.index}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-1.5 pr-3"
                      >
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold shadow-inner"
                          style={{ backgroundColor: entry.hex, color: entry.ink }}
                        >
                          {entry.index}
                        </span>
                        <span className="text-sm text-slate-700">{entry.name}</span>
                        <span className="text-xs tabular-nums text-slate-400">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handlePdf}
                    disabled={exporting}
                    className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
                  >
                    {exporting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <FileDown className="h-5 w-5" />
                    )}
                    {exporting ? 'Building PDF…' : 'Download PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePng}
                    className="flex items-center gap-2 rounded-xl bg-slate-100 px-5 py-2.5 font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    <Download className="h-5 w-5" />
                    Download PNG
                  </button>
                </div>
              </>
            ) : (
              <div className="flex h-56 items-center justify-center text-slate-400">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Building your grid…
              </div>
            )}
          </section>
        )}

        <footer className="mt-10 text-center text-sm text-slate-400">
          Everything runs in your browser &mdash; your pictures are never uploaded.
        </footer>
      </div>
    </div>
  );
}

interface SliderProps {
  icon: ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  display: string;
  hint: string;
}

function Slider({ icon, label, value, min, max, onChange, display, hint }: SliderProps) {
  const id = `slider-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <span className="text-slate-400">{icon}</span>
          {label}
        </label>
        <span className="text-sm font-medium tabular-nums text-slate-500">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-sky-500"
      />
      <p className="mt-1.5 text-xs text-slate-400">{hint}</p>
    </div>
  );
}

/** Read intrinsic pixel dimensions without keeping the decoded bitmap around. */
const readDimensions = async (file: Blob): Promise<{ width: number; height: number }> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    .catch(() => createImageBitmap(file))
    .catch(() => null);
  if (!bitmap) return { width: 0, height: 0 };
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return size;
};

const messageFor = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'Something went wrong while processing that image.';

export default App;
