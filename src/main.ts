import * as THREE from 'three';
import { quadVert, paintFrag, borderDetectFrag, jfaFrag, distanceFieldFrag, finalDisplayFrag, copyFrag, referenceOverlayFrag } from './shaders';
import { createCountryLabel } from './countryNaming';
import { City, CountryLabel, MapSaveData, colorToKey } from './types';
import { createTextState, addLabel, removeLabel, addCity, removeCity, updateVisibility, updateAspectRatio, clearAll, render as renderText, getCityMarkers, TextState } from './textRendering';
import { getScenario, saveScenario, generateId, StoredScenario } from './storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('canvas');
const colorPicker = $<HTMLInputElement>('color-picker');
const brushSizeSlider = $<HTMLInputElement>('brush-size');
const fillBtn = $<HTMLButtonElement>('fill-btn');
const clearBtn = $<HTMLButtonElement>('clear-btn');
const nameBtn = $<HTMLButtonElement>('name-btn');
const cityBtn = $<HTMLButtonElement>('city-btn');
const saveBtn = $<HTMLButtonElement>('save-btn');
const loadBtn = $<HTMLButtonElement>('load-btn');
const loadInput = $<HTMLInputElement>('load-input');
const playBtn = $<HTMLButtonElement>('play-btn');
const fpsCounter = $<HTMLDivElement>('fps-counter');
const refBtn = $<HTMLButtonElement>('ref-btn');
const refInput = $<HTMLInputElement>('ref-input');
const refOpacitySlider = $<HTMLInputElement>('ref-opacity');
const libraryBtn = $<HTMLButtonElement>('library-btn');

const cityDialog = $<HTMLDivElement>('city-dialog');
const cityDialogTitle = $<HTMLHeadingElement>('city-dialog-title');
const cityNameInput = $<HTMLInputElement>('city-name');
const citySizeSelect = $<HTMLSelectElement>('city-size');
const cityDeleteBtn = $<HTMLButtonElement>('city-delete');
const cityCancelBtn = $<HTMLButtonElement>('city-cancel');
const citySaveBtn = $<HTMLButtonElement>('city-save');

const countryDialog = $<HTMLDivElement>('country-dialog');
const countryDialogTitle = $<HTMLHeadingElement>('country-dialog-title');
const countryNameInput = $<HTMLInputElement>('country-name');
const countryDeleteBtn = $<HTMLButtonElement>('country-delete');
const countryCancelBtn = $<HTMLButtonElement>('country-cancel');
const countrySaveBtn = $<HTMLButtonElement>('country-save');

const MAP_WIDTH = 4096;
const MAP_HEIGHT = 2048;

let width = window.innerWidth;
let height = window.innerHeight;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(width, height);
renderer.setPixelRatio(window.devicePixelRatio);

const paintCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.PlaneGeometry(2, 2);

const rtNearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };
const rtFloat = { ...rtNearest, type: THREE.FloatType };

let paintA = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, rtNearest);
let paintB = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, rtNearest);
let jfaA = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, rtFloat);
let jfaB = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, rtFloat);
const distanceFieldRT = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.FloatType });

const paintUniforms = {
  uTexture: { value: paintB.texture },
  uBrushPos: { value: new THREE.Vector2(-1000, -1000) },
  uPrevBrushPos: { value: new THREE.Vector2(-1000, -1000) },
  uBrushColor: { value: new THREE.Color(colorPicker.value) },
  uBrushSize: { value: parseInt(brushSizeSlider.value, 10) },
  uResolution: { value: new THREE.Vector2(MAP_WIDTH, MAP_HEIGHT) },
};

const paintMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: paintFrag, uniforms: paintUniforms });
const borderMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: borderDetectFrag, uniforms: { u_lookUpTex: { value: paintA.texture }, u_pixelSize: { value: new THREE.Vector2(1 / MAP_WIDTH, 1 / MAP_HEIGHT) } } });
const jfaMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: jfaFrag, uniforms: { u_inputTexture: { value: null as THREE.Texture | null }, u_stepSize: { value: new THREE.Vector2(1 / MAP_WIDTH, 1 / MAP_HEIGHT) } } });
const distMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: distanceFieldFrag, uniforms: { u_coordTexture: { value: null as THREE.Texture | null }, maxDistance: { value: 0.008 } } });
const displayMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: finalDisplayFrag, uniforms: { u_colorMap: { value: paintA.texture }, u_distanceField: { value: distanceFieldRT.texture }, u_pixelSize: { value: new THREE.Vector2(1 / MAP_WIDTH, 1 / MAP_HEIGHT) }, u_borderColor: { value: new THREE.Vector3(0, 0, 0) } } });

