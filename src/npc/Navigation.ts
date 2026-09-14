import { ISLAND_HALF, isWalkable, sampleWalkSurface } from '@/world/heightfield';

export interface NavPoint {
  x: number;
  z: number;
}

interface Node {
  index: number;
  g: number;
  f: number;
  parent: number;
}

/**
 * Grid navigation for villagers.
 *
 * The grid is baked once from the same walkability function the player uses, so
 * NPCs and the player agree on what counts as ground. Paths are A*-searched
 * then string-pulled, which is why villagers follow the roads and walk around
 * the museum instead of clipping through it.
 */
export class Navigation {
  readonly cellSize: number;
  readonly width: number;
  /** 0 = blocked, otherwise the traversal cost multiplier. */
  private cost: Float32Array;
  private origin: number;

  constructor(cellSize = 1.8) {
    this.cellSize = cellSize;
    this.origin = -ISLAND_HALF;
    this.width = Math.ceil((ISLAND_HALF * 2) / cellSize);
    this.cost = new Float32Array(this.width * this.width);
    this.bake();
  }

  private bake(): void {
    for (let gz = 0; gz < this.width; gz++) {
      for (let gx = 0; gx < this.width; gx++) {
        const x = this.origin + (gx + 0.5) * this.cellSize;
        const z = this.origin + (gz + 0.5) * this.cellSize;
        if (!isWalkable(x, z)) {
          this.cost[gz * this.width + gx] = 0;
          continue;
        }
        const sample = sampleWalkSurface(x, z);
        // Villagers prefer paved routes and avoid steep or sandy going, which
        // is what makes them look like they know the island.
        let c = 1;
        if (sample.surface === 'path' || sample.surface === 'plaza' || sample.surface === 'wood') c = 0.55;
        else if (sample.surface === 'sand') c = 1.35;
        else if (sample.surface === 'rock') c = 1.9;
        c *= 1 + sample.slope * 2.2;
        this.cost[gz * this.width + gx] = c;
      }
    }
  }

  /** Marks a circular area impassable — buildings, fountains, rocks. */
  addObstacle(x: number, z: number, radius: number): void {
    const min = this.toGrid(x - radius, z - radius);
    const max = this.toGrid(x + radius, z + radius);
    for (let gz = min.gz; gz <= max.gz; gz++) {
      for (let gx = min.gx; gx <= max.gx; gx++) {
        if (gx < 0 || gz < 0 || gx >= this.width || gz >= this.width) continue;
        const cx = this.origin + (gx + 0.5) * this.cellSize;
        const cz = this.origin + (gz + 0.5) * this.cellSize;
        if (Math.hypot(cx - x, cz - z) <= radius + this.cellSize * 0.4) {
          this.cost[gz * this.width + gx] = 0;
        }
      }
    }
  }

  private toGrid(x: number, z: number): { gx: number; gz: number } {
    return {
      gx: Math.floor((x - this.origin) / this.cellSize),
      gz: Math.floor((z - this.origin) / this.cellSize),
    };
  }

  private toWorld(index: number): NavPoint {
    const gx = index % this.width;
    const gz = Math.floor(index / this.width);
    return {
      x: this.origin + (gx + 0.5) * this.cellSize,
      z: this.origin + (gz + 0.5) * this.cellSize,
    };
  }

  isBlocked(x: number, z: number): boolean {
    const { gx, gz } = this.toGrid(x, z);
    if (gx < 0 || gz < 0 || gx >= this.width || gz >= this.width) return true;
    return this.cost[gz * this.width + gx] === 0;
  }

  /** The closest standable point to `x, z` — the point itself when it is open. */
  snapToOpen(x: number, z: number): NavPoint {
    if (!this.isBlocked(x, z)) return { x, z };
    const index = this.nearestOpen(x, z);
    return index === null ? { x, z } : this.toWorld(index);
  }

