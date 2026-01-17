import * as THREE from 'three';
import {
  quadVert,
  paintFrag,
  borderDetectFrag,
  jfaFrag,
  distanceFieldFrag,
  finalDisplayFrag
} from './shaders';
import { createCountryLabel, CountryLabel } from './countryNaming';
import {
  createTextState,
  addLabel,
  removeLabel,
  addCity,
  removeCity,
  updateVisibility,
  updateAspectRatio,
  clearAll,
  render as renderText,
  getCityMarkers,
  TextState,
  City
} from './textRendering';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const brushSizeSlider = document.getElementById('brush-size') as HTMLInputElement;
const fillBtn = document.getElementById('fill-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const nameBtn = document.getElementById('name-btn') as HTMLButtonElement;
const cityBtn = document.getElementById('city-btn') as HTMLButtonElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
const loadInput = document.getElementById('load-input') as HTMLInputElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const fpsCounter = document.getElementById('fps-counter') as HTMLDivElement;

// Dialog elements
const cityDialog = document.getElementById('city-dialog') as HTMLDivElement;
const cityDialogTitle = document.getElementById('city-dialog-title') as HTMLHeadingElement;
const cityNameInput = document.getElementById('city-name') as HTMLInputElement;
const citySizeSelect = document.getElementById('city-size') as HTMLSelectElement;
const cityDeleteBtn = document.getElementById('city-delete') as HTMLButtonElement;
const cityCancelBtn = document.getElementById('city-cancel') as HTMLButtonElement;
const citySaveBtn = document.getElementById('city-save') as HTMLButtonElement;

const countryDialog = document.getElementById('country-dialog') as HTMLDivElement;
const countryDialogTitle = document.getElementById('country-dialog-title') as HTMLHeadingElement;
const countryNameInput = document.getElementById('country-name') as HTMLInputElement;
const countryDeleteBtn = document.getElementById('country-delete') as HTMLButtonElement;
const countryCancelBtn = document.getElementById('country-cancel') as HTMLButtonElement;
const countrySaveBtn = document.getElementById('country-save') as HTMLButtonElement;

let width = window.innerWidth;
let height = window.innerHeight;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(width, height);
renderer.setPixelRatio(window.devicePixelRatio);

// Fixed camera for paint passes (always identity)
const paintCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// Display camera with zoom/pan
const displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const quad = new THREE.PlaneGeometry(2, 2);

const rtNearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };
const rtFloat = { ...rtNearest, type: THREE.FloatType };

let paintA = new THREE.WebGLRenderTarget(width, height, rtNearest);
let paintB = new THREE.WebGLRenderTarget(width, height, rtNearest);
let jfaA = new THREE.WebGLRenderTarget(width, height, rtFloat);
let jfaB = new THREE.WebGLRenderTarget(width, height, rtFloat);
const distanceFieldRT = new THREE.WebGLRenderTarget(width, height, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.FloatType
});

const paintUniforms = {
  uTexture: { value: paintB.texture },
  uBrushPos: { value: new THREE.Vector2(-1000, -1000) },
  uPrevBrushPos: { value: new THREE.Vector2(-1000, -1000) },
  uBrushColor: { value: new THREE.Color(colorPicker.value) },
  uBrushSize: { value: parseInt(brushSizeSlider.value, 10) },
  uResolution: { value: new THREE.Vector2(width, height) },
};

const paintMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: paintFrag, uniforms: paintUniforms });

const borderUniforms = {
  u_lookUpTex: { value: paintA.texture },
  u_pixelSize: { value: new THREE.Vector2(1 / width, 1 / height) },
};

const borderMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: borderDetectFrag, uniforms: borderUniforms });

const jfaUniforms = {
  u_inputTexture: { value: null as THREE.Texture | null },
  u_stepSize: { value: new THREE.Vector2(1 / width, 1 / height) },
};

const jfaMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: jfaFrag, uniforms: jfaUniforms });