const refUniforms = { uReference: { value: null as THREE.Texture | null }, uOpacity: { value: 0.3 } };
const refMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: referenceOverlayFrag, uniforms: refUniforms, transparent: true, depthTest: false });

const paintScene = new THREE.Scene();
const paintMesh = new THREE.Mesh(quad, paintMat);
paintScene.add(paintMesh);

const displayScene = new THREE.Scene();
displayScene.add(new THREE.Mesh(quad, displayMat));

const refScene = new THREE.Scene();
const refMesh = new THREE.Mesh(quad, refMat);
refMesh.visible = false;
refScene.add(refMesh);

let isPainting = false, isPanning = false, isNamingMode = false, isCityMode = false, isFillMode = false;
let prevPos = new THREE.Vector2(-1000, -1000), currPos = new THREE.Vector2(-1000, -1000), panStart = new THREE.Vector2();
let needsUpdate = true, zoom = 1, panX = 0, panY = 0;

const jfaSteps = [32, 16, 8, 4, 2, 1];
let textState: TextState = createTextState(MAP_WIDTH, MAP_HEIGHT);
const countryLabels = new Map<string, CountryLabel>();
const cities = new Map<string, City>();
let cityIdCounter = 0;

let pendingCityPosition: THREE.Vector2 | null = null;
let editingCityId: string | null = null;
let pendingCountryColor: THREE.Color | null = null;
let editingCountryId: string | null = null;

function getPixelColor(x: number, y: number): THREE.Color {
  const buf = new Uint8Array(4);
  renderer.setRenderTarget(paintA);
  renderer.readRenderTargetPixels(paintA, Math.floor(x), Math.floor(y), 1, 1, buf);
  renderer.setRenderTarget(null);
  return new THREE.Color(buf[0] / 255, buf[1] / 255, buf[2] / 255);
}

function getAllPixels(): Uint8Array {
  const buf = new Uint8Array(MAP_WIDTH * MAP_HEIGHT * 4);
  renderer.setRenderTarget(paintA);
  renderer.readRenderTargetPixels(paintA, 0, 0, MAP_WIDTH, MAP_HEIGHT, buf);
  renderer.setRenderTarget(null);
  return buf;
}

function uploadPixels(data: Uint8Array) {
  const tex = new THREE.DataTexture(new Uint8ClampedArray(data), MAP_WIDTH, MAP_HEIGHT, THREE.RGBAFormat);
  tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: copyFrag, uniforms: { uTexture: { value: tex } } });
  paintMesh.material = mat;
  renderer.setRenderTarget(paintA);
  renderer.render(paintScene, paintCamera);
  renderer.setRenderTarget(paintB);
  renderer.render(paintScene, paintCamera);
  renderer.setRenderTarget(null);
  paintMesh.material = paintMat;
  tex.dispose();
  mat.dispose();
  needsUpdate = true;
}

function floodFill(startX: number, startY: number, fillColor: THREE.Color) {
  const data = getAllPixels();
  const x = Math.floor(startX), y = Math.floor(startY);
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) return;

  const startIdx = (y * MAP_WIDTH + x) * 4;
  const tr = data[startIdx], tg = data[startIdx + 1], tb = data[startIdx + 2];
  const fr = Math.round(fillColor.r * 255), fg = Math.round(fillColor.g * 255), fb = Math.round(fillColor.b * 255);
  if (tr === fr && tg === fg && tb === fb) return;

  const visited = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  const stack = [x, y];

  while (stack.length) {
    const cy = stack.pop()!, cx = stack.pop()!;
    if (cx < 0 || cx >= MAP_WIDTH || cy < 0 || cy >= MAP_HEIGHT) continue;
    const idx = cy * MAP_WIDTH + cx;
    if (visited[idx]) continue;
    const pi = idx * 4;
    if (data[pi] !== tr || data[pi + 1] !== tg || data[pi + 2] !== tb) continue;
    visited[idx] = 1;
    data[pi] = fr; data[pi + 1] = fg; data[pi + 2] = fb; data[pi + 3] = 255;
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }

  uploadPixels(data);
}

