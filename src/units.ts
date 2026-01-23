import * as THREE from 'three';
import { Unit, UnitType, keyToColor } from './types';

export type { Unit, UnitType } from './types';

export interface UnitState {
  scene: THREE.Scene;
  units: Map<string, Unit>;
  unitMeshes: Map<string, THREE.Object3D[]>;
  unitMarkers: Map<string, THREE.Mesh>;
  selectedUnitId: string | null;
  unitIdCounter: number;
  aspectRatio: number;
}

export interface MovementTask {
  unitId: string;
  path: THREE.Vector2[];
  currentIndex: number;
  speed: number;
  onComplete?: () => void;
}

export interface MovementManager {
  activeTasks: MovementTask[];
}

export function createUnitState(width: number, height: number): UnitState {
  return {
    scene: new THREE.Scene(),
    units: new Map(),
    unitMeshes: new Map(),
    unitMarkers: new Map(),
    selectedUnitId: null,
    unitIdCounter: 0,
    aspectRatio: width / height,
  };
}

export function createMovementManager(): MovementManager {
  return { activeTasks: [] };
}

function createUnitGeometry(type: UnitType): THREE.BufferGeometry {
  const s = 0.015;
  if (type === 'infantry') {
    const shape = new THREE.Shape();
    shape.moveTo(0, s);
    shape.lineTo(-s * 0.8, -s * 0.6);
    shape.lineTo(s * 0.8, -s * 0.6);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }
  if (type === 'armor') {
    return new THREE.PlaneGeometry(s * 1.6, s * 1.0);
  }
  const shape = new THREE.Shape();
  shape.moveTo(0, s);
  shape.lineTo(s * 0.7, 0);
  shape.lineTo(0, -s);
  shape.lineTo(-s * 0.7, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
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

export function addUnit(state: UnitState, unit: Unit) {
  removeUnit(state, unit.id);
  state.units.set(unit.id, unit);

  const color = keyToColor(unit.countryId).multiplyScalar(0.7);
  const worldX = unit.position.x * 2 - 1;
  const worldY = -(unit.position.y * 2 - 1);

  const container = new THREE.Object3D();
  container.position.set(worldX, worldY, 0);
  container.scale.set(1 / state.aspectRatio, 1, 1);

  const outlineGeo = createUnitGeometry(unit.type);
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const outline = new THREE.Mesh(outlineGeo, outlineMat);
  outline.scale.set(1.2, 1.2, 1);
  outline.position.z = -0.001;
  container.add(outline);

  const markerGeo = createUnitGeometry(unit.type);
  const markerMat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.userData = { unitId: unit.id };
  container.add(marker);

  const ringGeo = new THREE.RingGeometry(0.018, 0.022, 20);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.visible = false;
  ring.userData = { isSelectionRing: true };
  container.add(ring);

  state.scene.add(container);
  state.unitMarkers.set(unit.id, marker);
  state.unitMeshes.set(unit.id, [container]);
}

export function removeUnit(state: UnitState, unitId: string) {
  const objects = state.unitMeshes.get(unitId);
  if (objects) disposeMeshes(objects, state.scene);
  state.unitMeshes.delete(unitId);
  state.unitMarkers.delete(unitId);
  state.units.delete(unitId);
  if (state.selectedUnitId === unitId) state.selectedUnitId = null;
}

export function selectUnit(state: UnitState, unitId: string | null) {
  const setRingVisible = (id: string, visible: boolean) => {
    const objs = state.unitMeshes.get(id);
    if (objs) for (const o of objs) o.traverse(c => { if (c.userData?.isSelectionRing) c.visible = visible; });
  };
  if (state.selectedUnitId) setRingVisible(state.selectedUnitId, false);
  state.selectedUnitId = unitId;
  if (unitId) setRingVisible(unitId, true);
}

export function updateUnitPosition(state: UnitState, unitId: string, pos: THREE.Vector2) {
  const unit = state.units.get(unitId);
  if (!unit) return;
  unit.position.copy(pos);
  const objs = state.unitMeshes.get(unitId);
  if (objs?.[0]) objs[0].position.set(pos.x * 2 - 1, -(pos.y * 2 - 1), 0);
}

export function checkUnitClick(state: UnitState, worldPos: THREE.Vector2, zoom: number): string | null {
  const radius = 0.03 / zoom;
  for (const [id, unit] of state.units) {
    const ux = unit.position.x * 2 - 1;
    const uy = -(unit.position.y * 2 - 1);
    if (Math.hypot(worldPos.x - ux, worldPos.y - uy) < radius) return id;
  }
  return null;
}

export function updateAspectRatio(state: UnitState, width: number, height: number) {
  state.aspectRatio = width / height;
  for (const objs of state.unitMeshes.values()) for (const o of objs) o.scale.set(1 / state.aspectRatio, 1, 1);
}

export function startMovement(manager: MovementManager, unitId: string, path: THREE.Vector2[], speed = 0.15, onComplete?: () => void) {
  manager.activeTasks = manager.activeTasks.filter(t => t.unitId !== unitId);
  if (path.length < 2) { onComplete?.(); return; }
  manager.activeTasks.push({ unitId, path: path.map(p => p.clone()), currentIndex: 0, speed, onComplete });
}

export function cancelMovement(manager: MovementManager, unitId: string) {
  manager.activeTasks = manager.activeTasks.filter(t => t.unitId !== unitId);
}

export function renderUnits(state: UnitState, renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  renderer.autoClear = false;
  renderer.render(state.scene, camera);
  renderer.autoClear = true;
}

export function getSelectedUnit(state: UnitState): Unit | null {
  return state.selectedUnitId ? state.units.get(state.selectedUnitId) || null : null;
}

export function getAllUnits(state: UnitState): Unit[] {
  return Array.from(state.units.values());
}
