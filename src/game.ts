import * as THREE from 'three';
import { quadVert, borderDetectFrag, jfaFrag, distanceFieldFrag, finalDisplayFrag, copyFrag } from './shaders';
import { parseMapFile, loadImageFromBase64 } from './fileIO';
import { createCountryLabel } from './countryNaming';
import { City, MapSaveData, Unit, UnitType, keyToColor } from './types';
import { createTextState, addLabel, addCity, updateVisibility, updateAspectRatio as updateTextAspectRatio, clearAll as clearAllText, render as renderText, TextState } from './textRendering';
import { createUnitState, createMovementManager, addUnit, removeUnit, selectUnit, updateUnitPosition, checkUnitClick, updateAspectRatio as updateUnitAspectRatio, startMovement, cancelMovement, renderUnits, getSelectedUnit, getAllUnits, UnitState, MovementManager } from './units';
import { createDiplomacyState, toggleRelation, getAllRelations, deserializeDiplomacy, DiplomacyState } from './diplomacy';
import { conquestAlongPath } from './conquest';
import { createGeminiConfig, planMovement, getStoredApiKey, storeApiKey, clearStoredApiKey, GeminiConfig, GameContext } from './geminiService';
import { getScenario } from './storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('canvas');
const libraryBtn = $<HTMLButtonElement>('library-btn');
const backBtn = $<HTMLButtonElement>('back-btn');
const loadBtn = $<HTMLButtonElement>('load-btn');
const loadInput = $<HTMLInputElement>('load-input');
const addUnitBtn = $<HTMLButtonElement>('add-unit-btn');
const diplomacyBtn = $<HTMLButtonElement>('diplomacy-btn');
const aiCommandInput = $<HTMLInputElement>('ai-command');
const executeBtn = $<HTMLButtonElement>('execute-btn');
const apiKeyBtn = $<HTMLButtonElement>('api-key-btn');

const unitDialog = $<HTMLDivElement>('unit-dialog');
const unitDialogTitle = $<HTMLHeadingElement>('unit-dialog-title');
const unitCountrySelect = $<HTMLSelectElement>('unit-country');
const unitTypeSelect = $<HTMLSelectElement>('unit-type');
const unitStrengthInput = $<HTMLInputElement>('unit-strength');
const unitDeleteBtn = $<HTMLButtonElement>('unit-delete');
const unitCancelBtn = $<HTMLButtonElement>('unit-cancel');
const unitSaveBtn = $<HTMLButtonElement>('unit-save');

const diplomacyDialog = $<HTMLDivElement>('diplomacy-dialog');
const diplomacyList = $<HTMLDivElement>('diplomacy-list');
const diplomacyCloseBtn = $<HTMLButtonElement>('diplomacy-close');

const apiKeyDialog = $<HTMLDivElement>('api-key-dialog');
const apiKeyInput = $<HTMLInputElement>('api-key-input');
const apiKeyClearBtn = $<HTMLButtonElement>('api-key-clear');
const apiKeyCancelBtn = $<HTMLButtonElement>('api-key-cancel');
const apiKeySaveBtn = $<HTMLButtonElement>('api-key-save');

const aiStatus = $<HTMLDivElement>('ai-status');
const aiStatusText = $<HTMLSpanElement>('ai-status-text');
const unitInfo = $<HTMLDivElement>('unit-info');
const unitInfoContent = $<HTMLDivElement>('unit-info-content');

const MAP_WIDTH = 4096;
const MAP_HEIGHT = 2048;

let width = window.innerWidth;
let height = window.innerHeight;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(width, height);
renderer.setPixelRatio(window.devicePixelRatio);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const displayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.PlaneGeometry(2, 2);

const rtNearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };
const rtFloat = { ...rtNearest, type: THREE.FloatType };

let paintRT = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, rtNearest);
let jfaA = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, rtFloat);
let jfaB = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, rtFloat);
const distanceFieldRT = new THREE.WebGLRenderTarget(MAP_WIDTH, MAP_HEIGHT, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.FloatType });

const borderMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: borderDetectFrag, uniforms: { u_lookUpTex: { value: paintRT.texture }, u_pixelSize: { value: new THREE.Vector2(1 / MAP_WIDTH, 1 / MAP_HEIGHT) } } });
const jfaMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: jfaFrag, uniforms: { u_inputTexture: { value: null as THREE.Texture | null }, u_stepSize: { value: new THREE.Vector2(1 / MAP_WIDTH, 1 / MAP_HEIGHT) } } });
const distMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: distanceFieldFrag, uniforms: { u_coordTexture: { value: null as THREE.Texture | null }, maxDistance: { value: 0.008 } } });
const displayMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: finalDisplayFrag, uniforms: { u_colorMap: { value: paintRT.texture }, u_distanceField: { value: distanceFieldRT.texture }, u_pixelSize: { value: new THREE.Vector2(1 / MAP_WIDTH, 1 / MAP_HEIGHT) }, u_borderColor: { value: new THREE.Vector3(0, 0, 0) } } });

const processScene = new THREE.Scene();
const processMesh = new THREE.Mesh(quad, borderMat);
processScene.add(processMesh);

const displayScene = new THREE.Scene();
displayScene.add(new THREE.Mesh(quad, displayMat));

let isPanning = false, panStart = new THREE.Vector2(), needsUpdate = false;
let zoom = 1, panX = 0, panY = 0;

const jfaSteps = [32, 16, 8, 4, 2, 1];

let textState: TextState = createTextState(MAP_WIDTH, MAP_HEIGHT);
let unitState: UnitState = createUnitState(MAP_WIDTH, MAP_HEIGHT);
let movementManager: MovementManager = createMovementManager();
let diplomacyState: DiplomacyState = createDiplomacyState();
let geminiConfig: GeminiConfig | null = null;

let countryData: Array<{ id: string; name: string; color: { r: number; g: number; b: number } }> = [];
let cityData: Array<{ id: string; name: string; position: THREE.Vector2; countryId?: string }> = [];

let isUnitPlaceMode = false;
let pendingUnitData: { countryId: string; type: UnitType; strength: number } | null = null;
let editingUnitId: string | null = null;
let cachedPixelData: Uint8Array | null = null;

const storedApiKey = getStoredApiKey();
if (storedApiKey) geminiConfig = createGeminiConfig(storedApiKey);

function updateDisplayCamera() {
  displayCamera.left = -1 / zoom + panX;
  displayCamera.right = 1 / zoom + panX;
  displayCamera.top = 1 / zoom - panY;
  displayCamera.bottom = -1 / zoom - panY;
  displayCamera.updateProjectionMatrix();
  updateVisibility(textState, zoom);
}

function runJFA() {
  borderMat.uniforms.u_lookUpTex.value = paintRT.texture;
  processMesh.material = borderMat;
  renderer.setRenderTarget(jfaA);
  renderer.render(processScene, camera);

  processMesh.material = jfaMat;
  for (const s of jfaSteps) {
    jfaMat.uniforms.u_inputTexture.value = jfaA.texture;
    jfaMat.uniforms.u_stepSize.value.set(s / MAP_WIDTH, s / MAP_HEIGHT);
    renderer.setRenderTarget(jfaB);
    renderer.render(processScene, camera);
    [jfaA, jfaB] = [jfaB, jfaA];
  }

  distMat.uniforms.u_coordTexture.value = jfaA.texture;
  processMesh.material = distMat;
  renderer.setRenderTarget(distanceFieldRT);
  renderer.render(processScene, camera);
  renderer.setRenderTarget(null);

  displayMat.uniforms.u_colorMap.value = paintRT.texture;
  displayMat.uniforms.u_distanceField.value = distanceFieldRT.texture;
}