const distUniforms = {
  u_coordTexture: { value: null as THREE.Texture | null },
  maxDistance: { value: 0.008 },
};

const distMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: distanceFieldFrag, uniforms: distUniforms });

const displayUniforms = {
  u_colorMap: { value: paintA.texture },
  u_distanceField: { value: distanceFieldRT.texture },
  u_pixelSize: { value: new THREE.Vector2(1 / width, 1 / height) },
  u_borderColor: { value: new THREE.Vector3(0, 0, 0) },
};

const displayMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: finalDisplayFrag, uniforms: displayUniforms });

const paintScene = new THREE.Scene();
const paintMesh = new THREE.Mesh(quad, paintMat);
paintScene.add(paintMesh);

const displayScene = new THREE.Scene();
displayScene.add(new THREE.Mesh(quad, displayMat));

let isPainting = false;
let isPanning = false;
let isNamingMode = false;
let isCityMode = false;
let isFillMode = false;
let prevPos = new THREE.Vector2(-1000, -1000);
let currPos = new THREE.Vector2(-1000, -1000);
let panStart = new THREE.Vector2();
let needsUpdate = true;

let zoom = 1;
let panX = 0;
let panY = 0;

const jfaSteps = [32, 16, 8, 4, 2, 1];

let textState: TextState = createTextState(width, height);
const countryLabels: Map<string, CountryLabel> = new Map();
const cities: Map<string, City> = new Map();
let cityIdCounter = 0;

let pendingCityPosition: THREE.Vector2 | null = null;
let editingCityId: string | null = null;
let pendingCountryColor: THREE.Color | null = null;
let editingCountryId: string | null = null;

// Create a unique key from a color
function colorToKey(color: THREE.Color): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `${r}_${g}_${b}`;
}

function getPixelColor(canvasX: number, canvasY: number): THREE.Color {
  const pixelBuffer = new Uint8Array(4);
  renderer.setRenderTarget(paintA);
  renderer.readRenderTargetPixels(paintA, Math.floor(canvasX), Math.floor(canvasY), 1, 1, pixelBuffer);
  renderer.setRenderTarget(null);
  return new THREE.Color(pixelBuffer[0] / 255, pixelBuffer[1] / 255, pixelBuffer[2] / 255);
}

function getAllPixels(): Uint8Array {
  const pixelBuffer = new Uint8Array(width * height * 4);
  renderer.setRenderTarget(paintA);
  renderer.readRenderTargetPixels(paintA, 0, 0, width, height, pixelBuffer);
  renderer.setRenderTarget(null);
  return pixelBuffer;
}

function floodFill(startX: number, startY: number, fillColor: THREE.Color): void {
  const pixelData = getAllPixels();
  const x = Math.floor(startX);
  const y = Math.floor(startY);

  if (x < 0 || x >= width || y < 0 || y >= height) return;

  const startIdx = (y * width + x) * 4;
  const targetR = pixelData[startIdx];
  const targetG = pixelData[startIdx + 1];
  const targetB = pixelData[startIdx + 2];

  const fillR = Math.round(fillColor.r * 255);
  const fillG = Math.round(fillColor.g * 255);
  const fillB = Math.round(fillColor.b * 255);

  // Don't fill if clicking on same color
  if (targetR === fillR && targetG === fillG && targetB === fillB) return;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [x, y];

  while (stack.length > 0) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;

    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;

    const idx = cy * width + cx;
    if (visited[idx]) continue;

    const pixelIdx = idx * 4;
    const pr = pixelData[pixelIdx];
    const pg = pixelData[pixelIdx + 1];
    const pb = pixelData[pixelIdx + 2];

    // Check if this pixel matches target color
    if (pr !== targetR || pg !== targetG || pb !== targetB) continue;

    visited[idx] = 1;
    pixelData[pixelIdx] = fillR;
    pixelData[pixelIdx + 1] = fillG;
    pixelData[pixelIdx + 2] = fillB;
    pixelData[pixelIdx + 3] = 255;

    // Add neighbors
    stack.push(cx + 1, cy);
    stack.push(cx - 1, cy);
    stack.push(cx, cy + 1);
    stack.push(cx, cy - 1);
  }

  // Upload modified pixels back to GPU
  const clampedData = new Uint8ClampedArray(pixelData);
  const dataTexture = new THREE.DataTexture(clampedData, width, height, THREE.RGBAFormat);
  dataTexture.needsUpdate = true;

  const copyMat = new THREE.ShaderMaterial({
    vertexShader: quadVert,
    fragmentShader: `
      uniform sampler2D uTexture;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(uTexture, vUv);
      }
    `,
    uniforms: { uTexture: { value: dataTexture } },
  });

  paintMesh.material = copyMat;
  renderer.setRenderTarget(paintA);
  renderer.render(paintScene, paintCamera);
  renderer.setRenderTarget(paintB);
  renderer.render(paintScene, paintCamera);
  renderer.setRenderTarget(null);
  paintMesh.material = paintMat;

  dataTexture.dispose();
  copyMat.dispose();

  needsUpdate = true;
}

