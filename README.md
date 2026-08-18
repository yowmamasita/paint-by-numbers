# paint-by-numbers

Turns a picture into a printable paint-by-numbers sheet with a matching colour
key. Everything runs client-side — no image ever leaves the browser.

Live at <https://paintbynumbers.sarmiento.cc/>.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # -> dist/
npm run lint
```

Deployed with Docker Compose (multi-stage build, nginx serving `dist/`):

```bash
docker compose up -d --build prod   # published on :8124
```

## How it works

1. **Decode** — the image is decoded with `createImageBitmap`, honouring EXIF
   orientation, and composited over white so transparent PNGs behave.
2. **Sample** — it is redrawn at exactly `cols x rows x perCell` pixels so every
   grid cell gets the same number of samples and no edge strip is lost. Cell
   colour is the mean in *linear light*, not gamma space.
3. **Choose a palette** — cell colours are binned into a weighted histogram in
   CIE L\*a\*b\*, then either
   - a subset of a fixed crayon set is chosen by greedy forward selection plus a
     swap-improvement pass, minimising total CIEDE2000 error, or
   - a palette is generated with weighted k-means++ ("Match my photo").
4. **Assign & clean up** — each cell takes its nearest palette colour by
   CIEDE2000; an optional majority filter removes lone speckles.
5. **Render** — a device-pixel-ratio-aware canvas for the preview, and a jsPDF
   sheet whose orientation follows the picture.

Heavy work runs in a Web Worker (`processor.worker.ts`) so the UI stays
responsive; it falls back to the main thread if Workers are unavailable.

### Layout

| File | Role |
| --- | --- |
| `src/color.ts` | sRGB ↔ linear ↔ Lab, CIEDE2000, contrast |
| `src/colors.ts` | Crayola 24 and Vivid 24 palettes |
| `src/quantize.ts` | histogram, palette selection, k-means, colour naming |
| `src/ImageProcessor.ts` | sampling, assignment, smoothing, legend |
| `src/render.ts` | shared canvas renderer (preview + PNG export) |
| `src/PDFGenerator.ts` | printable sheet + colour reference page |
| `src/useProcessor.ts` | Worker plumbing with a main-thread fallback |

### Notes

- `jspdf` is imported dynamically; it pulls in html2canvas and dompurify, which
  would otherwise triple the initial bundle for a feature used at the very end.
- Colour distance is CIEDE2000 throughout. The implementation is verified
  against the Sharma et al. reference dataset.
