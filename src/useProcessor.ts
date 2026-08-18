import { useCallback, useEffect, useRef } from 'react';
import {
  analyzeImageComplexity,
  processImage,
  type ImageAnalysis,
  type PaintByNumbers,
  type ProcessOptions,
} from './ImageProcessor';
import type { WorkerRequest, WorkerResponse } from './processor.worker';

/** `Omit` collapses a union to its shared keys; distribute it instead. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Pending = {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
};

/**
 * Runs image work off the main thread so the UI stays responsive while a large
 * grid is being built. Falls back to running inline if Workers are unavailable.
 */
export const useProcessor = () => {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, Pending>());
  const nextIdRef = useRef(1);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      workerRef.current = null;
      return;
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const pending = pendingRef.current.get(message.id);
      if (!pending) return;
      pendingRef.current.delete(message.id);

      if (message.ok) pending.resolve(message.data as never);
      else pending.reject(new Error(message.error));
    };

    worker.onerror = () => {
      // Let every in-flight call fall back to the main thread.
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error('WORKER_UNAVAILABLE'));
      }
      pendingRef.current.clear();
      workerRef.current = null;
    };

    workerRef.current = worker;
    const pending = pendingRef.current;

    return () => {
      worker?.terminate();
      workerRef.current = null;
      pending.clear();
    };
  }, []);

  const send = useCallback(<T,>(request: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> | null => {
    const worker = workerRef.current;
    if (!worker) return null;

    const id = nextIdRef.current++;
    return new Promise<T>((resolve, reject) => {
      pendingRef.current.set(id, {
        resolve: resolve as Pending['resolve'],
        reject,
      });
      worker.postMessage({ ...request, id } as WorkerRequest);
    });
  }, []);

  const analyze = useCallback(
    async (file: Blob): Promise<ImageAnalysis> => {
      const viaWorker = send<ImageAnalysis>({ kind: 'analyze', file });
      if (viaWorker) {
        try {
          return await viaWorker;
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'WORKER_UNAVAILABLE') throw error;
        }
      }
      return analyzeImageComplexity(file);
    },
    [send],
  );

  const process = useCallback(
    async (file: Blob, options: ProcessOptions): Promise<PaintByNumbers> => {
      const viaWorker = send<PaintByNumbers>({ kind: 'process', file, options });
      if (viaWorker) {
        try {
          return await viaWorker;
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'WORKER_UNAVAILABLE') throw error;
        }
      }
      return processImage(file, options);
    },
    [send],
  );

  return { analyze, process };
};
