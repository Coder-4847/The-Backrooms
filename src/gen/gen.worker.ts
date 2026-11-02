/// <reference lib="webworker" />
/** Web Worker entry: runs shared handlers and returns results with transferable buffers. */
import { handle, type WorkRequest } from './handlers';

self.onmessage = (e: MessageEvent<{ id: number; req: WorkRequest }>) => {
  const { id, req } = e.data;
  try {
    const { result, transfer } = handle(req);
    (self as unknown as Worker).postMessage({ id, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