// Dialog helpers
function showCityDialog(isEdit: boolean, existingCity?: City): void {
  cityDialogTitle.textContent = isEdit ? 'Edit City' : 'Add City';
  cityDeleteBtn.style.display = isEdit ? 'inline-block' : 'none';
  cityNameInput.value = existingCity?.name || '';
  citySizeSelect.value = String(existingCity?.size || 3);
  cityDialog.classList.remove('hidden');
  cityNameInput.focus();
}

function hideCityDialog(): void {
  cityDialog.classList.add('hidden');
  pendingCityPosition = null;
  editingCityId = null;
}

function showCountryDialog(isEdit: boolean, existingName?: string): void {
  countryDialogTitle.textContent = isEdit ? 'Edit Country' : 'Name Country';
  countryDeleteBtn.style.display = isEdit ? 'inline-block' : 'none';
  countryNameInput.value = existingName || '';
  countryDialog.classList.remove('hidden');
  countryNameInput.focus();
}

function hideCountryDialog(): void {
  countryDialog.classList.add('hidden');
  pendingCountryColor = null;
  editingCountryId = null;
}

// Name a country at the clicked position
function nameCountryAt(canvasX: number, canvasY: number): void {
  const color = getPixelColor(canvasX, canvasY);

  // Don't name white background
  if (color.r > 0.95 && color.g > 0.95 && color.b > 0.95) {
    return;
  }

  const labelId = colorToKey(color);
  const existingLabel = countryLabels.get(labelId);

  pendingCountryColor = color;
  if (existingLabel) {
    editingCountryId = labelId;
    showCountryDialog(true, existingLabel.name);
  } else {
    editingCountryId = null;
    showCountryDialog(false);
  }
}

function saveCountry(): void {
  const name = countryNameInput.value.trim().toUpperCase();
  if (!name || !pendingCountryColor) {
    hideCountryDialog();
    return;
  }

  const pixelData = getAllPixels();
  const label = createCountryLabel(pixelData, width, height, pendingCountryColor, name);

  if (label) {
    const labelId = colorToKey(pendingCountryColor);
    countryLabels.set(labelId, label);
    addLabel(textState, label, labelId);
  }

  hideCountryDialog();
}

function deleteCountry(): void {
  if (editingCountryId) {
    removeLabel(textState, editingCountryId);
    countryLabels.delete(editingCountryId);
  }
  hideCountryDialog();
}

function openCityDialogAt(canvasX: number, canvasY: number): void {
  const uvX = canvasX / width;
  const uvY = 1 - canvasY / height; // Flip Y
  pendingCityPosition = new THREE.Vector2(uvX, uvY);
  editingCityId = null;
  showCityDialog(false);
}

