import * as THREE from 'three';

export interface CountryLabel {
  color: THREE.Color;
  name: string;
  positions: THREE.Vector2[]; // UV positions along the line for each character
  angle: number; // rotation angle for text
}

export interface Line {
  k: number;
  m: number;
  type: 'YKX' | 'XKY'; // y = kx + m or x = ky + m
}

// Least squares fitting: returns [k, m] for line y = kx + m
function leastSquaresFit(
  n: number,
  sumXY: number,
  sumX: number,
  sumY: number,
  sumXSqr: number
): [number, number] {
  if (n < 2) return [0, 0];

  const denom = n * sumXSqr - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return [0, sumY / n];

  const k = (n * sumXY - sumX * sumY) / denom;
  const m = (sumY - k * sumX) / n;

  return [k, m];
}

// Find all pixels of a given color and compute line fitting data
export function analyzeCountryPixels(
  pixelData: Uint8Array,
  width: number,
  height: number,
  targetColor: THREE.Color,
  sampleRate: number = 4 // Sample every nth pixel for performance
): {
  pixels: THREE.Vector2[];
  lineYKX: Line;
  lineXKY: Line;
  centroid: THREE.Vector2;
} | null {
  const pixels: THREE.Vector2[] = [];

  let sumX = 0;
  let sumY = 0;
  let sumXSqr = 0;
  let sumYSqr = 0;
  let sumXY = 0;
  let count = 0;

  const targetR = Math.round(targetColor.r * 255);
  const targetG = Math.round(targetColor.g * 255);
  const targetB = Math.round(targetColor.b * 255);

  // Tolerance for color matching
  const tolerance = 5;

  for (let y = 0; y < height; y += sampleRate) {
    for (let x = 0; x < width; x += sampleRate) {
      const idx = (y * width + x) * 4;
      const r = pixelData[idx];
      const g = pixelData[idx + 1];
      const b = pixelData[idx + 2];

      if (
        Math.abs(r - targetR) <= tolerance &&
        Math.abs(g - targetG) <= tolerance &&
        Math.abs(b - targetB) <= tolerance
      ) {
        pixels.push(new THREE.Vector2(x, y));

        sumX += x;
        sumY += y;
        sumXSqr += x * x;
        sumYSqr += y * y;
        sumXY += x * y;
        count++;
      }
    }
  }

  if (count < 10) return null;

  // Fit two lines: y = kx + m and x = ky + m
  const [kYKX, mYKX] = leastSquaresFit(count, sumXY, sumX, sumY, sumXSqr);
  const [kXKY, mXKY] = leastSquaresFit(count, sumXY, sumY, sumX, sumYSqr);

  return {
    pixels,
    lineYKX: { k: kYKX, m: mYKX, type: 'YKX' },
    lineXKY: { k: kXKY, m: mXKY, type: 'XKY' },
    centroid: new THREE.Vector2(sumX / count, sumY / count),
  };
}

// Trace a line through the pixel data to find the longest valid segment
function traceLineSegment(
  pixelData: Uint8Array,
  width: number,
  height: number,
  targetColor: THREE.Color,
  line: Line,
  tolerance: number = 5
): { start: THREE.Vector2; end: THREE.Vector2; length: number } | null {
  const targetR = Math.round(targetColor.r * 255);
  const targetG = Math.round(targetColor.g * 255);
  const targetB = Math.round(targetColor.b * 255);

  const segments: { start: THREE.Vector2; end: THREE.Vector2; length: number }[] = [];
  let currentStart: THREE.Vector2 | null = null;
  let currentEnd: THREE.Vector2 | null = null;

  const isValidPixel = (x: number, y: number): boolean => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
    const r = pixelData[idx];
    const g = pixelData[idx + 1];
    const b = pixelData[idx + 2];
    return (
      Math.abs(r - targetR) <= tolerance &&
      Math.abs(g - targetG) <= tolerance &&
      Math.abs(b - targetB) <= tolerance
    );
  };

  if (line.type === 'YKX') {
    // y = kx + m, iterate over x
    for (let x = 0; x < width; x++) {
      const y = line.k * x + line.m;

      if (isValidPixel(x, y)) {
        if (!currentStart) {
          currentStart = new THREE.Vector2(x, y);
        }
        currentEnd = new THREE.Vector2(x, y);
      } else {
        if (currentStart && currentEnd) {
          segments.push({
            start: currentStart,
            end: currentEnd,
            length: currentStart.distanceTo(currentEnd),
          });
        }
        currentStart = null;
        currentEnd = null;
      }
    }
  } else {
    // x = ky + m, iterate over y
    for (let y = 0; y < height; y++) {
      const x = line.k * y + line.m;

      if (isValidPixel(x, y)) {
        if (!currentStart) {
          currentStart = new THREE.Vector2(x, y);
        }
        currentEnd = new THREE.Vector2(x, y);
      } else {
        if (currentStart && currentEnd) {
          segments.push({
            start: currentStart,
            end: currentEnd,
            length: currentStart.distanceTo(currentEnd),
          });
        }
        currentStart = null;
        currentEnd = null;
      }
    }
  }

  // Don't forget the last segment
  if (currentStart && currentEnd) {
    segments.push({
      start: currentStart,
      end: currentEnd,
      length: currentStart.distanceTo(currentEnd),
    });
  }

  if (segments.length === 0) return null;

  // Return the longest segment
  return segments.reduce((best, seg) => (seg.length > best.length ? seg : best));
}

