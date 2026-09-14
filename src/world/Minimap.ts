import { PALETTE } from '@/rendering/palette';
import { BUILDINGS } from './Buildings';
import { CREEK, ISLAND_HALF, LANDMARKS, PATHS, SEA_LEVEL, sampleSurface } from './heightfield';

export interface MapPin {
  x: number;
  y: number;
  label: string;
  color: string;
  player?: boolean;
}

/**
 * Draws the island map from the same heightfield the world is built from, so
 * the map is always accurate rather than a separately-maintained picture.
 */
export function drawIslandMap(
  canvas: HTMLCanvasElement,
  player: { x: number; z: number },
  options: { works: { bridge: boolean; stairs: boolean; lighthouse: boolean } },
): MapPin[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  const width = canvas.width;
  const height = canvas.height;
  const extent = ISLAND_HALF * 2 + 20;
  const toCanvasX = (x: number) => ((x + extent / 2) / extent) * width;
  const toCanvasY = (z: number) => ((z + extent / 2) / extent) * height;

  // --- Terrain ------------------------------------------------------------
  // Sampled at a coarse step and drawn as blocks: fast, and the chunky look
  // suits a hand-drawn island map.
  const step = 4;
  const worldStep = (extent / width) * step;
  for (let py = 0; py < height; py += step) {
    for (let px = 0; px < width; px += step) {
      const wx = (px / width) * extent - extent / 2;
      const wz = (py / height) * extent - extent / 2;
      const sample = sampleSurface(wx, wz);

      let color: string;
      if (sample.height < SEA_LEVEL - 4) color = '#2f6f92';
      else if (sample.height < SEA_LEVEL - 0.6) color = '#59a8c4';
      else if (sample.height < SEA_LEVEL + 0.1) color = '#8fd0e0';
      else if (sample.surface === 'sand') color = PALETTE.sand.base;
      else if (sample.surface === 'path' || sample.surface === 'plaza') color = PALETTE.dirt.path;
      else if (sample.surface === 'rock') color = PALETTE.rock.base;
      else if (sample.surface === 'dirt') color = PALETTE.dirt.base;
      else {
        // Shade grass by elevation so the ridge reads as high ground.
        const t = Math.min(1, sample.height / 20);
        color = t > 0.55 ? '#7fa86a' : t > 0.3 ? PALETTE.grass.base : PALETTE.grass.highlight;
      }
      ctx.fillStyle = color;
      ctx.fillRect(px, py, step, step);
      void worldStep;
    }
  }

  // --- Creek ---------------------------------------------------------------
  ctx.strokeStyle = '#6bc0d8';
  ctx.lineWidth = Math.max(3, (CREEK.width / extent) * width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  CREEK.points.forEach((point, index) => {
    const x = toCanvasX(point.x);
    const y = toCanvasY(point.z);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // --- Paths ---------------------------------------------------------------
  ctx.strokeStyle = 'rgba(220, 200, 160, 0.9)';
  ctx.lineWidth = Math.max(2.5, (3.2 / extent) * width);
  for (const path of PATHS) {
    ctx.beginPath();
    ctx.moveTo(toCanvasX(path.ax), toCanvasY(path.az));
    ctx.lineTo(toCanvasX(path.bx), toCanvasY(path.bz));
    ctx.stroke();
  }

  // --- Coast outline -------------------------------------------------------
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // --- Pins ----------------------------------------------------------------
  const pins: MapPin[] = [];
  const buildingColors: Record<string, string> = {
    playerHome: '#e0b45f',
    museum: '#7fa8c4',
    store: '#c9784f',
    townHall: '#7fa86a',
    lighthouse: '#d9705f',
  };

  for (const building of BUILDINGS) {
    if (building.id === 'lighthouse' && !options.works.lighthouse) continue;
    const color = buildingColors[building.id];
    if (!color) continue;
    pins.push({
      x: toCanvasX(building.x),
      y: toCanvasY(building.z),
      label: building.name.replace('Cozy Cove ', ''),
      color,
    });
  }

  for (const key of ['beach.pier', 'meadow.high', 'farm.terrace', 'grove.west', 'orchard.secret']) {
    const landmark = LANDMARKS[key];
    if (!landmark) continue;
    pins.push({ x: toCanvasX(landmark.x), y: toCanvasY(landmark.z), label: landmark.label, color: '#5c6a6b' });
  }

  pins.push({ x: toCanvasX(player.x), y: toCanvasY(player.z), label: 'You', color: '#2f8fa8', player: true });

  return pins;
}
