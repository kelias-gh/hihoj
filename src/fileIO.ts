import * as THREE from 'three';

export interface CityData {
  position: THREE.Vector2;
  name: string;
  size: number;
}

export interface CountryData {
  id: string;
  name: string;
  color: THREE.Color;
}

export interface MapSaveData {
  version: number;
  width: number;
  height: number;
  imageData: string;
  countries: Array<{
    id: string;
    name: string;
    color: { r: number; g: number; b: number };
  }>;
  cities: Array<{
    id: string;
    name: string;
    size: number;
    position: { x: number; y: number };
  }>;
  cityIdCounter: number;
}

export function saveMapToFile(
  pixelData: Uint8Array,
  width: number,
  height: number,
  countries: Map<string, { name: string; color: THREE.Color }>,
  cities: Map<string, CityData>,
  cityIdCounter: number
): void {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext('2d')!;

  const imageData = ctx.createImageData(width, height);

  // Copy and flip Y (WebGL has Y=0 at bottom, canvas has Y=0 at top)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = ((height - 1 - y) * width + x) * 4;
      imageData.data[dstIdx] = pixelData[srcIdx];
      imageData.data[dstIdx + 1] = pixelData[srcIdx + 1];
      imageData.data[dstIdx + 2] = pixelData[srcIdx + 2];
      imageData.data[dstIdx + 3] = pixelData[srcIdx + 3];
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const imageBase64 = tempCanvas.toDataURL('image/png');

  const saveData: MapSaveData = {
    version: 1,
    width,
    height,
    imageData: imageBase64,
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

export function parseMapFile(jsonString: string): MapSaveData | null {
  try {
    const data: MapSaveData = JSON.parse(jsonString);
    if (data.version !== 1) {
      console.error('Unsupported save file version');
      return null;
    }
    return data;
  } catch (err) {
    console.error('Failed to parse map file:', err);
    return null;
  }
}

export function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = base64;
  });
}
