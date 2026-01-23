import * as THREE from 'three';

export type UnitType = 'infantry' | 'armor' | 'artillery';
export type DiplomaticStatus = 'peace' | 'war';

export interface Unit {
  id: string;
  countryId: string;
  position: THREE.Vector2;
  type: UnitType;
  strength: number;
  name?: string;
}

export interface City {
  position: THREE.Vector2;
  name: string;
  size: number;
}

export interface CountryLabel {
  color: THREE.Color;
  name: string;
  positions: THREE.Vector2[];
  angle: number;
}

export interface MapSaveData {
  version: number;
  width: number;
  height: number;
  imageData: string;
  countries: Array<{
    id: string;
    name: string;
    color: { r: number; g: number; b: number };
  }>;
  cities: Array<{
    id: string;
    name: string;
    size: number;
    position: { x: number; y: number };
  }>;
  cityIdCounter: number;
  units?: Array<{
    id: string;
    countryId: string;
    type: UnitType;
    strength: number;
    position: { x: number; y: number };
    name?: string;
  }>;
  unitIdCounter?: number;
  diplomacy?: Array<{
    key: string;
    status: DiplomaticStatus;
  }>;
}

export function colorToKey(color: THREE.Color | { r: number; g: number; b: number }): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `${r}_${g}_${b}`;
}

export function keyToColor(key: string): THREE.Color {
  const [r, g, b] = key.split('_').map(Number);
  return new THREE.Color(r / 255, g / 255, b / 255);
}