function showCityDialog(isEdit: boolean, existing?: City) {
  cityDialogTitle.textContent = isEdit ? 'Edit City' : 'Add City';
  cityDeleteBtn.style.display = isEdit ? 'inline-block' : 'none';
  cityNameInput.value = existing?.name || '';
  citySizeSelect.value = String(existing?.size || 3);
  cityDialog.classList.remove('hidden');
  cityNameInput.focus();
}

function hideCityDialog() {
  cityDialog.classList.add('hidden');
  pendingCityPosition = editingCityId = null;
}

function showCountryDialog(isEdit: boolean, name?: string) {
  countryDialogTitle.textContent = isEdit ? 'Edit Country' : 'Name Country';
  countryDeleteBtn.style.display = isEdit ? 'inline-block' : 'none';
  countryNameInput.value = name || '';
  countryDialog.classList.remove('hidden');
  countryNameInput.focus();
}

function hideCountryDialog() {
  countryDialog.classList.add('hidden');
  pendingCountryColor = editingCountryId = null;
}

function nameCountryAt(x: number, y: number) {
  const color = getPixelColor(x, y);
  if (color.r > 0.95 && color.g > 0.95 && color.b > 0.95) return;

  const id = colorToKey(color);
  const existing = countryLabels.get(id);
  pendingCountryColor = color;
  editingCountryId = existing ? id : null;
  showCountryDialog(!!existing, existing?.name);
}

function saveCountry() {
  const name = countryNameInput.value.trim().toUpperCase();
  if (!name || !pendingCountryColor) { hideCountryDialog(); return; }

  const label = createCountryLabel(getAllPixels(), MAP_WIDTH, MAP_HEIGHT, pendingCountryColor, name);
  if (label) {
    const id = colorToKey(pendingCountryColor);
    countryLabels.set(id, label);
    addLabel(textState, label, id);
  }
  hideCountryDialog();
}

function deleteCountry() {
  if (editingCountryId) {
    removeLabel(textState, editingCountryId);
    countryLabels.delete(editingCountryId);
  }
  hideCountryDialog();
}

function openCityDialogAt(x: number, y: number) {
  pendingCityPosition = new THREE.Vector2(x / MAP_WIDTH, 1 - y / MAP_HEIGHT);
  editingCityId = null;
  showCityDialog(false);
}

function saveCity() {
  const name = cityNameInput.value.trim();
  if (!name) { hideCityDialog(); return; }

  const size = parseInt(citySizeSelect.value, 10);
  if (editingCityId) {
    const city: City = { position: cities.get(editingCityId)!.position, name, size };
    cities.set(editingCityId, city);
    addCity(textState, city, editingCityId);
  } else if (pendingCityPosition) {
    const city: City = { position: pendingCityPosition, name, size };
    const id = `city_${cityIdCounter++}`;
    cities.set(id, city);
    addCity(textState, city, id);
  }
  hideCityDialog();
}

function deleteCity() {
  if (editingCityId) {
    removeCity(textState, editingCityId);
    cities.delete(editingCityId);
  }
  hideCityDialog();
}

function screenToWorld(e: MouseEvent): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) / width, sy = (e.clientY - rect.top) / height;
  return new THREE.Vector2((sx - 0.5) * 2 / zoom + panX, -(sy - 0.5) * 2 / zoom - panY);
}

function screenToCanvas(e: MouseEvent): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) / width, sy = (e.clientY - rect.top) / height;
  const x = (sx - 0.5) * 2 / zoom * MAP_WIDTH / 2 + MAP_WIDTH / 2 + panX * MAP_WIDTH / 2;
  const y = (sy - 0.5) * 2 / zoom * MAP_HEIGHT / 2 + MAP_HEIGHT / 2 + panY * MAP_HEIGHT / 2;
  return new THREE.Vector2(x, MAP_HEIGHT - y);
}

