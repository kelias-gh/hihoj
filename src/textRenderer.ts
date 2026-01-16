import * as THREE from 'three';
import { CountryLabel } from './countryNaming';

// City data structure
export interface City {
  position: THREE.Vector2; // UV position [0,1]
  name: string;
  size: number; // 1-5 scale for city importance
}

// SDF font atlas settings
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
const CHAR_SIZE = 64; // Size of each character cell
const SDF_SPREAD = 8; // Distance field spread in pixels
const ATLAS_COLS = 8;
const ATLAS_ROWS = Math.ceil(CHARS.length / ATLAS_COLS);
const ATLAS_WIDTH = ATLAS_COLS * CHAR_SIZE;
const ATLAS_HEIGHT = ATLAS_ROWS * CHAR_SIZE;

// SDF text shader for smooth rendering at any zoom
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

  // Screen-space anti-aliasing
  float fw = fwidth(dist);
  float alpha = smoothstep(0.5 - fw, 0.5 + fw, dist);

  if (alpha < 0.01) discard;

  gl_FragColor = vec4(color, alpha);
}
`;

function getCharUVs(char: string): { uMin: number; uMax: number; vMin: number; vMax: number } {
  const upperChar = char.toUpperCase();
  let index = CHARS.indexOf(upperChar);
  if (index === -1) index = CHARS.indexOf(' ');

  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);

  const uMax = (col + 1) / ATLAS_COLS;
  const uMin = col / ATLAS_COLS;
  const vMax = 1 - (row + 1) / ATLAS_ROWS;
  const vMin = 1 - row / ATLAS_ROWS;

  return { uMin, uMax, vMin, vMax };
}

export class TextRenderer {
  private fontAtlas: THREE.CanvasTexture;
  private countryLabelMeshes: Map<string, THREE.Mesh[]> = new Map();
  private cityMeshes: Map<string, THREE.Object3D[]> = new Map();
  private cityMarkers: Map<string, THREE.Mesh> = new Map();
  private cityData: Map<string, { city: City; minZoom: number }> = new Map();
  private textScene: THREE.Scene;
  private currentZoom = 1;
  private aspectRatio: number;

  constructor(width: number, height: number) {
    this.fontAtlas = this.createFontAtlas();
    this.textScene = new THREE.Scene();
    this.aspectRatio = width / height;
  }

  private createFontAtlas(): THREE.CanvasTexture {
    // Step 1: Render high-res glyphs
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

    // Get high-res binary image
    const hiresData = hiresCtx.getImageData(0, 0, hiresWidth, hiresHeight);
    const hiresBinary = new Uint8Array(hiresWidth * hiresHeight);
    for (let i = 0; i < hiresBinary.length; i++) {
      hiresBinary[i] = hiresData.data[i * 4] > 127 ? 1 : 0;
    }

    // Step 2: Generate SDF at output resolution
    const sdfCanvas = document.createElement('canvas');
    sdfCanvas.width = ATLAS_WIDTH;
    sdfCanvas.height = ATLAS_HEIGHT;
    const sdfCtx = sdfCanvas.getContext('2d')!;
    const sdfImageData = sdfCtx.createImageData(ATLAS_WIDTH, ATLAS_HEIGHT);

    const spread = SDF_SPREAD * hiresScale;

    for (let y = 0; y < ATLAS_HEIGHT; y++) {
      for (let x = 0; x < ATLAS_WIDTH; x++) {
        // Sample point in high-res space
        const hx = Math.floor(x * hiresScale + hiresScale / 2);
        const hy = Math.floor(y * hiresScale + hiresScale / 2);
        const inside = hiresBinary[hy * hiresWidth + hx] === 1;

        // Find minimum distance to edge
        let minDist = spread;
        const searchRadius = spread;

        for (let sy = -searchRadius; sy <= searchRadius; sy++) {
          for (let sx = -searchRadius; sx <= searchRadius; sx++) {
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

        // Normalize: 0.5 = edge, 0 = outside by spread, 1 = inside by spread
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

  private createCharMesh(char: string, charWidth: number, charHeight: number, color: THREE.Color = new THREE.Color(0, 0, 0)): THREE.Mesh {
    const uvs = getCharUVs(char);
    const geometry = new THREE.PlaneGeometry(charWidth, charHeight);

    const uvAttribute = geometry.attributes.uv;
    uvAttribute.setXY(0, uvs.uMin, uvs.vMin);
    uvAttribute.setXY(1, uvs.uMax, uvs.vMin);
    uvAttribute.setXY(2, uvs.uMin, uvs.vMax);
    uvAttribute.setXY(3, uvs.uMax, uvs.vMax);
    uvAttribute.needsUpdate = true;

    // SDF shader material for smooth text at any zoom level
    const material = new THREE.ShaderMaterial({
      vertexShader: sdfTextVert,
      fragmentShader: sdfTextFrag,
      uniforms: {
        map: { value: this.fontAtlas },
        color: { value: color },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    return new THREE.Mesh(geometry, material);
  }

  addLabel(label: CountryLabel, labelId: string): void {
    this.removeLabel(labelId);

    const meshes: THREE.Mesh[] = [];
    const charHeight = 0.05;
    // Correct for screen aspect ratio: divide width by aspect ratio to prevent horizontal stretch
    const charWidth = (charHeight * 0.7) / this.aspectRatio;

    for (let i = 0; i < label.name.length; i++) {
      const char = label.name[i];
      const pos = label.positions[i];
      if (!pos) continue;

      const mesh = this.createCharMesh(char, charWidth, charHeight);

      const worldX = pos.x * 2 - 1;
      const worldY = -(pos.y * 2 - 1);

      mesh.position.set(worldX, worldY, 0);
      mesh.rotation.z = label.angle;
      mesh.userData = { type: 'countryLabel' };

      meshes.push(mesh);
      this.textScene.add(mesh);
    }

    this.countryLabelMeshes.set(labelId, meshes);
  }

  removeLabel(labelId: string): void {
    const meshes = this.countryLabelMeshes.get(labelId);
    if (meshes) {
      for (const mesh of meshes) {
        this.textScene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        mesh.geometry.dispose();
      }
      this.countryLabelMeshes.delete(labelId);
    }
  }

  addCity(city: City, cityId: string): void {
    this.removeCity(cityId);

    const objects: THREE.Object3D[] = [];

    // Much smaller sizes
    const markerSize = 0.008 + city.size * 0.004;
    const charHeight = 0.012 + city.size * 0.003;
    // Correct for screen aspect ratio: divide width by aspect ratio to prevent horizontal stretch
    const charWidth = (charHeight * 0.7) / this.aspectRatio;

    const worldX = city.position.x * 2 - 1;
    const worldY = -(city.position.y * 2 - 1);

    // City marker (small square)
    const markerGeometry = new THREE.CircleGeometry(0.004, 10);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x111111,
      depthTest: false,
      depthWrite: false,
    });
    const markerMesh = new THREE.Mesh(markerGeometry, markerMaterial);
    markerMesh.scale.x = 1 / this.aspectRatio;
    markerMesh.position.set(worldX, worldY, 0);
    markerMesh.userData = { cityId, type: 'cityMarker', size: city.size };
    objects.push(markerMesh);
    this.textScene.add(markerMesh);
    this.cityMarkers.set(cityId, markerMesh);

    // City name text
    const name = city.name.toUpperCase();
    const spacing = charWidth * 0.9;
    const startX = worldX + markerSize / 2 + charWidth * 0.2;

    for (let i = 0; i < name.length; i++) {
      const char = name[i];
      const mesh = this.createCharMesh(char, charWidth, charHeight);
      mesh.position.set(startX + i * spacing, worldY, 0);
      mesh.userData = { type: 'cityText', size: city.size };
      objects.push(mesh);
      this.textScene.add(mesh);
    }

    this.cityMeshes.set(cityId, objects);

    // Store city data with minimum zoom level required to see it
    // Smaller cities need more zoom to be visible
    const minZoom = 1 + (5 - city.size) * 0.8;
    this.cityData.set(cityId, { city, minZoom });

    // Apply current zoom visibility
    this.updateVisibility(this.currentZoom);
  }

  removeCity(cityId: string): void {
    const objects = this.cityMeshes.get(cityId);
    if (objects) {
      for (const obj of objects) {
        this.textScene.remove(obj);
        if (obj instanceof THREE.Mesh) {
          (obj.material as THREE.Material).dispose();
          obj.geometry.dispose();
        }
      }
      this.cityMeshes.delete(cityId);
    }
    this.cityMarkers.delete(cityId);
    this.cityData.delete(cityId);
  }

  updateAspectRatio(width: number, height: number): void {
    this.aspectRatio = width / height;
  }

  updateVisibility(zoom: number): void {
    this.currentZoom = zoom;

    // Country labels: visible when zoomed out (zoom < 2)
    const showCountryLabels = zoom < 2;
    for (const meshes of this.countryLabelMeshes.values()) {
      for (const mesh of meshes) {
        mesh.visible = showCountryLabels;
      }
    }

    // Cities: visible based on size and zoom level
    for (const [cityId, data] of this.cityData.entries()) {
      const objects = this.cityMeshes.get(cityId);
      if (objects) {
        const visible = zoom >= data.minZoom;
        for (const obj of objects) {
          obj.visible = visible;
        }
      }
    }
  }

  getCityMarkers(): THREE.Mesh[] {
    // Only return visible markers
    return Array.from(this.cityMarkers.values()).filter(m => m.visible);
  }

  getScene(): THREE.Scene {
    return this.textScene;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    renderer.autoClear = false;
    renderer.render(this.textScene, camera);
    renderer.autoClear = true;
  }

  clear(): void {
    for (const labelId of Array.from(this.countryLabelMeshes.keys())) {
      this.removeLabel(labelId);
    }
    for (const cityId of Array.from(this.cityMeshes.keys())) {
      this.removeCity(cityId);
    }
  }
}
