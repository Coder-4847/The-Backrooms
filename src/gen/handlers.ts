/**
 * Work handlers shared by the Web Worker and the inline fallback: set a plan, mesh a chunk,
 * synthesize a texture. Keeping them here means tests exercise exactly what the worker runs.
 */
import { meshChunk, transferables, type ChunkData } from './mesher';
import { synthTexture, type TexKind, type TexSet } from './textures';
import type { LevelPlan } from './types';

export type WorkRequest =
  | { type: 'plan'; planId: number; plan: LevelPlan }
  | { type: 'chunk'; planId: number; cx: number; cz: number; quality: number }
  | { type: 'texture'; kind: TexKind; seed: number; size: number; variant: number };

export type WorkResult = ChunkData | TexSet | null;

const plans = new Map<number, LevelPlan>();

export function handle(req: WorkRequest): { result: WorkResult; transfer: ArrayBuffer[] } {
  switch (req.type) {
    case 'plan':
      plans.set(req.planId, req.plan);
      if (plans.size > 4) plans.delete(plans.keys().next().value as number);
      return { result: null, transfer: [] };
    case 'chunk': {
      const plan = plans.get(req.planId);
      if (!plan) throw new Error(`unknown plan ${req.planId}`);
      const data = meshChunk(plan, req.cx, req.cz, { level: req.quality });
      return { result: data, transfer: transferables(data) };
    }
    case 'texture': {
      const t = synthTexture(req.kind, req.seed, req.size, req.variant);
      return { result: t, transfer: [t.albedo.buffer as ArrayBuffer, t.normal.buffer as ArrayBuffer, t.orm.buffer as ArrayBuffer] };
    }
  }
}