function getAllPixels(): Uint8Array {
  const buf = new Uint8Array(MAP_WIDTH * MAP_HEIGHT * 4);
  renderer.setRenderTarget(paintRT);
  renderer.readRenderTargetPixels(paintRT, 0, 0, MAP_WIDTH, MAP_HEIGHT, buf);
  renderer.setRenderTarget(null);
  return buf;
}

function uploadPixels(data: Uint8Array) {
  const tex = new THREE.DataTexture(new Uint8ClampedArray(data), MAP_WIDTH, MAP_HEIGHT, THREE.RGBAFormat);
  tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: copyFrag, uniforms: { uTexture: { value: tex } } });
  processMesh.material = mat;
  renderer.setRenderTarget(paintRT);
  renderer.render(processScene, camera);
  renderer.setRenderTarget(null);
  processMesh.material = borderMat;
  tex.dispose();
  mat.dispose();
}

function screenToWorld(e: MouseEvent): THREE.Vector2 {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) / width, sy = (e.clientY - rect.top) / height;
  const worldX = (sx - 0.5) * 2 / zoom + panX;
  const worldY = -(sy - 0.5) * 2 / zoom - panY;
  return new THREE.Vector2(worldX, worldY);
}

function worldToUV(world: THREE.Vector2): THREE.Vector2 {
  return new THREE.Vector2(
    Math.max(0, Math.min(1, (world.x + 1) / 2)),
    Math.max(0, Math.min(1, 1 - (world.y + 1) / 2))
  );
}

function updateUnitInfoPanel() {
  const selected = getSelectedUnit(unitState);
  if (selected) {
    const country = countryData.find(c => c.id === selected.countryId);
    unitInfoContent.innerHTML = `
      <div><span class="unit-info-label">Unit:</span> <span class="unit-info-value">${selected.id}</span></div>
      <div><span class="unit-info-label">Type:</span> <span class="unit-info-value">${selected.type}</span></div>
      <div><span class="unit-info-label">Country:</span> <span class="unit-info-value">${country?.name || selected.countryId}</span></div>
      <div><span class="unit-info-label">Strength:</span> <span class="unit-info-value">${selected.strength}</span></div>
    `;
    unitInfo.classList.remove('hidden');
  } else {
    unitInfo.classList.add('hidden');
  }
}

function showUnitDialog(isEdit: boolean, existing?: Unit) {
  unitDialogTitle.textContent = isEdit ? 'Edit Unit' : 'Add Unit';
  unitDeleteBtn.style.display = isEdit ? 'inline-block' : 'none';
  unitSaveBtn.textContent = isEdit ? 'Save' : 'Place Unit';

  unitCountrySelect.innerHTML = '';
  for (const country of countryData) {
    const opt = document.createElement('option');
    opt.value = country.id;
    opt.textContent = country.name;
    if (existing?.countryId === country.id) opt.selected = true;
    unitCountrySelect.appendChild(opt);
  }

  if (existing) {
    unitTypeSelect.value = existing.type;
    unitStrengthInput.value = String(existing.strength);
    editingUnitId = existing.id;
  } else {
    unitTypeSelect.value = 'infantry';
    unitStrengthInput.value = '50';
    editingUnitId = null;
  }

  unitDialog.classList.remove('hidden');
}

function hideUnitDialog() {
  unitDialog.classList.add('hidden');
  isUnitPlaceMode = false;
  pendingUnitData = null;
  editingUnitId = null;
}

function saveUnitFromDialog() {
  const countryId = unitCountrySelect.value;
  const type = unitTypeSelect.value as UnitType;
  const strength = Math.max(1, Math.min(100, parseInt(unitStrengthInput.value, 10) || 50));

  if (editingUnitId) {
    const existing = unitState.units.get(editingUnitId);
    if (existing) addUnit(unitState, { ...existing, countryId, type, strength });
    hideUnitDialog();
  } else {
    pendingUnitData = { countryId, type, strength };
    isUnitPlaceMode = true;
    unitDialog.classList.add('hidden');
    canvas.style.cursor = 'crosshair';
  }
}

