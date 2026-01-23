import * as THREE from 'three';
import { MapSaveData, City } from './types';

export type { MapSaveData } from './types';

export function saveMapToFile(
  pixelData: Uint8Array,
  width: number,
  height: number,
  countries: Map<string, { name: string; color: THREE.Color }>,
  cities: Map<string, City>,
  cityIdCounter: number
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = ((height - 1 - y) * width + x) * 4;
      imgData.data[dst] = pixelData[src];
      imgData.data[dst + 1] = pixelData[src + 1];
      imgData.data[dst + 2] = pixelData[src + 2];
      imgData.data[dst + 3] = pixelData[src + 3];
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const saveData: MapSaveData = {
    version: 1,
    width,
    height,
    imageData: canvas.toDataURL('image/png'),
    countries: Array.from(countries.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      color: { r: data.color.r, g: data.color.g, b: data.color.b },
    })),
    cities: Array.from(cities.entries()).map(([id, city]) => ({
      id,
      name: city.name,
      size: city.size,
      position: { x: city.position.x, y: city.position.y },
    })),
    cityIdCounter,
  };

  const blob = new Blob([JSON.stringify(saveData)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.map';
  a.click();
  URL.revokeObjectURL(url);
}

export function parseMapFile(json: string): MapSaveData | null {
  const data: MapSaveData = JSON.parse(json);
  if (data.version !== 1 && data.version !== 2) return null;
  return data;
}

export function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = base64;
  });
}
