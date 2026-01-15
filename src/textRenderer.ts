import * as THREE from 'three';
import { CountryLabel } from './countryNaming';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
const CHAR_SIZE = 64;
const ATLAS_COLS = 8;
const ATLAS_ROWS = Math.ceil(CHARS.length / ATLAS_COLS);
const ATLAS_WIDTH = ATLAS_COLS * CHAR_SIZE;
const ATLAS_HEIGHT = ATLAS_ROWS * CHAR_SIZE;

function getCharUVs(char: string): { uMin: number; uMax: number; vMin: number; vMax: number } {
  const upperChar = char.toUpperCase();
  let index = CHARS.indexOf(upperChar);
  if (index === -1) index = CHARS.indexOf(' ');

  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);

  const uMin = col / ATLAS_COLS;
  const uMax = (col + 1) / ATLAS_COLS;
  const vMin = 1 - (row + 1) / ATLAS_ROWS; // Flip Y for texture coords
  const vMax = 1 - row / ATLAS_ROWS;

  return { uMin, uMax, vMin, vMax };
}

export class TextRenderer {
  private fontAtlas: THREE.CanvasTexture;
  private charMeshes: Map<string, THREE.Mesh[]> = new Map();
  private textScene: THREE.Scene;

  constructor(_width: number, _height: number) {
    this.fontAtlas = this.createFontAtlas();
    this.textScene = new THREE.Scene();
  }

  private createFontAtlas(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_WIDTH;
    canvas.height = ATLAS_HEIGHT;
    const ctx = canvas.getContext('2d')!;

    // Clear with transparent background
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);

    // Draw white text first (we'll use the luminance as alpha)
    ctx.fillStyle = 'white';
    ctx.font = `bold ${CHAR_SIZE * 0.7}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw each character
    for (let i = 0; i < CHARS.length; i++) {
      const col = i % ATLAS_COLS;
      const row = Math.floor(i / ATLAS_COLS);
      const x = col * CHAR_SIZE + CHAR_SIZE / 2;
      const y = row * CHAR_SIZE + CHAR_SIZE / 2;
      ctx.fillText(CHARS[i], x, y);
    }

    // Process the image data to create proper alpha from the white text
    const imageData = ctx.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      // Use the red channel (white text) as alpha, make the color black
      const alpha = data[i]; // Red channel
      data[i] = 0;     // R - black
      data[i + 1] = 0; // G - black
      data[i + 2] = 0; // B - black
      data[i + 3] = alpha; // A - from original white value
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  addLabel(label: CountryLabel, labelId: string): void {
    this.removeLabel(labelId);

    const meshes: THREE.Mesh[] = [];
    const charScale = 0.04; // Size of each character in world units

    for (let i = 0; i < label.name.length; i++) {
      const char = label.name[i];
      const pos = label.positions[i];
      if (!pos) continue;

      // Create geometry with proper UVs for this character
      const uvs = getCharUVs(char);
      const geometry = new THREE.PlaneGeometry(charScale, charScale);

      // Update UV coordinates to sample the correct character from atlas
      const uvAttribute = geometry.attributes.uv;
      // PlaneGeometry UV order: bottom-left, bottom-right, top-left, top-right
      uvAttribute.setXY(0, uvs.uMin, uvs.vMin); // bottom-left
      uvAttribute.setXY(1, uvs.uMax, uvs.vMin); // bottom-right
      uvAttribute.setXY(2, uvs.uMin, uvs.vMax); // top-left
      uvAttribute.setXY(3, uvs.uMax, uvs.vMax); // top-right
      uvAttribute.needsUpdate = true;

      const material = new THREE.MeshBasicMaterial({
        map: this.fontAtlas,
        transparent: true,
        alphaTest: 0.1,
        depthTest: false,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Convert UV position [0,1] to world coordinates [-1,1]
      const worldX = pos.x * 2 - 1;
      const worldY = -(pos.y * 2 - 1); // Flip Y

      mesh.position.set(worldX, worldY, 0);
      mesh.scale.y = -1.5;
      mesh.rotation.z = label.angle;

      meshes.push(mesh);
      this.textScene.add(mesh);
    }

    this.charMeshes.set(labelId, meshes);
  }

  removeLabel(labelId: string): void {
    const meshes = this.charMeshes.get(labelId);
    if (meshes) {
      for (const mesh of meshes) {
        this.textScene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        mesh.geometry.dispose();
      }
      this.charMeshes.delete(labelId);
    }
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    renderer.autoClear = false;
    renderer.render(this.textScene, camera);
    renderer.autoClear = true;
  }

  clear(): void {
    for (const labelId of Array.from(this.charMeshes.keys())) {
      this.removeLabel(labelId);
    }
  }
}