function deleteUnit() {
  if (editingUnitId) {
    removeUnit(unitState, editingUnitId);
    cancelMovement(movementManager, editingUnitId);
  }
  hideUnitDialog();
  updateUnitInfoPanel();
}

function showDiplomacyDialog() {
  renderDiplomacyList();
  diplomacyDialog.classList.remove('hidden');
}

function renderDiplomacyList() {
  if (countryData.length < 2) {
    diplomacyList.innerHTML = '<p class="no-countries-message">Need at least 2 countries</p>';
    return;
  }

  const relations = getAllRelations(diplomacyState, countryData.map(c => c.id));
  diplomacyList.innerHTML = relations.map(rel => {
    const a = countryData.find(c => c.id === rel.countryA);
    const b = countryData.find(c => c.id === rel.countryB);
    const ca = keyToColor(rel.countryA);
    const cb = keyToColor(rel.countryB);
    return `
      <div class="diplomacy-row" data-a="${rel.countryA}" data-b="${rel.countryB}">
        <div class="diplomacy-countries">
          <span class="country-badge">
            <span class="country-color" style="background:rgb(${Math.round(ca.r * 255)},${Math.round(ca.g * 255)},${Math.round(ca.b * 255)})"></span>
            ${a?.name || rel.countryA}
          </span>
          <span class="diplomacy-vs">vs</span>
          <span class="country-badge">
            <span class="country-color" style="background:rgb(${Math.round(cb.r * 255)},${Math.round(cb.g * 255)},${Math.round(cb.b * 255)})"></span>
            ${b?.name || rel.countryB}
          </span>
        </div>
        <button class="diplomacy-status ${rel.status}">${rel.status === 'war' ? 'War' : 'Peace'}</button>
      </div>
    `;
  }).join('');

  diplomacyList.querySelectorAll('.diplomacy-row').forEach(row => {
    const btn = row.querySelector('.diplomacy-status') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      const a = row.getAttribute('data-a')!;
      const b = row.getAttribute('data-b')!;
      const newStatus = toggleRelation(diplomacyState, a, b);
      btn.className = `diplomacy-status ${newStatus}`;
      btn.textContent = newStatus === 'war' ? 'War' : 'Peace';
    });
  });
}

function showApiKeyDialog() {
  apiKeyInput.value = getStoredApiKey() || '';
  apiKeyDialog.classList.remove('hidden');
  apiKeyInput.focus();
}

function hideApiKeyDialog() { apiKeyDialog.classList.add('hidden'); }

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (key) {
    storeApiKey(key);
    geminiConfig = createGeminiConfig(key);
  }
  hideApiKeyDialog();
}

function clearApiKey() {
  clearStoredApiKey();
  geminiConfig = null;
  apiKeyInput.value = '';
  hideApiKeyDialog();
}

async function executeAICommand() {
  const command = aiCommandInput.value.trim();
  if (!command) { alert('Enter a command'); return; }

  const selected = getSelectedUnit(unitState);
  if (!selected) { alert('Select a unit first'); return; }

  if (!geminiConfig) { alert('Set your Gemini API key first'); showApiKeyDialog(); return; }

  aiStatusText.textContent = 'AI Planning...';
  aiStatus.classList.remove('hidden');

  const context: GameContext = {
    units: getAllUnits(unitState),
    cities: cityData,
    countries: countryData.map(c => ({ id: c.id, name: c.name })),
    diplomacy: diplomacyState,
  };

  const plan = await planMovement(geminiConfig, command, selected, context);
  aiStatus.classList.add('hidden');

  if (plan.error) { alert(`AI Error: ${plan.reasoning}`); return; }
  if (plan.waypoints.length < 2) { alert(`Could not plan: ${plan.reasoning}`); return; }

  startMovement(movementManager, selected.id, plan.waypoints, 0.1);
  aiCommandInput.value = '';
}

