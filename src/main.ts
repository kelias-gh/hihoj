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
import { TextRenderer, City } from './textRenderer';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const brushSizeSlider = document.getElementById('brush-size') as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const nameBtn = document.getElementById('name-btn') as HTMLButtonElement;
const cityBtn = document.getElementById('city-btn') as HTMLButtonElement;

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
  uBrushColor: { value: new THREE.Color(1, 0, 0) },
  uBrushSize: { value: 20 },
  uResolution: { value: new THREE.Vector2(width, height) },
};

const paintMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: paintFrag, uniforms: paintUniforms });

const borderUniforms = {
  u_lookUpTex: { value: paintA.texture },
  resolution: { value: new THREE.Vector2(width, height) },
};

const borderMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: borderDetectFrag, uniforms: borderUniforms });

const jfaUniforms = {
  u_inputTexture: { value: null as THREE.Texture | null },
  resolution: { value: new THREE.Vector2(width, height) },
  step: { value: 1 },
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
  u_resolution: { value: new THREE.Vector2(width, height) },
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
let prevPos = new THREE.Vector2(-1000, -1000);
let currPos = new THREE.Vector2(-1000, -1000);
let panStart = new THREE.Vector2();
let needsUpdate = true;

let zoom = 1;
let panX = 0;
let panY = 0;

const jfaSteps = [32, 16, 8, 4, 2, 1];

const textRenderer = new TextRenderer(width, height);
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
    textRenderer.addLabel(label, labelId);
  }

  hideCountryDialog();
}

function deleteCountry(): void {
  if (editingCountryId) {
    textRenderer.removeLabel(editingCountryId);
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
    textRenderer.addCity(city, editingCityId);
  } else if (pendingCityPosition) {
    // Create new city
    const city: City = {
      position: pendingCityPosition,
      name,
      size
    };
    const cityId = `city_${cityIdCounter++}`;
    cities.set(cityId, city);
    textRenderer.addCity(city, cityId);
  }

  hideCityDialog();
}

function deleteCity(): void {
  if (editingCityId) {
    textRenderer.removeCity(editingCityId);
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
  const markers = textRenderer.getCityMarkers();

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
  textRenderer.updateVisibility(zoom);
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
  textRenderer.clear();
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
    jfaUniforms.step.value = s;
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
  borderUniforms.resolution.value.set(width, height);
  jfaUniforms.resolution.value.set(width, height);
  displayUniforms.u_resolution.value.set(width, height);

  textRenderer.updateAspectRatio(width, height);
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
  cityBtn.textContent = 'Add City';
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
  nameBtn.textContent = 'Name (Middle-click)';
  if (isCityMode) {
    cityBtn.textContent = 'Click to place...';
    canvas.style.cursor = 'pointer';
  } else {
    cityBtn.textContent = 'Add City';
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

updateDisplayCamera();
clear();

function animate() {
  requestAnimationFrame(animate);

  if (needsUpdate) {
    runJFA();
    needsUpdate = false;
  }

  renderer.render(displayScene, displayCamera);
  textRenderer.render(renderer, displayCamera);
}
animate();
