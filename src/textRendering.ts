import * as THREE from 'three';
import { CountryLabel } from './countryNaming';

export interface City {
  position: THREE.Vector2;
  name: string;
  size: number;
}

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
}
`;

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
}
`;

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
  const hiresScale = 4;
  const hiresCharSize = CHAR_SIZE * hiresScale;
  const hiresWidth = ATLAS_WIDTH * hiresScale;
  const hiresHeight = ATLAS_HEIGHT * hiresScale;

  const hiresCanvas = document.createElement('canvas');
  hiresCanvas.width = hiresWidth;
  hiresCanvas.height = hiresHeight;
  const hiresCtx = hiresCanvas.getContext('2d')!;

  hiresCtx.fillStyle = 'white';
  hiresCtx.font = `bold ${hiresCharSize * 0.65}px Arial, sans-serif`;
  hiresCtx.textAlign = 'center';
  hiresCtx.textBaseline = 'middle';

  for (let i = 0; i < CHARS.length; i++) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    const x = col * hiresCharSize + hiresCharSize / 2;
    const y = row * hiresCharSize + hiresCharSize / 2;
    hiresCtx.fillText(CHARS[i], x, y);
  }

  const hiresData = hiresCtx.getImageData(0, 0, hiresWidth, hiresHeight);
  const hiresBinary = new Uint8Array(hiresWidth * hiresHeight);
  for (let i = 0; i < hiresBinary.length; i++) {
    hiresBinary[i] = hiresData.data[i * 4] > 127 ? 1 : 0;
  }

  const sdfCanvas = document.createElement('canvas');
  sdfCanvas.width = ATLAS_WIDTH;
  sdfCanvas.height = ATLAS_HEIGHT;
  const sdfCtx = sdfCanvas.getContext('2d')!;
  const sdfImageData = sdfCtx.createImageData(ATLAS_WIDTH, ATLAS_HEIGHT);

  const spread = SDF_SPREAD * hiresScale;

  for (let y = 0; y < ATLAS_HEIGHT; y++) {
    for (let x = 0; x < ATLAS_WIDTH; x++) {
      const hx = Math.floor(x * hiresScale + hiresScale / 2);
      const hy = Math.floor(y * hiresScale + hiresScale / 2);
      const inside = hiresBinary[hy * hiresWidth + hx] === 1;

      let minDist = spread;
      for (let sy = -spread; sy <= spread; sy++) {
        for (let sx = -spread; sx <= spread; sx++) {
          const px = hx + sx;
          const py = hy + sy;
          if (px < 0 || px >= hiresWidth || py < 0 || py >= hiresHeight) continue;

          const pixelInside = hiresBinary[py * hiresWidth + px] === 1;
          if (pixelInside !== inside) {
            const dist = Math.sqrt(sx * sx + sy * sy);
            if (dist < minDist) minDist = dist;
          }
        }
      }

      const normalizedDist = inside
        ? 0.5 + (minDist / spread) * 0.5
        : 0.5 - (minDist / spread) * 0.5;

      const idx = (y * ATLAS_WIDTH + x) * 4;
      sdfImageData.data[idx] = 255;
      sdfImageData.data[idx + 1] = 255;
      sdfImageData.data[idx + 2] = 255;
      sdfImageData.data[idx + 3] = Math.round(normalizedDist * 255);
    }
  }

  sdfCtx.putImageData(sdfImageData, 0, 0);

  const texture = new THREE.CanvasTexture(sdfCanvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function getCharUVs(char: string): { uMin: number; uMax: number; vMin: number; vMax: number } {
  const upperChar = char.toUpperCase();
  let index = CHARS.indexOf(upperChar);
  if (index === -1) index = CHARS.indexOf(' ');

  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);

  return {
    uMin: col / ATLAS_COLS,
    uMax: (col + 1) / ATLAS_COLS,
    vMin: 1 - row / ATLAS_ROWS,
    vMax: 1 - (row + 1) / ATLAS_ROWS,
  };
}