function saveCity(): void {
  const name = cityNameInput.value.trim();
  if (!name) {
    hideCityDialog();
    return;
  }

  const size = parseInt(citySizeSelect.value, 10);

  if (editingCityId) {
    // Update existing city
    const city: City = {
      position: cities.get(editingCityId)!.position,
      name,
      size
    };
    cities.set(editingCityId, city);
    addCity(textState, city, editingCityId);
  } else if (pendingCityPosition) {
    // Create new city
    const city: City = {
      position: pendingCityPosition,
      name,
      size
    };
    const cityId = `city_${cityIdCounter++}`;
    cities.set(cityId, city);
    addCity(textState, city, cityId);
  }

  hideCityDialog();
}

function deleteCity(): void {
  if (editingCityId) {
    removeCity(textState, editingCityId);
    cities.delete(editingCityId);
  }
  hideCityDialog();
}

// Check if click hits a city marker
function screenToWorld(e: MouseEvent): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) / width;
  const sy = (e.clientY - rect.top) / height;

  // Convert to NDC [-1, 1]
  const ndcX = (sx - 0.5) * 2;
  const ndcY = -(sy - 0.5) * 2;

  // Apply camera transform (inverse of what displayCamera does)
  const worldX = ndcX / zoom + panX;
  const worldY = ndcY / zoom - panY;

  return new THREE.Vector2(worldX, worldY);
}

function checkCityClick(e: MouseEvent): string | null {
  const worldPos = screenToWorld(e);
  const markers = getCityMarkers(textState);

  // Check each marker
  for (const marker of markers) {
    const dx = marker.position.x - worldPos.x;
    const dy = marker.position.y - worldPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Get marker size from geometry
    const geometry = marker.geometry as THREE.PlaneGeometry;
    const size = geometry.parameters.width;

    if (dist < size) {
      return marker.userData.cityId;
    }
  }

  return null;
}

function updateDisplayCamera() {
  displayCamera.left = -1 / zoom + panX;
  displayCamera.right = 1 / zoom + panX;
  displayCamera.top = 1 / zoom - panY;
  displayCamera.bottom = -1 / zoom - panY;
  displayCamera.updateProjectionMatrix();
  updateVisibility(textState, zoom);
}

function clear() {
  renderer.setRenderTarget(paintA);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear();
  renderer.setRenderTarget(paintB);
  renderer.clear();
  renderer.setRenderTarget(null);
  needsUpdate = true;

  // Clear country labels
  clearAll(textState);
  countryLabels.clear();
}

function paint() {
  [paintA, paintB] = [paintB, paintA];

  paintUniforms.uTexture.value = paintB.texture;
  paintUniforms.uBrushPos.value.copy(currPos);
  paintUniforms.uPrevBrushPos.value.copy(prevPos);

  paintMesh.material = paintMat;
  renderer.setRenderTarget(paintA);
  renderer.render(paintScene, paintCamera);
  renderer.setRenderTarget(null);

  needsUpdate = true;
}

function runJFA() {
  borderUniforms.u_lookUpTex.value = paintA.texture;
  paintMesh.material = borderMat;
  renderer.setRenderTarget(jfaA);
  renderer.render(paintScene, paintCamera);

  paintMesh.material = jfaMat;
  for (const s of jfaSteps) {
    jfaUniforms.u_inputTexture.value = jfaA.texture;
    jfaUniforms.u_stepSize.value.set(s / width, s / height);
    renderer.setRenderTarget(jfaB);
    renderer.render(paintScene, paintCamera);
    [jfaA, jfaB] = [jfaB, jfaA];
  }

  distUniforms.u_coordTexture.value = jfaA.texture;
  paintMesh.material = distMat;
  renderer.setRenderTarget(distanceFieldRT);
  renderer.render(paintScene, paintCamera);

  renderer.setRenderTarget(null);

  displayUniforms.u_colorMap.value = paintA.texture;
  displayUniforms.u_distanceField.value = distanceFieldRT.texture;
}