function checkCityClick(e: MouseEvent): string | null {
  const world = screenToWorld(e);
  for (const marker of getCityMarkers(textState)) {
    const geo = marker.geometry as THREE.CircleGeometry;
    if (Math.hypot(marker.position.x - world.x, marker.position.y - world.y) < geo.parameters.radius * 2) {
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
  borderMat.uniforms.u_lookUpTex.value = paintA.texture;
  paintMesh.material = borderMat;
  renderer.setRenderTarget(jfaA);
  renderer.render(paintScene, paintCamera);

  paintMesh.material = jfaMat;
  for (const s of jfaSteps) {
    jfaMat.uniforms.u_inputTexture.value = jfaA.texture;
    jfaMat.uniforms.u_stepSize.value.set(s / MAP_WIDTH, s / MAP_HEIGHT);
    renderer.setRenderTarget(jfaB);
    renderer.render(paintScene, paintCamera);
    [jfaA, jfaB] = [jfaB, jfaA];
  }

  distMat.uniforms.u_coordTexture.value = jfaA.texture;
  paintMesh.material = distMat;
  renderer.setRenderTarget(distanceFieldRT);
  renderer.render(paintScene, paintCamera);
  renderer.setRenderTarget(null);

  displayMat.uniforms.u_colorMap.value = paintA.texture;
  displayMat.uniforms.u_distanceField.value = distanceFieldRT.texture;
}

function loadReferenceImage(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      refUniforms.uReference.value?.dispose();
      refUniforms.uReference.value = tex;
      refMesh.visible = true;
    };
    img.src = reader.result as string;
  };
  reader.readAsDataURL(file);
}

function buildSaveData(): MapSaveData {
  const data = getAllPixels();
  const canvas = document.createElement('canvas');
  canvas.width = MAP_WIDTH;
  canvas.height = MAP_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(MAP_WIDTH, MAP_HEIGHT);

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const src = (y * MAP_WIDTH + x) * 4;
      const dst = ((MAP_HEIGHT - 1 - y) * MAP_WIDTH + x) * 4;
      imgData.data[dst] = data[src];
      imgData.data[dst + 1] = data[src + 1];
      imgData.data[dst + 2] = data[src + 2];
      imgData.data[dst + 3] = data[src + 3];
    }
  }
  ctx.putImageData(imgData, 0, 0);

  return {
    version: 1,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    imageData: canvas.toDataURL('image/png'),
    countries: Array.from(countryLabels.entries()).map(([id, l]) => ({ id, name: l.name, color: { r: l.color.r, g: l.color.g, b: l.color.b } })),
    cities: Array.from(cities.entries()).map(([id, c]) => ({ id, name: c.name, size: c.size, position: { x: c.position.x, y: c.position.y } })),
    cityIdCounter,
  };
}

