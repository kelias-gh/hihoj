import * as THREE from 'three';
import { DiplomacyState, isAtWar } from './diplomacy';

export interface ConquestResult {
  pixelsPainted: number;
  needsUpdate: boolean;
}

export function conquestAlongPath(
  pixelData: Uint8Array,
  width: number,
  height: number,
  path: THREE.Vector2[],
  color: THREE.Color,
  radius: number,
  diplomacy: DiplomacyState,
  countryId: string
): ConquestResult {
  const pr = Math.round(color.r * 255);
  const pg = Math.round(color.g * 255);
  const pb = Math.round(color.b * 255);
  let painted = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const startPx = new THREE.Vector2(path[i].x * width, (1 - path[i].y) * height);
    const endPx = new THREE.Vector2(path[i + 1].x * width, (1 - path[i + 1].y) * height);
    const steps = Math.max(1, Math.ceil(startPx.distanceTo(endPx)));

    for (let t = 0; t <= steps; t++) {
      const pos = startPx.clone().lerp(endPx, t / steps);

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;

          const px = Math.floor(pos.x + dx);
          const py = Math.floor(pos.y + dy);
          if (px < 0 || px >= width || py < 0 || py >= height) continue;

          const idx = (py * width + px) * 4;
          const er = pixelData[idx], eg = pixelData[idx + 1], eb = pixelData[idx + 2];

          if (er === pr && eg === pg && eb === pb) continue;
          if (er > 240 && eg > 240 && eb > 240) continue;
          if (er < 15 && eg < 15 && eb < 15) continue;
          if (!isAtWar(diplomacy, countryId, `${er}_${eg}_${eb}`)) continue;

          pixelData[idx] = pr;
          pixelData[idx + 1] = pg;
          pixelData[idx + 2] = pb;
          pixelData[idx + 3] = 255;
          painted++;
        }
      }
    }
  }

  return { pixelsPainted: painted, needsUpdate: painted > 0 };
}