function screenToCanvas(e: MouseEvent): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  // Normalized screen coords [0, 1]
  const sx = (e.clientX - rect.left) / width;
  const sy = (e.clientY - rect.top) / height;

  // Convert to canvas pixel coords, accounting for zoom and pan
  const canvasX = (sx - 0.5) * 2 / zoom * width / 2 + width / 2 + panX * width / 2;
  const canvasY = (sy - 0.5) * 2 / zoom * height / 2 + height / 2 + panY * height / 2;

  return new THREE.Vector2(canvasX, height - canvasY);
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    // First check if we clicked on a city marker
    const clickedCityId = checkCityClick(e);
    if (clickedCityId) {
      const city = cities.get(clickedCityId);
      if (city) {
        editingCityId = clickedCityId;
        pendingCityPosition = null;
        showCityDialog(true, city);
      }
      return;
    }

    if (isNamingMode) {
      // Left click in naming mode - name country
      const pos = screenToCanvas(e);
      nameCountryAt(pos.x, pos.y);
      isNamingMode = false;
      nameBtn.textContent = 'Name (Middle-click)';
      canvas.style.cursor = 'crosshair';
    } else if (isCityMode) {
      // Left click in city mode - add city
      const pos = screenToCanvas(e);
      openCityDialogAt(pos.x, pos.y);
      isCityMode = false;
      cityBtn.textContent = 'Add City';
      canvas.style.cursor = 'crosshair';
    } else if (isFillMode) {
      // Left click in fill mode - flood fill
      const pos = screenToCanvas(e);
      const fillColor = new THREE.Color(colorPicker.value);
      floodFill(pos.x, pos.y, fillColor);
    } else {
      isPainting = true;
      currPos = screenToCanvas(e);
      prevPos.copy(currPos);
      paint();
    }
  } else if (e.button === 1) {
    // Middle click - name country
    e.preventDefault();
    const pos = screenToCanvas(e);
    nameCountryAt(pos.x, pos.y);
  } else if (e.button === 2) {
    isPanning = true;
    panStart.set(e.clientX, e.clientY);
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (isPainting) {
    prevPos.copy(currPos);
    currPos = screenToCanvas(e);
    paint();
  }
  if (isPanning) {
    const dx = (e.clientX - panStart.x) / width * 2 / zoom;
    const dy = (e.clientY - panStart.y) / height * 2 / zoom;
    panX -= dx;
    panY -= dy;
    panStart.set(e.clientX, e.clientY);
    updateDisplayCamera();
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) isPainting = false;
  if (e.button === 2) isPanning = false;
});

canvas.addEventListener('mouseleave', () => {
  isPainting = false;
  isPanning = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  zoom *= zoomFactor;
  zoom = Math.max(0.1, Math.min(zoom, 50));
  updateDisplayCamera();
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setSize(width, height);

  paintA.setSize(width, height);
  paintB.setSize(width, height);
  jfaA.setSize(width, height);
  jfaB.setSize(width, height);
  distanceFieldRT.setSize(width, height);

  paintUniforms.uResolution.value.set(width, height);
  borderUniforms.u_pixelSize.value.set(1 / width, 1 / height);
  displayUniforms.u_pixelSize.value.set(1 / width, 1 / height);

  updateAspectRatio(textState, width, height);
  updateDisplayCamera();
  clear();
});

colorPicker.addEventListener('input', (e) => {
  paintUniforms.uBrushColor.value.set((e.target as HTMLInputElement).value);
});

brushSizeSlider.addEventListener('input', (e) => {
  paintUniforms.uBrushSize.value = Number((e.target as HTMLInputElement).value);
});

clearBtn.addEventListener('click', clear);