  /** Nearest open cell to a point, so a target inside a building still works. */
  private nearestOpen(x: number, z: number): number | null {
    const { gx, gz } = this.toGrid(x, z);
    for (let radius = 0; radius < 14; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= this.width || nz >= this.width) continue;
          const index = nz * this.width + nx;
          if (this.cost[index] > 0) return index;
        }
      }
    }
    return null;
  }

  /**
   * A* between two world points. Returns a smoothed list of waypoints, or an
   * empty array when no route exists.
   */
  findPath(fromX: number, fromZ: number, toX: number, toZ: number): NavPoint[] {
    const start = this.nearestOpen(fromX, fromZ);
    const goal = this.nearestOpen(toX, toZ);
    if (start === null || goal === null) return [];
    // A target inside an obstacle (the fountain's centre is a schedule anchor)
    // is walked to its nearest open cell, never to the raw point: the old
    // behaviour handed back the exact coordinates and marched villagers into
    // the basin.
    const end = this.isBlocked(toX, toZ) ? this.toWorld(goal) : { x: toX, z: toZ };
    if (start === goal) return [end];

    const open: Node[] = [];
    const bestG = new Map<number, number>();
    const cameFrom = new Map<number, number>();
    const closed = new Set<number>();

    const heuristic = (index: number): number => {
      const gx = index % this.width;
      const gz = Math.floor(index / this.width);
      const tx = goal % this.width;
      const tz = Math.floor(goal / this.width);
      // Octile distance, matching the 8-way movement below.
      const dx = Math.abs(gx - tx);
      const dz = Math.abs(gz - tz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };

    open.push({ index: start, g: 0, f: heuristic(start), parent: -1 });
    bestG.set(start, 0);

    let guard = 0;
    const maxIterations = 9000;

    while (open.length > 0 && guard++ < maxIterations) {
      // Linear scan for the lowest f. The grid is small enough that a binary
      // heap costs more in complexity than it saves here.
      let bestIndex = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIndex].f) bestIndex = i;
      }
      const node = open.splice(bestIndex, 1)[0];
      if (closed.has(node.index)) continue;
      closed.add(node.index);
      if (node.parent >= 0) cameFrom.set(node.index, node.parent);

      if (node.index === goal) {
        return this.smooth(this.reconstruct(cameFrom, goal), end.x, end.z);
      }

      const gx = node.index % this.width;
      const gz = Math.floor(node.index / this.width);

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= this.width || nz >= this.width) continue;
          const neighbour = nz * this.width + nx;
          const cellCost = this.cost[neighbour];
          if (cellCost === 0 || closed.has(neighbour)) continue;
          // Do not cut a diagonal past a blocked corner.
          if (dx !== 0 && dz !== 0) {
            if (this.cost[gz * this.width + nx] === 0 || this.cost[nz * this.width + gx] === 0) continue;
          }
          const step = (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * cellCost;
          const g = node.g + step;
          if (g >= (bestG.get(neighbour) ?? Infinity)) continue;
          bestG.set(neighbour, g);
          open.push({ index: neighbour, g, f: g + heuristic(neighbour), parent: node.index });
        }
      }
    }

    return [];
  }

  private reconstruct(cameFrom: Map<number, number>, goal: number): NavPoint[] {
    const points: NavPoint[] = [];
    let current: number | undefined = goal;
    let guard = 0;
    while (current !== undefined && guard++ < 4000) {
      points.push(this.toWorld(current));
      current = cameFrom.get(current);
    }
    return points.reverse();
  }

  /** String-pulls the grid path so villagers walk in straight lines where they can. */
  private smooth(points: NavPoint[], goalX: number, goalZ: number): NavPoint[] {
    if (points.length === 0) return [];
    const result: NavPoint[] = [points[0]];
    let anchor = 0;
    for (let i = 2; i < points.length; i++) {
      if (!this.hasLineOfSight(points[anchor], points[i])) {
        result.push(points[i - 1]);
        anchor = i - 1;
      }
    }
    result.push({ x: goalX, z: goalZ });
    // Drop the starting cell; the agent is already standing there.
    return result.slice(1);
  }

  private hasLineOfSight(a: NavPoint, b: NavPoint): boolean {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(distance / (this.cellSize * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isBlocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
}
