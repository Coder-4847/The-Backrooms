/** Selecting which waypoint candidates are active for a difficulty (layout itself never changes). */
import { DIFFICULTY_ORDER, waypointCountFor, type DifficultyId } from '../core/difficulty';
import type { LevelPlan, Waypoint } from './types';

export function waypointsFor(plan: LevelPlan, difficulty: DifficultyId): Waypoint[] {
  const n = plan.waypoints.length;
  const k = Math.min(n, waypointCountFor(difficulty, plan.size));
  if (k <= 0) return [];
  if (k >= n) return plan.waypoints;
  if (k === 1) return [plan.waypoints[Math.floor(n / 2)]];
  return Array.from({ length: k }, (_, i) => plan.waypoints[Math.round((i * (n - 1)) / (k - 1))]);
}

export { DIFFICULTY_ORDER };