async function loadMap(saveData: MapSaveData) {
  clearAllText(textState);
  for (const id of Array.from(unitState.units.keys())) removeUnit(unitState, id);
  movementManager.activeTasks = [];

  countryData = saveData.countries;
  cityData = [];

  const img = await loadImageFromBase64(saveData.imageData);
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  const ctx = tempCanvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, img.width, img.height);

  const tex = new THREE.DataTexture(imgData.data, img.width, img.height, THREE.RGBAFormat);
  tex.flipY = true;
  tex.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: copyFrag, uniforms: { uTexture: { value: tex } } });
  processMesh.material = mat;
  renderer.setRenderTarget(paintRT);
  renderer.render(processScene, camera);
  renderer.setRenderTarget(null);
  processMesh.material = borderMat;
  tex.dispose();
  mat.dispose();

  needsUpdate = true;
  const pixels = getAllPixels();
  cachedPixelData = pixels;

  for (const c of saveData.countries) {
    const color = new THREE.Color(c.color.r, c.color.g, c.color.b);
    const label = createCountryLabel(pixels, MAP_WIDTH, MAP_HEIGHT, color, c.name);
    if (label) addLabel(textState, label, c.id);
  }

  for (const c of saveData.cities) {
    const city: City = { position: new THREE.Vector2(c.position.x, c.position.y), name: c.name, size: c.size };
    addCity(textState, city, c.id);
    cityData.push({ id: c.id, name: c.name, position: new THREE.Vector2(c.position.x, c.position.y) });
  }

  if (saveData.units) {
    for (const u of saveData.units) {
      addUnit(unitState, { id: u.id, countryId: u.countryId, type: u.type, strength: u.strength, position: new THREE.Vector2(u.position.x, u.position.y), name: u.name });
    }
    unitState.unitIdCounter = saveData.unitIdCounter || 0;
  }

  diplomacyState = deserializeDiplomacy(saveData.diplomacy);
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    const world = screenToWorld(e);

    if (isUnitPlaceMode && pendingUnitData) {
      const uv = worldToUV(world);
      addUnit(unitState, { id: `unit_${unitState.unitIdCounter++}`, countryId: pendingUnitData.countryId, type: pendingUnitData.type, strength: pendingUnitData.strength, position: uv });
      isUnitPlaceMode = false;
      pendingUnitData = null;
      canvas.style.cursor = 'default';
      return;
    }

    const clicked = checkUnitClick(unitState, world, zoom);
    if (clicked) { selectUnit(unitState, clicked); updateUnitInfoPanel(); return; }

    selectUnit(unitState, null);
    updateUnitInfoPanel();

  } else if (e.button === 2) {
    const selected = getSelectedUnit(unitState);
    if (selected && !e.shiftKey) {
      const target = worldToUV(screenToWorld(e));
      startMovement(movementManager, selected.id, [selected.position.clone(), target], 0.15);
    } else {
      isPanning = true;
      panStart.set(e.clientX, e.clientY);
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (isPanning) {
    panX -= (e.clientX - panStart.x) / width * 2 / zoom;
    panY -= (e.clientY - panStart.y) / height * 2 / zoom;
    panStart.set(e.clientX, e.clientY);
    updateDisplayCamera();
  }
});

canvas.addEventListener('mouseup', (e) => { if (e.button === 2) isPanning = false; });
canvas.addEventListener('mouseleave', () => { isPanning = false; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.1, Math.min(50, zoom * (e.deltaY > 0 ? 0.9 : 1.1))); updateDisplayCamera(); }, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setSize(width, height);
  updateTextAspectRatio(textState, width, height);
  updateUnitAspectRatio(unitState, width, height);
  updateDisplayCamera();
});

libraryBtn.addEventListener('click', () => window.location.href = '/library.html');
backBtn.addEventListener('click', () => window.location.href = '/');
loadBtn.addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = parseMapFile(ev.target?.result as string);
      if (data) loadMap(data);
      else alert('Failed to load map');
    };
    reader.readAsText(f);
    loadInput.value = '';
  }
});

