import * as THREE from 'three';
import { GoogleGenAI } from '@google/genai';
import { Unit } from './types';
import { DiplomacyState, isAtWar } from './diplomacy';

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export interface MovementPlan {
  unitId: string;
  waypoints: THREE.Vector2[];
  reasoning: string;
  error?: string;
}

export interface GameContext {
  units: Unit[];
  cities: Array<{ id: string; name: string; position: THREE.Vector2; countryId?: string }>;
  countries: Array<{ id: string; name: string }>;
  diplomacy: DiplomacyState;
}

const API_KEY_STORAGE = 'gemini_api_key';
let client: GoogleGenAI | null = null;

export function createGeminiConfig(apiKey: string, model = 'gemini-2.0-flash'): GeminiConfig {
  client = new GoogleGenAI({ apiKey });
  return { apiKey, model };
}

export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE);
}

export function storeApiKey(key: string) {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearStoredApiKey() {
  localStorage.removeItem(API_KEY_STORAGE);
}

function buildPrompt(command: string, unit: Unit, ctx: GameContext): string {
  const country = ctx.countries.find(c => c.id === unit.countryId);
  const enemies = ctx.countries.filter(c => c.id !== unit.countryId && isAtWar(ctx.diplomacy, unit.countryId, c.id));

  const cityList = ctx.cities.map(city => {
    const dist = Math.hypot(city.position.x - unit.position.x, city.position.y - unit.position.y).toFixed(3);
    const owner = ctx.countries.find(c => c.id === city.countryId)?.name || 'Unknown';
    return `- "${city.name}" at (${city.position.x.toFixed(3)}, ${city.position.y.toFixed(3)}), belongs to ${owner}, distance: ${dist}`;
  }).join('\n');

  return `You are a military AI commander for a strategy map game. Plan unit movements.

COORDINATES: UV system where (0,0) is top-left and (1,1) is bottom-right.

SITUATION:
- Unit: "${unit.id}" (${unit.type}, strength: ${unit.strength})
- Position: (${unit.position.x.toFixed(3)}, ${unit.position.y.toFixed(3)})
- Country: ${country?.name || unit.countryId}

CITIES:
${cityList || 'None'}

ENEMIES: ${enemies.length ? enemies.map(c => c.name).join(', ') : 'None'}

COMMAND: "${command}"

INSTRUCTIONS:
1. Find target location from command
2. Generate 2-5 waypoints from current position to target
3. If command unclear, return empty waypoints with error

RESPONSE (JSON only, no markdown):
{"waypoints": [[x1, y1], [x2, y2], ...], "reasoning": "explanation"}`;
}

function parseResponse(text: string, unitId: string): MovementPlan {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { unitId, waypoints: [], reasoning: 'No JSON found', error: 'Parse error' };

  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.waypoints)) return { unitId, waypoints: [], reasoning: parsed.reasoning || 'Invalid format', error: 'Invalid waypoints' };

  const waypoints = parsed.waypoints
    .filter((wp: unknown) => Array.isArray(wp) && wp.length >= 2)
    .map((wp: number[]) => new THREE.Vector2(Math.max(0, Math.min(1, wp[0])), Math.max(0, Math.min(1, wp[1]))));

  return { unitId, waypoints, reasoning: parsed.reasoning || 'Movement planned' };
}

export async function planMovement(config: GeminiConfig, command: string, unit: Unit, ctx: GameContext): Promise<MovementPlan> {
  if (!client) client = new GoogleGenAI({ apiKey: config.apiKey });

  const response = await client.models.generateContent({
    model: config.model,
    contents: buildPrompt(command, unit, ctx),
    config: { temperature: 0.3, topK: 40, topP: 0.95, maxOutputTokens: 1024 }
  });

  const text = response.text || '';
  if (!text) return { unitId: unit.id, waypoints: [], reasoning: 'Empty response', error: 'No response' };

  const plan = parseResponse(text, unit.id);

  if (plan.waypoints.length > 0 && unit.position.distanceTo(plan.waypoints[0]) > 0.01) {
    plan.waypoints.unshift(unit.position.clone());
  }

  return plan;
}
