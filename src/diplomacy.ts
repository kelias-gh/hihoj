import { DiplomaticStatus } from './types';

export interface DiplomacyState {
  relations: Map<string, DiplomaticStatus>;
}

export interface CountryPair {
  countryA: string;
  countryB: string;
  status: DiplomaticStatus;
}

export function createDiplomacyState(): DiplomacyState {
  return { relations: new Map() };
}

function getKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function getRelation(state: DiplomacyState, a: string, b: string): DiplomaticStatus {
  if (a === b) return 'peace';
  return state.relations.get(getKey(a, b)) || 'peace';
}

export function setRelation(state: DiplomacyState, a: string, b: string, status: DiplomaticStatus) {
  if (a !== b) state.relations.set(getKey(a, b), status);
}

export function toggleRelation(state: DiplomacyState, a: string, b: string): DiplomaticStatus {
  const newStatus = getRelation(state, a, b) === 'peace' ? 'war' : 'peace';
  setRelation(state, a, b, newStatus);
  return newStatus;
}

export function isAtWar(state: DiplomacyState, a: string, b: string): boolean {
  return getRelation(state, a, b) === 'war';
}

export function getAllRelations(state: DiplomacyState, ids: string[]): CountryPair[] {
  const pairs: CountryPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ countryA: ids[i], countryB: ids[j], status: getRelation(state, ids[i], ids[j]) });
    }
  }
  return pairs;
}

export function deserializeDiplomacy(data?: Array<{ key: string; status: DiplomaticStatus }>): DiplomacyState {
  const state = createDiplomacyState();
  if (data) for (const { key, status } of data) state.relations.set(key, status);
  return state;
}
