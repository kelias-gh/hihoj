import * as THREE from 'three';
import { CountryLabel } from './types';

interface Line {
  k: number;
  m: number;
  type: 'YKX' | 'XKY';
}

function leastSquaresFit(n: number, sumXY: number, sumX: number, sumY: number, sumXSqr: number): [number, number] {
  if (n < 2) return [0, 0];
  const denom = n * sumXSqr - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return [0, sumY / n];
  const k = (n * sumXY - sumX * sumY) / denom;
  return [k, (sumY - k * sumX) / n];
}

function analyzeCountryPixels(pixelData: Uint8Array, width: number, height: number, targetColor: THREE.Color, sampleRate = 4) {
  const targetR = Math.round(targetColor.r * 255);
  const targetG = Math.round(targetColor.g * 255);
  const targetB = Math.round(targetColor.b * 255);
  const tolerance = 5;

  let sumX = 0, sumY = 0, sumXSqr = 0, sumYSqr = 0, sumXY = 0, count = 0;

  for (let y = 0; y < height; y += sampleRate) {
    for (let x = 0; x < width; x += sampleRate) {
      const idx = (y * width + x) * 4;
      if (Math.abs(pixelData[idx] - targetR) <= tolerance &&
          Math.abs(pixelData[idx + 1] - targetG) <= tolerance &&
          Math.abs(pixelData[idx + 2] - targetB) <= tolerance) {
        sumX += x; sumY += y;
        sumXSqr += x * x; sumYSqr += y * y;
        sumXY += x * y; count++;
      }
    }
  }

  if (count < 10) return null;

  const [kYKX, mYKX] = leastSquaresFit(count, sumXY, sumX, sumY, sumXSqr);
  const [kXKY, mXKY] = leastSquaresFit(count, sumXY, sumY, sumX, sumYSqr);

  return {
    lineYKX: { k: kYKX, m: mYKX, type: 'YKX' as const },
    lineXKY: { k: kXKY, m: mXKY, type: 'XKY' as const },
  };
}

function traceLineSegment(pixelData: Uint8Array, width: number, height: number, targetColor: THREE.Color, line: Line) {
  const targetR = Math.round(targetColor.r * 255);
  const targetG = Math.round(targetColor.g * 255);
  const targetB = Math.round(targetColor.b * 255);
  const tolerance = 5;

  const isValid = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
    return Math.abs(pixelData[idx] - targetR) <= tolerance &&
           Math.abs(pixelData[idx + 1] - targetG) <= tolerance &&
           Math.abs(pixelData[idx + 2] - targetB) <= tolerance;
  };

  const segments: { start: THREE.Vector2; end: THREE.Vector2; length: number }[] = [];
  let start: THREE.Vector2 | null = null;
  let end: THREE.Vector2 | null = null;

  const iterate = line.type === 'YKX'
    ? (i: number) => [i, line.k * i + line.m] as const
    : (i: number) => [line.k * i + line.m, i] as const;
  const max = line.type === 'YKX' ? width : height;

  for (let i = 0; i < max; i++) {
    const [x, y] = iterate(i);
    if (isValid(x, y)) {
      if (!start) start = new THREE.Vector2(x, y);
      end = new THREE.Vector2(x, y);
    } else if (start && end) {
      segments.push({ start, end, length: start.distanceTo(end) });
      start = end = null;
    }
  }
  if (start && end) segments.push({ start, end, length: start.distanceTo(end) });

  return segments.length ? segments.reduce((a, b) => b.length > a.length ? b : a) : null;
}

function normalizeTextDirection(start: THREE.Vector2, end: THREE.Vector2) {
  let angle = Math.atan2(end.y - start.y, end.x - start.x);
  if (angle > Math.PI / 2) return { start: end.clone(), end: start.clone(), angle: angle - Math.PI };
  if (angle < -Math.PI / 2) return { start: end.clone(), end: start.clone(), angle: angle + Math.PI };
  return { start: start.clone(), end: end.clone(), angle };
}

function findBestLine(pixelData: Uint8Array, width: number, height: number, targetColor: THREE.Color, lineYKX: Line, lineXKY: Line) {
  const offsets = [-30, -15, 0, 15, 30];
  const candidates: { start: THREE.Vector2; end: THREE.Vector2; length: number }[] = [];

  for (const offset of offsets) {
    const segYKX = traceLineSegment(pixelData, width, height, targetColor, { ...lineYKX, m: lineYKX.m + offset });
    const segXKY = traceLineSegment(pixelData, width, height, targetColor, { ...lineXKY, m: lineXKY.m + offset });
    if (segYKX) candidates.push(segYKX);
    if (segXKY) candidates.push(segXKY);
  }

  if (!candidates.length) return null;
  const best = candidates.reduce((a, b) => b.length > a.length ? b : a);
  return normalizeTextDirection(best.start, best.end);
}

function generateTextPositions(start: THREE.Vector2, end: THREE.Vector2, charCount: number, width: number, height: number) {
  if (charCount < 1) return [];

  const dir = end.clone().sub(start);
  const len = dir.length();
  dir.normalize();

  const padding = 0.1;
  const paddedStart = start.clone().add(dir.clone().multiplyScalar(len * padding));
  const paddedEnd = end.clone().sub(dir.clone().multiplyScalar(len * padding));

  const positions: THREE.Vector2[] = [];
  for (let i = 0; i < charCount; i++) {
    const t = charCount > 1 ? i / (charCount - 1) : 0.5;
    const pos = paddedStart.clone().lerp(paddedEnd, t);
    positions.push(new THREE.Vector2(pos.x / width, 1 - pos.y / height));
  }
  return positions;
}

export function createCountryLabel(pixelData: Uint8Array, width: number, height: number, targetColor: THREE.Color, name: string): CountryLabel | null {
  const analysis = analyzeCountryPixels(pixelData, width, height, targetColor);
  if (!analysis) return null;

  const bestLine = findBestLine(pixelData, width, height, targetColor, analysis.lineYKX, analysis.lineXKY);
  if (!bestLine) return null;

  return {
    color: targetColor.clone(),
    name,
    positions: generateTextPositions(bestLine.start, bestLine.end, name.length, width, height),
    angle: bestLine.angle,
  };
}
