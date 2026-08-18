/// <reference lib="webworker" />
import {
  analyzeImageComplexity,
  processImage,
  type ImageAnalysis,
  type PaintByNumbers,
  type ProcessOptions,
} from './ImageProcessor';

export type WorkerRequest =
  | { id: number; kind: 'analyze'; file: Blob }
  | { id: number; kind: 'process'; file: Blob; options: ProcessOptions };

export type WorkerResponse =
  | { id: number; ok: true; kind: 'analyze'; data: ImageAnalysis }
  | { id: number; ok: true; kind: 'process'; data: PaintByNumbers }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === 'analyze') {
      const data = await analyzeImageComplexity(request.file);
      const response: WorkerResponse = { id: request.id, ok: true, kind: 'analyze', data };
      self.postMessage(response);
    } else {
      const data = await processImage(request.file, request.options);
      const response: WorkerResponse = { id: request.id, ok: true, kind: 'process', data };
      self.postMessage(response);
    }
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Something went wrong while processing.',
    };
    self.postMessage(response);
  }
};
