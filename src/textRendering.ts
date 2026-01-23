import * as THREE from 'three';
import { City, CountryLabel } from './types';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
const CHAR_SIZE = 64;
const SDF_SPREAD = 8;
const ATLAS_COLS = 8;
const ATLAS_ROWS = Math.ceil(CHARS.length / ATLAS_COLS);
const ATLAS_WIDTH = ATLAS_COLS * CHAR_SIZE;
const ATLAS_HEIGHT = ATLAS_ROWS * CHAR_SIZE;

const sdfTextVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const sdfTextFrag = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
uniform sampler2D map;
uniform vec3 color;
varying vec2 vUv;
void main() {
  float dist = texture2D(map, vUv).a;
  float fw = fwidth(dist);
  float alpha = smoothstep(0.5 - fw, 0.5 + fw, dist);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}`;

export interface TextState {
  scene: THREE.Scene;
  fontAtlas: THREE.CanvasTexture;
  countryMeshes: Map<string, THREE.Object3D[]>;
  cityMeshes: Map<string, THREE.Object3D[]>;
  cityMarkers: Map<string, THREE.Mesh>;
  cityMinZooms: Map<string, number>;
  aspectRatio: number;
  currentZoom: number;
}

export function createTextState(width: number, height: number): TextState {
  return {
    scene: new THREE.Scene(),
    fontAtlas: createFontAtlas(),
    countryMeshes: new Map(),
    cityMeshes: new Map(),
    cityMarkers: new Map(),
    cityMinZooms: new Map(),
    aspectRatio: width / height,
    currentZoom: 1,
  };
}

function createFontAtlas(): THREE.CanvasTexture {
  const scale = 4;
  const charSize = CHAR_SIZE * scale;
  const w = ATLAS_WIDTH * scale;
  const h = ATLAS_HEIGHT * scale;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.font = `bold ${charSize * 0.65}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < CHARS.length; i++) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    ctx.fillText(CHARS[i], col * charSize + charSize / 2, row * charSize + charSize / 2);
  }

  const imgData = ctx.getImageData(0, 0, w, h);
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) binary[i] = imgData.data[i * 4] > 127 ? 1 : 0;

  const sdfCanvas = document.createElement('canvas');
  sdfCanvas.width = ATLAS_WIDTH;
  sdfCanvas.height = ATLAS_HEIGHT;
  const sdfCtx = sdfCanvas.getContext('2d')!;
  const sdfData = sdfCtx.createImageData(ATLAS_WIDTH, ATLAS_HEIGHT);
  const spread = SDF_SPREAD * scale;

  for (let y = 0; y < ATLAS_HEIGHT; y++) {
    for (let x = 0; x < ATLAS_WIDTH; x++) {
      const hx = Math.floor(x * scale + scale / 2);
      const hy = Math.floor(y * scale + scale / 2);
      const inside = binary[hy * w + hx] === 1;

      let minDist = spread;
      for (let sy = -spread; sy <= spread; sy++) {
        for (let sx = -spread; sx <= spread; sx++) {
          const px = hx + sx, py = hy + sy;
          if (px < 0 || px >= w || py < 0 || py >= h) continue;
          if (binary[py * w + px] !== (inside ? 1 : 0)) {
            minDist = Math.min(minDist, Math.sqrt(sx * sx + sy * sy));
          }
        }
      }

      const norm = inside ? 0.5 + (minDist / spread) * 0.5 : 0.5 - (minDist / spread) * 0.5;
      const idx = (y * ATLAS_WIDTH + x) * 4;
      sdfData.data[idx] = sdfData.data[idx + 1] = sdfData.data[idx + 2] = 255;
      sdfData.data[idx + 3] = Math.round(norm * 255);
    }
  }

  sdfCtx.putImageData(sdfData, 0, 0);
  const texture = new THREE.CanvasTexture(sdfCanvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function getCharUVs(char: string) {
  let idx = CHARS.indexOf(char.toUpperCase());
  if (idx === -1) idx = CHARS.indexOf(' ');
  const col = idx % ATLAS_COLS;
  const row = Math.floor(idx / ATLAS_COLS);
  return {
    uMin: col / ATLAS_COLS,
    uMax: (col + 1) / ATLAS_COLS,
    vMin: 1 - row / ATLAS_ROWS,
    vMax: 1 - (row + 1) / ATLAS_ROWS,
  };
}

function createCharMesh(state: TextState, char: string, w: number, h: number, color = new THREE.Color(0, 0, 0)) {
  const uvs = getCharUVs(char);
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  uv.setXY(0, uvs.uMin, uvs.vMin);
  uv.setXY(1, uvs.uMax, uvs.vMin);
  uv.setXY(2, uvs.uMin, uvs.vMax);
  uv.setXY(3, uvs.uMax, uvs.vMax);
  uv.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({
    vertexShader: sdfTextVert,
    fragmentShader: sdfTextFrag,
    uniforms: { map: { value: state.fontAtlas }, color: { value: color } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

function disposeMeshes(objects: THREE.Object3D[], scene: THREE.Scene) {
  for (const obj of objects) {
    scene.remove(obj);
    obj.traverse(child => {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.Material).dispose();
        child.geometry.dispose();
      }
    });
  }
}

export function addLabel(state: TextState, label: CountryLabel, labelId: string) {
  removeLabel(state, labelId);
  const objects: THREE.Object3D[] = [];
  const charH = 0.05, charW = charH * 0.7;

  for (let i = 0; i < label.name.length; i++) {
    const pos = label.positions[i];
    if (!pos) continue;

    const mesh = createCharMesh(state, label.name[i], charW, charH);
    const container = new THREE.Object3D();
    container.position.set(pos.x * 2 - 1, -(pos.y * 2 - 1), 0);
    container.scale.set(1 / state.aspectRatio, 1, 1);

    mesh.rotation.z = -label.angle;
    const cos = Math.cos(label.angle), sin = Math.sin(label.angle);
    const ar = 1 / state.aspectRatio;
    mesh.scale.set(1 / Math.sqrt(cos * cos * ar * ar + sin * sin), 1 / Math.sqrt(sin * sin * ar * ar + cos * cos), 1);

    container.add(mesh);
    objects.push(container);
    state.scene.add(container);
  }
  state.countryMeshes.set(labelId, objects);
}

export function removeLabel(state: TextState, labelId: string) {
  const objects = state.countryMeshes.get(labelId);
  if (objects) {
    disposeMeshes(objects, state.scene);
    state.countryMeshes.delete(labelId);
  }
}

export function addCity(state: TextState, city: City, cityId: string) {
  removeCity(state, cityId);
  const objects: THREE.Object3D[] = [];
  const markerSize = 0.008 + city.size * 0.004;
  const charH = 0.012 + city.size * 0.003;
  const charW = (charH * 0.7) / state.aspectRatio;
  const worldX = city.position.x * 2 - 1;
  const worldY = -(city.position.y * 2 - 1);

  const markerGeo = new THREE.CircleGeometry(0.004, 10);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, depthWrite: false });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.scale.x = 1 / state.aspectRatio;
  marker.position.set(worldX, worldY, 0);
  marker.userData = { cityId };
  objects.push(marker);
  state.scene.add(marker);
  state.cityMarkers.set(cityId, marker);

  const name = city.name.toUpperCase();
  const spacing = charW * 0.9;
  const startX = worldX + markerSize / 2 + charW * 0.2;

  for (let i = 0; i < name.length; i++) {
    const mesh = createCharMesh(state, name[i], charW, charH);
    mesh.position.set(startX + i * spacing, worldY, 0);
    objects.push(mesh);
    state.scene.add(mesh);
  }

  state.cityMeshes.set(cityId, objects);
  state.cityMinZooms.set(cityId, 1 + (5 - city.size) * 0.8);
  updateVisibility(state, state.currentZoom);
}

export function removeCity(state: TextState, cityId: string) {
  const objects = state.cityMeshes.get(cityId);
  if (objects) disposeMeshes(objects, state.scene);
  state.cityMeshes.delete(cityId);
  state.cityMarkers.delete(cityId);
  state.cityMinZooms.delete(cityId);
}

export function updateAspectRatio(state: TextState, width: number, height: number) {
  state.aspectRatio = width / height;
}

export function updateVisibility(state: TextState, zoom: number) {
  state.currentZoom = zoom;
  const showCountry = zoom < 2;
  for (const meshes of state.countryMeshes.values()) {
    for (const m of meshes) m.visible = showCountry;
  }
  for (const [id, minZoom] of state.cityMinZooms.entries()) {
    const objs = state.cityMeshes.get(id);
    if (objs) for (const o of objs) o.visible = zoom >= minZoom;
  }
}

export function getCityMarkers(state: TextState): THREE.Mesh[] {
  return Array.from(state.cityMarkers.values()).filter(m => m.visible);
}

export function render(state: TextState, renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  renderer.autoClear = false;
  renderer.render(state.scene, camera);
  renderer.autoClear = true;
}

export function clearAll(state: TextState) {
  for (const id of Array.from(state.countryMeshes.keys())) removeLabel(state, id);
  for (const id of Array.from(state.cityMeshes.keys())) removeCity(state, id);
}