function generateThumbnail(): string {
  const data = getAllPixels();
  const thumbWidth = 256, thumbHeight = 128;
  const canvas = document.createElement('canvas');
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(thumbWidth, thumbHeight);
  const scaleX = MAP_WIDTH / thumbWidth, scaleY = MAP_HEIGHT / thumbHeight;

  for (let ty = 0; ty < thumbHeight; ty++) {
    for (let tx = 0; tx < thumbWidth; tx++) {
      const sx = Math.floor(tx * scaleX), sy = Math.floor(ty * scaleY);
      const srcIdx = (sy * MAP_WIDTH + sx) * 4;
      const dstIdx = (ty * thumbWidth + tx) * 4;
      imageData.data[dstIdx] = data[srcIdx];
      imageData.data[dstIdx + 1] = data[srcIdx + 1];
      imageData.data[dstIdx + 2] = data[srcIdx + 2];
      imageData.data[dstIdx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

let currentScenarioId: string | null = null;

async function saveToStorage() {
  const mapData = JSON.stringify(buildSaveData());
  const thumbnail = generateThumbnail();
  const now = Date.now();

  const name = countryLabels.size > 0
    ? Array.from(countryLabels.values()).slice(0, 3).map(l => l.name).join(', ')
    : 'Untitled Map';

  const scenario: StoredScenario = {
    id: currentScenarioId || generateId(),
    name,
    createdAt: currentScenarioId ? (await getScenario(currentScenarioId))?.createdAt || now : now,
    updatedAt: now,
    thumbnail,
    mapData
  };

  await saveScenario(scenario);
  currentScenarioId = scenario.id;
}

function saveMap() {
  saveToStorage();
  const blob = new Blob([JSON.stringify(buildSaveData())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.map';
  a.click();
  URL.revokeObjectURL(url);
}

function loadMap(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const data: MapSaveData = JSON.parse(e.target?.result as string);
    if (data.version !== 1 && data.version !== 2) { alert('Unsupported version'); return; }

    clear();
    cities.clear();

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);

      const tex = new THREE.DataTexture(imgData.data, img.width, img.height, THREE.RGBAFormat);
      tex.flipY = true;
      tex.needsUpdate = true;

      const mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: copyFrag, uniforms: { uTexture: { value: tex } } });
      paintMesh.material = mat;
      renderer.setRenderTarget(paintA);
      renderer.render(paintScene, paintCamera);
      renderer.setRenderTarget(paintB);
      renderer.render(paintScene, paintCamera);
      renderer.setRenderTarget(null);
      paintMesh.material = paintMat;
      tex.dispose();
      mat.dispose();
      needsUpdate = true;

      const pixels = getAllPixels();
      for (const c of data.countries) {
        const color = new THREE.Color(c.color.r, c.color.g, c.color.b);
        const label = createCountryLabel(pixels, MAP_WIDTH, MAP_HEIGHT, color, c.name);
        if (label) { countryLabels.set(c.id, label); addLabel(textState, label, c.id); }
      }

      for (const c of data.cities) {
        const city: City = { position: new THREE.Vector2(c.position.x, c.position.y), name: c.name, size: c.size };
        cities.set(c.id, city);
        addCity(textState, city, c.id);
      }

      cityIdCounter = data.cityIdCounter;
    };
    img.src = data.imageData;
  };
  reader.readAsText(file);
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    const cityId = checkCityClick(e);
    if (cityId) { editingCityId = cityId; pendingCityPosition = null; showCityDialog(true, cities.get(cityId)); return; }

    if (isNamingMode) {
      nameCountryAt(...screenToCanvas(e).toArray() as [number, number]);
      isNamingMode = false;
      nameBtn.textContent = 'Name (Middle-click)';
      canvas.style.cursor = 'crosshair';
    } else if (isCityMode) {
      openCityDialogAt(...screenToCanvas(e).toArray() as [number, number]);
      isCityMode = false;
      cityBtn.textContent = 'Add City';
      canvas.style.cursor = 'crosshair';
    } else if (isFillMode) {
      const [x, y] = screenToCanvas(e).toArray();
      floodFill(x, y, new THREE.Color(colorPicker.value));
    } else {
      isPainting = true;
      currPos = screenToCanvas(e);
      prevPos.copy(currPos);
      paint();
    }
  } else if (e.button === 1) {
    e.preventDefault();
    nameCountryAt(...screenToCanvas(e).toArray() as [number, number]);
  } else if (e.button === 2) {
    isPanning = true;
    panStart.set(e.clientX, e.clientY);
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (isPainting) { prevPos.copy(currPos); currPos = screenToCanvas(e); paint(); }
  if (isPanning) {
    panX -= (e.clientX - panStart.x) / width * 2 / zoom;
    panY -= (e.clientY - panStart.y) / height * 2 / zoom;
    panStart.set(e.clientX, e.clientY);
    updateDisplayCamera();
  }
});

canvas.addEventListener('mouseup', (e) => { if (e.button === 0) isPainting = false; if (e.button === 2) isPanning = false; });
canvas.addEventListener('mouseleave', () => { isPainting = isPanning = false; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.1, Math.min(50, zoom * (e.deltaY > 0 ? 0.9 : 1.1))); updateDisplayCamera(); }, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setSize(width, height);
  updateAspectRatio(textState, width, height);
  updateDisplayCamera();
});

colorPicker.addEventListener('input', (e) => paintUniforms.uBrushColor.value.set((e.target as HTMLInputElement).value));
brushSizeSlider.addEventListener('input', (e) => paintUniforms.uBrushSize.value = Number((e.target as HTMLInputElement).value));
clearBtn.addEventListener('click', clear);

nameBtn.addEventListener('click', () => {
  isNamingMode = !isNamingMode;
  isCityMode = isFillMode = false;
  cityBtn.textContent = 'Add City';
  fillBtn.classList.remove('active');
  nameBtn.textContent = isNamingMode ? 'Click on country...' : 'Name (Middle-click)';
  canvas.style.cursor = isNamingMode ? 'pointer' : 'crosshair';
});

cityBtn.addEventListener('click', () => {
  isCityMode = !isCityMode;
  isNamingMode = isFillMode = false;
  nameBtn.textContent = 'Name (Middle-click)';
  fillBtn.classList.remove('active');
  cityBtn.textContent = isCityMode ? 'Click to place...' : 'Add City';
  canvas.style.cursor = isCityMode ? 'pointer' : 'crosshair';
});