function createCharMesh(
  state: TextState,
  char: string,
  charWidth: number,
  charHeight: number,
  color: THREE.Color = new THREE.Color(0, 0, 0)
): THREE.Mesh {
  const uvs = getCharUVs(char);
  const geometry = new THREE.PlaneGeometry(charWidth, charHeight);

  const uvAttribute = geometry.attributes.uv;
  uvAttribute.setXY(0, uvs.uMin, uvs.vMin);
  uvAttribute.setXY(1, uvs.uMax, uvs.vMin);
  uvAttribute.setXY(2, uvs.uMin, uvs.vMax);
  uvAttribute.setXY(3, uvs.uMax, uvs.vMax);
  uvAttribute.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    vertexShader: sdfTextVert,
    fragmentShader: sdfTextFrag,
    uniforms: {
      map: { value: state.fontAtlas },
      color: { value: color },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  return new THREE.Mesh(geometry, material);
}

export function addLabel(state: TextState, label: CountryLabel, labelId: string): void {
  removeLabel(state, labelId);

  const objects: THREE.Object3D[] = [];
  const charHeight = 0.05;
  const charAspect = 0.7;

  for (let i = 0; i < label.name.length; i++) {
    const char = label.name[i];
    const pos = label.positions[i];
    if (!pos) continue;

    const charWidth = charHeight * charAspect;
    const mesh = createCharMesh(state, char, charWidth, charHeight);

    const worldX = pos.x * 2 - 1;
    const worldY = -(pos.y * 2 - 1);

    const container = new THREE.Object3D();
    container.position.set(worldX, worldY, 0);
    container.scale.set(1 / state.aspectRatio, 1, 1);

    // Negate angle because Y-axis is flipped between pixel coords and world coords
    mesh.rotation.z = -label.angle;

    const cos = Math.cos(label.angle);
    const sin = Math.sin(label.angle);
    const arInv = 1 / state.aspectRatio;
    const meshScaleX = 1 / Math.sqrt(cos * cos * arInv * arInv + sin * sin);
    const meshScaleY = 1 / Math.sqrt(sin * sin * arInv * arInv + cos * cos);
    mesh.scale.set(meshScaleX, meshScaleY, 1);

    container.add(mesh);
    objects.push(container);
    state.scene.add(container);
  }

  state.countryMeshes.set(labelId, objects);
}

export function removeLabel(state: TextState, labelId: string): void {
  const objects = state.countryMeshes.get(labelId);
  if (objects) {
    for (const obj of objects) {
      state.scene.remove(obj);
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.Material).dispose();
          child.geometry.dispose();
        }
      });
    }
    state.countryMeshes.delete(labelId);
  }
}

export function addCity(state: TextState, city: City, cityId: string): void {
  removeCity(state, cityId);

  const objects: THREE.Object3D[] = [];
  const markerSize = 0.008 + city.size * 0.004;
  const charHeight = 0.012 + city.size * 0.003;
  const charWidth = (charHeight * 0.7) / state.aspectRatio;

  const worldX = city.position.x * 2 - 1;
  const worldY = -(city.position.y * 2 - 1);

  const markerGeometry = new THREE.CircleGeometry(0.004, 10);
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: 0x111111,
    depthTest: false,
    depthWrite: false,
  });
  const markerMesh = new THREE.Mesh(markerGeometry, markerMaterial);
  markerMesh.scale.x = 1 / state.aspectRatio;
  markerMesh.position.set(worldX, worldY, 0);
  markerMesh.userData = { cityId };
  objects.push(markerMesh);
  state.scene.add(markerMesh);
  state.cityMarkers.set(cityId, markerMesh);

  const name = city.name.toUpperCase();
  const spacing = charWidth * 0.9;
  const startX = worldX + markerSize / 2 + charWidth * 0.2;

  for (let i = 0; i < name.length; i++) {
    const mesh = createCharMesh(state, name[i], charWidth, charHeight);
    mesh.position.set(startX + i * spacing, worldY, 0);
    objects.push(mesh);
    state.scene.add(mesh);
  }

  state.cityMeshes.set(cityId, objects);
  state.cityMinZooms.set(cityId, 1 + (5 - city.size) * 0.8);

  updateVisibility(state, state.currentZoom);
}

export function removeCity(state: TextState, cityId: string): void {
  const objects = state.cityMeshes.get(cityId);
  if (objects) {
    for (const obj of objects) {
      state.scene.remove(obj);
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.Material).dispose();
        obj.geometry.dispose();
      }
    }
    state.cityMeshes.delete(cityId);
  }
  state.cityMarkers.delete(cityId);
  state.cityMinZooms.delete(cityId);
}

export function updateAspectRatio(state: TextState, width: number, height: number): void {
  state.aspectRatio = width / height;
}

export function updateVisibility(state: TextState, zoom: number): void {
  state.currentZoom = zoom;

  const showCountryLabels = zoom < 2;
  for (const meshes of state.countryMeshes.values()) {
    for (const mesh of meshes) {
      mesh.visible = showCountryLabels;
    }
  }

  for (const [cityId, minZoom] of state.cityMinZooms.entries()) {
    const objects = state.cityMeshes.get(cityId);
    if (objects) {
      const visible = zoom >= minZoom;
      for (const obj of objects) {
        obj.visible = visible;
      }
    }
  }
}

export function getCityMarkers(state: TextState): THREE.Mesh[] {
  return Array.from(state.cityMarkers.values()).filter(m => m.visible);
}

export function render(state: TextState, renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
  renderer.autoClear = false;
  renderer.render(state.scene, camera);
  renderer.autoClear = true;
}

export function clearAll(state: TextState): void {
  for (const labelId of Array.from(state.countryMeshes.keys())) {
    removeLabel(state, labelId);
  }
  for (const cityId of Array.from(state.cityMeshes.keys())) {
    removeCity(state, cityId);
  }
}
