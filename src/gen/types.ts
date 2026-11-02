/**
 * Shared level-generation types (spec 4.2). A LevelPlan is pure data: it is produced by a
 * deterministic generator, checked by headless validators, walked by the bot, and turned into
 * meshes by the builder. Units are metres; Y is up; rooms are axis-aligned rectangles in X/Z.
 */
import type { DifficultyId } from '../core/difficulty';
import type { TexKind } from './textures';

export interface Vec2 { x: number; z: number }

export interface Room {
  id: number;
  /** Min corner and size in metres. */
  x: number; z: number; w: number; d: number;
  kind: 'start' | 'exit' | 'hall' | 'room' | 'supply' | 'nest' | 'dead';
  height: number;
  /** Visual/material variant index within the level. */
  variant: number;
}

export interface Connection {
  id: number;
  a: number; b: number;
  /** Door centre in world space and which axis the wall runs along. */
  door: Vec2;
  axis: 'x' | 'z';
  width: number;
  /** Lock id requiring a key with the same id; null if open. */
  lock: string | null;
}

export type ItemKind = 'key' | 'tool' | 'loot' | 'note';
export interface ItemSpawn { id: string; item: string; kind: ItemKind; room: number; pos: Vec2; unlocks?: string }
export interface Waypoint { room: number; pos: Vec2; /** 0..1 progress along the critical path. */ t: number }
export interface EntitySlot { room: number; pos: Vec2; role: 'nest' | 'patrol' | 'ambush'; /** entity def id (levels with an ecology set it) */ entity?: string }
export interface HubData {
  /** Doors in campaign order; `yaw` is the direction a player faces to look at the door from the tunnel. */
  doors: { index: number; room: number; pos: Vec2; yaw: number; side: 'N' | 'S' }[];
  stations: { kind: 'stash' | 'noteboard' | 'bestiary' | 'gallery' | 'camcorder' | 'kitchen' | 'crafting'; room: number; pos: Vec2; yaw: number }[];
  npcs: { id: string; pos: Vec2; yaw: number }[];
  /** Wing gates: sealed until the act is reached. */
  gates: { act: 2 | 3; box: { x0: number; z0: number; x1: number; z1: number } }[];
  tunnelRoom: number;
}

export interface HideSpot { id: string; room: number; pos: Vec2; kind: 'locker' | 'desk'; /** which way the opening faces (radians) */ yaw: number }
export interface NavNode { id: number; pos: Vec2; room: number; /** room centre, doorway mouth (0.9 m in front of a door) or the door itself */ kind?: 'room' | 'mouth' | 'door'; connection?: number }
export interface NavEdge { a: number; b: number; cost: number; connection?: number }

export interface LevelPlan {
  levelId: string;
  seed: number;
  tier: 'chill' | 'uneasy' | 'tense' | 'horror';
  bounds: { x0: number; z0: number; x1: number; z1: number };
  rooms: Room[];
  connections: Connection[];
  spawn: { room: number; pos: Vec2 };
  exit: { room: number; pos: Vec2 };
  /** Room ids from spawn to exit. */
  criticalPath: number[];
  /** Always the max set of waypoint candidates; difficulty selects a subset (layout never changes). */
  waypoints: Waypoint[];
  items: ItemSpawn[];
  hides?: HideSpot[];
  /** Central Hub data (doors, stations, NPC spots); only present on the hub plan. */
  hub?: HubData;
  entitySlots: EntitySlot[];
  nav: { nodes: NavNode[]; edges: NavEdge[] };
  /** Estimated minutes-of-play seconds for a competent player. */
  estSeconds: number;
  /** 0..1 size factor used to pick waypoint counts. */
  size: number;
}

export interface GenParams {
  difficulty?: DifficultyId;
  /** Free-form level specific overrides. */
  [k: string]: unknown;
}

export type QualityLevel = 0 | 1 | 2 | 3 | 4; // potato..ultra

/** Visual identity of a level: materials, fog, light colour and grading (spec 6.1). */
export interface LevelLook {
  walls: [TexKind, number][];       // up to 4 variants
  floor: [TexKind, number];
  ceiling: [TexKind, number];
  trim: [TexKind, number];
  fogColor: number; fogDensity: number;
  ambient: number; ambientIntensity: number;
  lampColor: number;
  /** Colour grade applied in the VHS pass: tint multiplier, saturation, contrast. */
  grade: { tint: [number, number, number]; saturation: number; contrast: number };
  dust: number; // particle colour
}

export interface LevelDef {
  id: string;
  name: string;
  act: 0 | 1 | 2 | 3;
  tier: LevelPlan['tier'];
  /** Dev-only levels (test room, placeholder) are excluded from the campaign and the hub. */
  dev?: boolean;
  /** Door look/hint for the hub. */
  door: { color: string; icon: string };
  /** Target traversal time window [min, max] seconds, checked by the validator. */
  targetSeconds: [number, number];
  /** Intensity dial 0-1 (spec 7.2). */
  intensity: number;
  look: LevelLook;
  generate(seed: number, params?: GenParams): LevelPlan;
}