// Find the best line through the country
export function findBestLine(
  pixelData: Uint8Array,
  width: number,
  height: number,
  targetColor: THREE.Color,
  lineYKX: Line,
  lineXKY: Line
): { start: THREE.Vector2; end: THREE.Vector2; angle: number } | null {
  // Create parallel lines with different offsets
  const offsets = [-30, -15, 0, 15, 30];
  const candidates: { start: THREE.Vector2; end: THREE.Vector2; length: number; angle: number }[] = [];

  for (const offset of offsets) {
    // Parallel lines for y = kx + m
    const parallelYKX: Line = { ...lineYKX, m: lineYKX.m + offset };
    const segYKX = traceLineSegment(pixelData, width, height, targetColor, parallelYKX);
    if (segYKX) {
      const angle = Math.atan(lineYKX.k);
      candidates.push({ ...segYKX, angle });
    }

    // Parallel lines for x = ky + m
    const parallelXKY: Line = { ...lineXKY, m: lineXKY.m + offset };
    const segXKY = traceLineSegment(pixelData, width, height, targetColor, parallelXKY);
    if (segXKY) {
      const angle = Math.atan(1 / lineXKY.k);
      candidates.push({ ...segXKY, angle });
    }
  }

  if (candidates.length === 0) return null;

  const best = candidates.reduce((best, c) => (c.length > best.length ? c : best));
  return { start: best.start, end: best.end, angle: best.angle };
}

// Generate positions along the line for each character
export function generateTextPositions(
  start: THREE.Vector2,
  end: THREE.Vector2,
  charCount: number,
  width: number,
  height: number,
  padding: number = 0.1 // Padding from edges as fraction of line length
): THREE.Vector2[] {
  if (charCount < 1) return [];

  const positions: THREE.Vector2[] = [];
  const dir = end.clone().sub(start);
  const lineLength = dir.length();
  dir.normalize();

  // Add padding
  const paddedStart = start.clone().add(dir.clone().multiplyScalar(lineLength * padding));
  const paddedEnd = end.clone().sub(dir.clone().multiplyScalar(lineLength * padding));
  const paddedLength = paddedStart.distanceTo(paddedEnd);

  for (let i = 0; i < charCount; i++) {
    const t = charCount > 1 ? i / (charCount - 1) : 0.5;
    const pos = paddedStart.clone().lerp(paddedEnd, t);

    // Convert to UV coordinates [0, 1]
    positions.push(new THREE.Vector2(pos.x / width, 1 - pos.y / height));
  }

  return positions;
}

// Create a country label from pixel analysis
export function createCountryLabel(
  pixelData: Uint8Array,
  width: number,
  height: number,
  targetColor: THREE.Color,
  name: string
): CountryLabel | null {
  const analysis = analyzeCountryPixels(pixelData, width, height, targetColor);
  if (!analysis) return null;

  const bestLine = findBestLine(
    pixelData,
    width,
    height,
    targetColor,
    analysis.lineYKX,
    analysis.lineXKY
  );

  if (!bestLine) return null;

  const positions = generateTextPositions(
    bestLine.start,
    bestLine.end,
    name.length,
    width,
    height
  );

  return {
    color: targetColor.clone(),
    name,
    positions,
    angle: bestLine.angle,
  };
}
