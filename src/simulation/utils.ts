import {
  GRID_SIZE,
  LAND_COLORS,
  LAND_TYPE_MAP,
  SETTLEMENT_PROPERTIES,
  SOIL_PROPERTIES,
  SOIL_TYPE_MAP,
  URBAN_PROPERTIES,
  WATER_PROPERTIES,
} from '../shared/constants';
import { LAND_TYPES, SOIL_TYPES } from '../shared/types';
import type { SimulationState } from './state';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

export function isInBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

export function getThermalProperties(state: SimulationState, x: number, y: number) {
  const land = state.landCover[y][x];
  if (land === LAND_TYPES.WATER) return WATER_PROPERTIES;
  if (land === LAND_TYPES.URBAN) return URBAN_PROPERTIES;
  if (land === LAND_TYPES.SETTLEMENT) return SETTLEMENT_PROPERTIES;
  const soilType = state.soilType[y][x];
  return SOIL_PROPERTIES[soilType] ?? SOIL_PROPERTIES[SOIL_TYPES.LOAM];
}

export function resolveLandType(tileValue: string): number | undefined {
  return LAND_TYPE_MAP[tileValue];
}

export function resolveSoilType(tileValue: string): number | undefined {
  return SOIL_TYPE_MAP[tileValue];
}

export function getLandColor(state: SimulationState, x: number, y: number, showSoil: boolean): string {
  if (!showSoil) {
    return LAND_COLORS[state.landCover[y][x]];
  }
  return getThermalProperties(state, x, y).color;
}

export function describeSurface(state: SimulationState, x: number, y: number): string {
  return getThermalProperties(state, x, y).name;
}