fillBtn.addEventListener('click', () => {
  isFillMode = !isFillMode;
  isNamingMode = isCityMode = false;
  nameBtn.textContent = 'Name (Middle-click)';
  cityBtn.textContent = 'Add City';
  fillBtn.classList.toggle('active', isFillMode);
  canvas.style.cursor = 'crosshair';
});

citySaveBtn.addEventListener('click', saveCity);
cityCancelBtn.addEventListener('click', hideCityDialog);
cityDeleteBtn.addEventListener('click', deleteCity);
cityNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCity(); if (e.key === 'Escape') hideCityDialog(); });

countrySaveBtn.addEventListener('click', saveCountry);
countryCancelBtn.addEventListener('click', hideCountryDialog);
countryDeleteBtn.addEventListener('click', deleteCountry);
countryNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCountry(); if (e.key === 'Escape') hideCountryDialog(); });

saveBtn.addEventListener('click', saveMap);
loadBtn.addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { loadMap(f); loadInput.value = ''; } });

refBtn.addEventListener('click', () => refInput.click());
refInput.addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) loadReferenceImage(f); });
refOpacitySlider.addEventListener('input', (e) => refUniforms.uOpacity.value = Number((e.target as HTMLInputElement).value) / 100);

libraryBtn.addEventListener('click', () => window.location.href = '/library.html');

playBtn.addEventListener('click', () => {
  const data = getAllPixels();
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) continue;
    colors.add(`${data[i]}_${data[i + 1]}_${data[i + 2]}`);
  }
  if (!colors.size) { alert('Draw at least one country.'); return; }
  const unnamed = [...colors].filter(c => !countryLabels.has(c));
  if (unnamed.length) { alert(`Name all countries first. ${unnamed.length} need names.`); return; }
  sessionStorage.setItem('currentMap', JSON.stringify(buildSaveData()));
  window.location.href = '/game.html';
});

updateDisplayCamera();
clear();

async function loadFromStorage(id: string) {
  const scenario = await getScenario(id);
  if (!scenario) return;

  currentScenarioId = scenario.id;
  const data: MapSaveData = JSON.parse(scenario.mapData);
  if (data.version !== 1 && data.version !== 2) return;

  clear();
  cities.clear();

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);

    const tex = new THREE.DataTexture(imgData.data, img.width, img.height, THREE.RGBAFormat);
    tex.flipY = true;
    tex.needsUpdate = true;

    const mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: copyFrag, uniforms: { uTexture: { value: tex } } });
    paintMesh.material = mat;
    renderer.setRenderTarget(paintA);
    renderer.render(paintScene, paintCamera);
    renderer.setRenderTarget(paintB);
    renderer.render(paintScene, paintCamera);
    renderer.setRenderTarget(null);
    paintMesh.material = paintMat;
    tex.dispose();
    mat.dispose();
    needsUpdate = true;

    const pixels = getAllPixels();
    for (const c of data.countries) {
      const color = new THREE.Color(c.color.r, c.color.g, c.color.b);
      const label = createCountryLabel(pixels, MAP_WIDTH, MAP_HEIGHT, color, c.name);
      if (label) { countryLabels.set(c.id, label); addLabel(textState, label, c.id); }
    }

    for (const c of data.cities) {
      const city: City = { position: new THREE.Vector2(c.position.x, c.position.y), name: c.name, size: c.size };
      cities.set(c.id, city);
      addCity(textState, city, c.id);
    }

    cityIdCounter = data.cityIdCounter;
  };
  img.src = data.imageData;
}

const loadScenarioId = sessionStorage.getItem('loadScenarioId');
if (loadScenarioId) {
  sessionStorage.removeItem('loadScenarioId');
  loadFromStorage(loadScenarioId);
}

let lastTime = performance.now(), frameCount = 0;

function animate() {
  requestAnimationFrame(animate);
  frameCount++;
  const now = performance.now();
  if (now - lastTime >= 1000) { fpsCounter.textContent = `FPS: ${frameCount}`; frameCount = 0; lastTime = now; }
  if (needsUpdate) { runJFA(); needsUpdate = false; }
  renderer.render(displayScene, displayCamera);
  if (refMesh.visible) { renderer.autoClear = false; renderer.render(refScene, displayCamera); renderer.autoClear = true; }
  renderText(textState, renderer, displayCamera);
}
animate();
