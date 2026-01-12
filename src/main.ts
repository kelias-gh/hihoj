import * as THREE from 'three';
import {
  quadVert,
  paintFrag,
  borderDetectFrag,
  jfaFrag,
  distanceFieldFrag,
  finalDisplayFrag
} from './shaders';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const brushSizeSlider = document.getElementById('brush-size') as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;

let width = window.innerWidth;
let height = window.innerHeight;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(width, height);
renderer.setPixelRatio(1);

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
let prevPos = new THREE.Vector2(-1000, -1000);
let currPos = new THREE.Vector2(-1000, -1000);
let panStart = new THREE.Vector2();
let needsUpdate = true;

let zoom = 1;
let panX = 0;
let panY = 0;

const jfaSteps = [32, 16, 8, 4, 2, 1];

function updateDisplayCamera() {
  displayCamera.left = -1 / zoom + panX;
  displayCamera.right = 1 / zoom + panX;
  displayCamera.top = 1 / zoom - panY;
  displayCamera.bottom = -1 / zoom - panY;
  displayCamera.updateProjectionMatrix();
}

function clear() {
  renderer.setRenderTarget(paintA);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear();
  renderer.setRenderTarget(paintB);
  renderer.clear();
  renderer.setRenderTarget(null);
  needsUpdate = true;
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
    isPainting = true;
    currPos = screenToCanvas(e);
    prevPos.copy(currPos);
    paint();
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

updateDisplayCamera();
clear();

function animate() {
  requestAnimationFrame(animate);

  if (needsUpdate) {
    runJFA();
    needsUpdate = false;
  }

  renderer.render(displayScene, displayCamera);
}
animate();