nameBtn.addEventListener('click', () => {
  isNamingMode = !isNamingMode;
  isCityMode = false;
  isFillMode = false;
  cityBtn.textContent = 'Add City';
  fillBtn.classList.remove('active');
  if (isNamingMode) {
    nameBtn.textContent = 'Click on country...';
    canvas.style.cursor = 'pointer';
  } else {
    nameBtn.textContent = 'Name (Middle-click)';
    canvas.style.cursor = 'crosshair';
  }
});

cityBtn.addEventListener('click', () => {
  isCityMode = !isCityMode;
  isNamingMode = false;
  isFillMode = false;
  nameBtn.textContent = 'Name (Middle-click)';
  fillBtn.classList.remove('active');
  if (isCityMode) {
    cityBtn.textContent = 'Click to place...';
    canvas.style.cursor = 'pointer';
  } else {
    cityBtn.textContent = 'Add City';
    canvas.style.cursor = 'crosshair';
  }
});

fillBtn.addEventListener('click', () => {
  isFillMode = !isFillMode;
  isNamingMode = false;
  isCityMode = false;
  nameBtn.textContent = 'Name (Middle-click)';
  cityBtn.textContent = 'Add City';
  if (isFillMode) {
    fillBtn.classList.add('active');
    canvas.style.cursor = 'crosshair';
  } else {
    fillBtn.classList.remove('active');
    canvas.style.cursor = 'crosshair';
  }
});

// City dialog event listeners
citySaveBtn.addEventListener('click', saveCity);
cityCancelBtn.addEventListener('click', hideCityDialog);
cityDeleteBtn.addEventListener('click', deleteCity);
cityNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveCity();
  if (e.key === 'Escape') hideCityDialog();
});

// Country dialog event listeners
countrySaveBtn.addEventListener('click', saveCountry);
countryCancelBtn.addEventListener('click', hideCountryDialog);
countryDeleteBtn.addEventListener('click', deleteCountry);
countryNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveCountry();
  if (e.key === 'Escape') hideCountryDialog();
});

// Save/Load data structure
interface MapSaveData {
  version: number;
  width: number;
  height: number;
  imageData: string; // Base64 encoded PNG
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

// Save map to file
function saveMap(): void {
  // Create a temporary canvas to get image data
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext('2d')!;

  // Read pixel data from render target
  const pixelData = getAllPixels();

  // Create ImageData and put it on canvas
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

  // Convert to base64 PNG
  const imageBase64 = tempCanvas.toDataURL('image/png');

  // Build save data
  const saveData: MapSaveData = {
    version: 1,
    width,
    height,
    imageData: imageBase64,
    countries: Array.from(countryLabels.entries()).map(([id, label]) => ({
      id,
      name: label.name,
      color: { r: label.color.r, g: label.color.g, b: label.color.b },
    })),
    cities: Array.from(cities.entries()).map(([id, city]) => ({
      id,
      name: city.name,
      size: city.size,
      position: { x: city.position.x, y: city.position.y },
    })),
    cityIdCounter,
  };

  // Create and download file
  const blob = new Blob([JSON.stringify(saveData)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.map';
  a.click();
  URL.revokeObjectURL(url);
}

// Load map from file
function loadMap(file: File): void {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const saveData: MapSaveData = JSON.parse(e.target?.result as string);

      if (saveData.version !== 1) {
        alert('Unsupported save file version');
        return;
      }

      // Clear current state
      clear();
      cities.clear();

      // Load image data
      const img = new Image();
      img.onload = () => {
        // Create a temporary canvas to get pixel data
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const ctx = tempCanvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, img.width, img.height);

        // Create a data texture from the image
        const dataTexture = new THREE.DataTexture(
          imgData.data,
          img.width,
          img.height,
          THREE.RGBAFormat
        );
        dataTexture.flipY = true;
        dataTexture.needsUpdate = true;

        // Create a simple copy shader to render the texture to paintA
        const copyMat = new THREE.ShaderMaterial({
          vertexShader: quadVert,
          fragmentShader: `
            uniform sampler2D uTexture;
            varying vec2 vUv;
            void main() {
              gl_FragColor = texture2D(uTexture, vUv);
            }
          `,
          uniforms: { uTexture: { value: dataTexture } },
        });

        paintMesh.material = copyMat;
        renderer.setRenderTarget(paintA);
        renderer.render(paintScene, paintCamera);
        renderer.setRenderTarget(paintB);
        renderer.render(paintScene, paintCamera);
        renderer.setRenderTarget(null);
        paintMesh.material = paintMat;

        // Clean up
        dataTexture.dispose();
        copyMat.dispose();

        needsUpdate = true;

        // Restore countries
        const pixelData = getAllPixels();
        for (const country of saveData.countries) {
          const color = new THREE.Color(country.color.r, country.color.g, country.color.b);
          const label = createCountryLabel(pixelData, width, height, color, country.name);
          if (label) {
            countryLabels.set(country.id, label);
            addLabel(textState, label, country.id);
          }
        }

        // Restore cities
        for (const cityData of saveData.cities) {
          const city: City = {
            position: new THREE.Vector2(cityData.position.x, cityData.position.y),
            name: cityData.name,
            size: cityData.size,
          };
          cities.set(cityData.id, city);
          addCity(textState, city, cityData.id);
        }

        // Restore city counter
        cityIdCounter = saveData.cityIdCounter;
      };
      img.src = saveData.imageData;
    } catch (err) {
      console.error('Failed to load map:', err);
      alert('Failed to load map file');
    }
  };
  reader.readAsText(file);
}

