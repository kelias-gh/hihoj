import * as THREE from 'three';
import {
  quadVert,
  borderDetectFrag,
  jfaFrag,
  distanceFieldFrag,
  finalDisplayFrag
} from './shaders';
import { parseMapFile, loadImageFromBase64, MapSaveData } from './fileIO';
import { createCountryLabel } from './countryNaming';
import {
  createTextState,
  addLabel,
  addCity,
  updateVisibility,
  updateAspectRatio,
  clearAll,
  render as renderText,
  TextState,
  City
} from './textRendering';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const backBtn = document.getElementById('back-btn') as HTMLButtonElement;
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
const loadInput = document.getElementById('load-input') as HTMLInputElement;

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

let paintRT = new THREE.WebGLRenderTarget(width, height, rtNearest);
let jfaA = new THREE.WebGLRenderTarget(width, height, rtFloat);
let jfaB = new THREE.WebGLRenderTarget(width, height, rtFloat);
const distanceFieldRT = new THREE.WebGLRenderTarget(width, height, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.FloatType
});

const borderUniforms = {
  u_lookUpTex: { value: paintRT.texture },
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
  u_colorMap: { value: paintRT.texture },
  u_distanceField: { value: distanceFieldRT.texture },
  u_pixelSize: { value: new THREE.Vector2(1 / width, 1 / height) },
  u_borderColor: { value: new THREE.Vector3(0, 0, 0) },
};

const displayMat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: finalDisplayFrag, uniforms: displayUniforms });

const processScene = new THREE.Scene();
const processMesh = new THREE.Mesh(quad, borderMat);
processScene.add(processMesh);

const displayScene = new THREE.Scene();
displayScene.add(new THREE.Mesh(quad, displayMat));

let isPanning = false;
let panStart = new THREE.Vector2();
let needsUpdate = false;

let zoom = 1;
let panX = 0;
let panY = 0;

const jfaSteps = [32, 16, 8, 4, 2, 1];

let textState: TextState = createTextState(width, height);

function updateDisplayCamera() {
  displayCamera.left = -1 / zoom + panX;
  displayCamera.right = 1 / zoom + panX;
  displayCamera.top = 1 / zoom - panY;
  displayCamera.bottom = -1 / zoom - panY;
  displayCamera.updateProjectionMatrix();
  updateVisibility(textState, zoom);
}

function runJFA() {
  borderUniforms.u_lookUpTex.value = paintRT.texture;
  processMesh.material = borderMat;
  renderer.setRenderTarget(jfaA);
  renderer.render(processScene, camera);

  processMesh.material = jfaMat;
  for (const s of jfaSteps) {
    jfaUniforms.u_inputTexture.value = jfaA.texture;
    jfaUniforms.u_stepSize.value.set(s / width, s / height);
    renderer.setRenderTarget(jfaB);
    renderer.render(processScene, camera);
    [jfaA, jfaB] = [jfaB, jfaA];
  }

  distUniforms.u_coordTexture.value = jfaA.texture;
  processMesh.material = distMat;
  renderer.setRenderTarget(distanceFieldRT);
  renderer.render(processScene, camera);

  renderer.setRenderTarget(null);

  displayUniforms.u_colorMap.value = paintRT.texture;
  displayUniforms.u_distanceField.value = distanceFieldRT.texture;
}

function getAllPixels(): Uint8Array {
  const pixelBuffer = new Uint8Array(width * height * 4);
  renderer.setRenderTarget(paintRT);
  renderer.readRenderTargetPixels(paintRT, 0, 0, width, height, pixelBuffer);
  renderer.setRenderTarget(null);
  return pixelBuffer;
}

async function loadMap(saveData: MapSaveData) {
  clearAll(textState);

  const img = await loadImageFromBase64(saveData.imageData);

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  const ctx = tempCanvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, img.width, img.height);

  const dataTexture = new THREE.DataTexture(
    imgData.data,
    img.width,
    img.height,
    THREE.RGBAFormat
  );
  dataTexture.flipY = true;
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

  processMesh.material = copyMat;
  renderer.setRenderTarget(paintRT);
  renderer.render(processScene, camera);
  renderer.setRenderTarget(null);
  processMesh.material = borderMat;

  dataTexture.dispose();
  copyMat.dispose();

  needsUpdate = true;

  const pixelData = getAllPixels();
  for (const country of saveData.countries) {
    const color = new THREE.Color(country.color.r, country.color.g, country.color.b);
    const label = createCountryLabel(pixelData, width, height, color, country.name);
    if (label) {
      addLabel(textState, label, country.id);
    }
  }

  for (const cityData of saveData.cities) {
    const city: City = {
      position: new THREE.Vector2(cityData.position.x, cityData.position.y),
      name: cityData.name,
      size: cityData.size,
    };
    addCity(textState, city, cityData.id);
  }
}

// Event listeners
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    isPanning = true;
    panStart.set(e.clientX, e.clientY);
  }
});

canvas.addEventListener('mousemove', (e) => {
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
  if (e.button === 2) isPanning = false;
});

canvas.addEventListener('mouseleave', () => {
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

  paintRT.setSize(width, height);
  jfaA.setSize(width, height);
  jfaB.setSize(width, height);
  distanceFieldRT.setSize(width, height);

  borderUniforms.u_pixelSize.value.set(1 / width, 1 / height);
  displayUniforms.u_pixelSize.value.set(1 / width, 1 / height);

  updateAspectRatio(textState, width, height);
  updateDisplayCamera();
});

backBtn.addEventListener('click', () => {
  window.location.href = '/';
});

loadBtn.addEventListener('click', () => loadInput.click());

loadInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const saveData = parseMapFile(ev.target?.result as string);
      if (saveData) {
        loadMap(saveData);
      } else {
        alert('Failed to load map file');
      }
    };
    reader.readAsText(file);
    loadInput.value = '';
  }
});

updateDisplayCamera();

// Check for map data passed from editor via sessionStorage
const storedMapData = sessionStorage.getItem('currentMap');
if (storedMapData) {
  try {
    const saveData = JSON.parse(storedMapData) as MapSaveData;
    loadMap(saveData);
    sessionStorage.removeItem('currentMap'); // Clear after loading
  } catch (err) {
    console.error('Failed to load map from session:', err);
  }
}

function animate() {
  requestAnimationFrame(animate);

  if (needsUpdate) {
    runJFA();
    needsUpdate = false;
  }

  renderer.render(displayScene, displayCamera);
  renderText(textState, renderer, displayCamera);
}
animate();