addUnitBtn.addEventListener('click', () => { if (!countryData.length) { alert('Load a map first'); return; } showUnitDialog(false); });
diplomacyBtn.addEventListener('click', () => { if (countryData.length < 2) { alert('Need 2+ countries'); return; } showDiplomacyDialog(); });
executeBtn.addEventListener('click', executeAICommand);
aiCommandInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executeAICommand(); });
apiKeyBtn.addEventListener('click', showApiKeyDialog);

unitSaveBtn.addEventListener('click', saveUnitFromDialog);
unitCancelBtn.addEventListener('click', hideUnitDialog);
unitDeleteBtn.addEventListener('click', deleteUnit);

diplomacyCloseBtn.addEventListener('click', () => diplomacyDialog.classList.add('hidden'));

apiKeySaveBtn.addEventListener('click', saveApiKey);
apiKeyCancelBtn.addEventListener('click', hideApiKeyDialog);
apiKeyClearBtn.addEventListener('click', clearApiKey);
apiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveApiKey(); if (e.key === 'Escape') hideApiKeyDialog(); });

updateDisplayCamera();

async function loadFromStorage(id: string) {
  const scenario = await getScenario(id);
  if (!scenario) return;
  const data: MapSaveData = JSON.parse(scenario.mapData);
  if (data.version === 1 || data.version === 2) loadMap(data);
}

const loadScenarioId = sessionStorage.getItem('loadScenarioId');
if (loadScenarioId) {
  sessionStorage.removeItem('loadScenarioId');
  loadFromStorage(loadScenarioId);
} else {
  const storedMap = sessionStorage.getItem('currentMap');
  if (storedMap) {
    const data = JSON.parse(storedMap) as MapSaveData;
    loadMap(data);
    sessionStorage.removeItem('currentMap');
  }
}

let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (movementManager.activeTasks.length > 0) {
    const completed: string[] = [];

    for (const task of movementManager.activeTasks) {
      const unit = unitState.units.get(task.unitId);
      if (!unit) { completed.push(task.unitId); continue; }

      const target = task.path[task.currentIndex + 1];
      if (!target) { completed.push(task.unitId); task.onComplete?.(); continue; }

      if (!cachedPixelData) cachedPixelData = getAllPixels();

      const dist = unit.position.distanceTo(target);
      const move = task.speed * dt;
      const prev = unit.position.clone();

      if (move >= dist) {
        unit.position.copy(target);
        updateUnitPosition(unitState, task.unitId, target);

        const result = conquestAlongPath(cachedPixelData, MAP_WIDTH, MAP_HEIGHT, [prev, target], keyToColor(unit.countryId), Math.max(3, Math.floor(unit.strength / 10)), diplomacyState, unit.countryId);
        if (result.needsUpdate) { uploadPixels(cachedPixelData); needsUpdate = true; }

        task.currentIndex++;
        if (task.currentIndex >= task.path.length - 1) { completed.push(task.unitId); task.onComplete?.(); }
      } else {
        const dir = target.clone().sub(unit.position).normalize();
        const newPos = unit.position.clone().add(dir.multiplyScalar(move));
        unit.position.copy(newPos);
        updateUnitPosition(unitState, task.unitId, newPos);

        const result = conquestAlongPath(cachedPixelData, MAP_WIDTH, MAP_HEIGHT, [prev, newPos], keyToColor(unit.countryId), Math.max(3, Math.floor(unit.strength / 10)), diplomacyState, unit.countryId);
        if (result.needsUpdate) { uploadPixels(cachedPixelData); needsUpdate = true; }
      }
    }

    movementManager.activeTasks = movementManager.activeTasks.filter(t => !completed.includes(t.unitId));
  }

  if (needsUpdate) { runJFA(); needsUpdate = false; }

  renderer.render(displayScene, displayCamera);
  renderText(textState, renderer, displayCamera);
  renderUnits(unitState, renderer, displayCamera);
}
animate();