// Save/Load event listeners
saveBtn.addEventListener('click', saveMap);
loadBtn.addEventListener('click', () => loadInput.click());

// Play button - validate and pass current map to game
playBtn.addEventListener('click', () => {
  // Get all unique colors from the canvas (excluding white background)
  const pixelData = getAllPixels();
  const colorSet = new Set<string>();

  for (let i = 0; i < pixelData.length; i += 4) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];

    // Skip white background
    if (r > 240 && g > 240 && b > 240) continue;

    const key = `${r}_${g}_${b}`;
    colorSet.add(key);
  }

  // Check if there are any countries
  if (colorSet.size === 0) {
    alert('Please draw at least one country before playing.');
    return;
  }

  // Check if all countries have names
  const unnamedColors: string[] = [];
  for (const colorKey of colorSet) {
    if (!countryLabels.has(colorKey)) {
      unnamedColors.push(colorKey);
    }
  }

  if (unnamedColors.length > 0) {
    alert(`Please name all countries before playing. ${unnamedColors.length} country/countries need names. Use middle-click or the "Name" button to name them.`);
    return;
  }

  // Create save data for the game
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);

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

  const saveData: MapSaveData = {
    version: 1,
    width,
    height,
    imageData: tempCanvas.toDataURL('image/png'),
    countries: Array.from(countryLabels.entries()).map(([id, label]) => ({
      id,
      name: label.name,
      color: { r: label.color.r, g: label.color.g, b: label.color.b },
    })),
    cities: Array.from(cities.entries()).map(([id, city]) => ({
      id,
      name: city.name,
      size: city.size,
      position: { x: city.position.x, y: city.position.y },
    })),
    cityIdCounter,
  };

  // Store in sessionStorage and navigate
  sessionStorage.setItem('currentMap', JSON.stringify(saveData));
  window.location.href = '/game.html';
});
loadInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    loadMap(file);
    loadInput.value = ''; // Reset so same file can be loaded again
  }
});

updateDisplayCamera();
clear();

// FPS tracking
let lastTime = performance.now();
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);

  // FPS calculation
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fpsCounter.textContent = `FPS: ${frameCount}`;
    frameCount = 0;
    lastTime = now;
  }

  if (needsUpdate) {
    runJFA();
    needsUpdate = false;
  }

  renderer.render(displayScene, displayCamera);
  renderText(textState, renderer, displayCamera);
}
animate();
