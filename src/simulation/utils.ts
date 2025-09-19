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
import { LAND_TYPES, type LandType, SOIL_TYPES, type SoilType } from '../shared/types';
import type { SimulationState } from './state';

type ThermalProperties =
  | typeof WATER_PROPERTIES
  | typeof URBAN_PROPERTIES
  | typeof SETTLEMENT_PROPERTIES
  | (typeof SOIL_PROPERTIES)[SoilType];

const LAND_TYPE_VALUES = new Set<LandType>(Object.values(LAND_TYPES) as LandType[]);
const SOIL_TYPE_VALUES = new Set<SoilType>(Object.values(SOIL_TYPES) as SoilType[]);

const LAND_TYPE_ALIASES: Record<string, LandType> = {
  city: LAND_TYPES.URBAN,
  town: LAND_TYPES.SETTLEMENT,
  village: LAND_TYPES.SETTLEMENT,
  farmland: LAND_TYPES.GRASSLAND,
  meadow: LAND_TYPES.GRASSLAND,
  plain: LAND_TYPES.GRASSLAND,
  woodland: LAND_TYPES.FOREST,
  forested: LAND_TYPES.FOREST,
  mixedforest: LAND_TYPES.FOREST,
  lake: LAND_TYPES.WATER,
  river: LAND_TYPES.WATER,
  ocean: LAND_TYPES.WATER,
  coast: LAND_TYPES.WATER,
};

const SOIL_TYPE_ALIASES: Record<string, SoilType> = {
  loamy: SOIL_TYPES.LOAM,
  silt: SOIL_TYPES.LOAM,
  silty: SOIL_TYPES.LOAM,
  sandy: SOIL_TYPES.SAND,
  dunes: SOIL_TYPES.SAND,
  clayey: SOIL_TYPES.CLAY,
  peat: SOIL_TYPES.LOAM,
  rocky: SOIL_TYPES.ROCK,
  bedrock: SOIL_TYPES.ROCK,
};

const DEFAULT_SOIL_TYPE = SOIL_TYPES.LOAM;
const DEFAULT_THERMAL_PROPERTIES = SOIL_PROPERTIES[DEFAULT_SOIL_TYPE];
const DEFAULT_LAND_COLOR = LAND_COLORS[LAND_TYPES.GRASSLAND];

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildNormalizedLookup<T>(
  base: Record<string, T>,
  aliases: Record<string, T>
): Record<string, T> {
  const lookup: Record<string, T> = {};

  for (const [key, value] of Object.entries(base)) {
    lookup[normalizeLookupKey(key)] = value;
  }

  for (const [key, value] of Object.entries(aliases)) {
    lookup[normalizeLookupKey(key)] = value;
  }

  return lookup;
}

const NORMALIZED_LAND_TYPE_MAP = buildNormalizedLookup(LAND_TYPE_MAP, LAND_TYPE_ALIASES);
const NORMALIZED_SOIL_TYPE_MAP = buildNormalizedLookup(SOIL_TYPE_MAP, SOIL_TYPE_ALIASES);

function isValidLandType(value: number): value is LandType {
  return LAND_TYPE_VALUES.has(value as LandType);
}

function isValidSoilType(value: number): value is SoilType {
  return SOIL_TYPE_VALUES.has(value as SoilType);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeBoundaryDamping(x: number, y: number): number {
  const maxIndex = GRID_SIZE - 1;
  const overflowX = x < 0 ? -x : x > maxIndex ? x - maxIndex : 0;
  const overflowY = y < 0 ? -y : y > maxIndex ? y - maxIndex : 0;
  const overflow = overflowX + overflowY;
  if (overflow <= 0) {
    return 1;
  }

  return Math.exp(-overflow * 0.5);
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

export function isInBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

export function getThermalProperties(
  state: SimulationState,
  x: number,
  y: number
): ThermalProperties {
  if (!isInBounds(x, y)) {
    return DEFAULT_THERMAL_PROPERTIES;
  }

  const land = state.landCover[y]?.[x];
  if (land === LAND_TYPES.WATER) return WATER_PROPERTIES;
  if (land === LAND_TYPES.URBAN) return URBAN_PROPERTIES;
  if (land === LAND_TYPES.SETTLEMENT) return SETTLEMENT_PROPERTIES;

  const soilType = state.soilType[y]?.[x];
  if (soilType !== undefined && isValidSoilType(soilType)) {
    return SOIL_PROPERTIES[soilType];
  }

  return DEFAULT_THERMAL_PROPERTIES;
}

export function resolveLandType(tileValue: string): LandType | undefined {
  if (!tileValue) {
    return undefined;
  }

  const numericValue = Number.parseInt(tileValue, 10);
  if (!Number.isNaN(numericValue) && isValidLandType(numericValue)) {
    return numericValue;
  }

  const normalized = normalizeLookupKey(tileValue);
  if (!normalized) {
    return undefined;
  }

  return NORMALIZED_LAND_TYPE_MAP[normalized];
}

export function resolveSoilType(tileValue: string): SoilType | undefined {
  if (!tileValue) {
    return undefined;
  }

  const numericValue = Number.parseInt(tileValue, 10);
  if (!Number.isNaN(numericValue) && isValidSoilType(numericValue)) {
    return numericValue;
  }

  const normalized = normalizeLookupKey(tileValue);
  if (!normalized) {
    return undefined;
  }

  return NORMALIZED_SOIL_TYPE_MAP[normalized];
}

export function getLandColor(state: SimulationState, x: number, y: number, showSoil: boolean): string {
  if (!isInBounds(x, y)) {
    return showSoil ? DEFAULT_THERMAL_PROPERTIES.color : DEFAULT_LAND_COLOR;
  }

  if (!showSoil) {
    const landType = state.landCover[y][x];
    return LAND_COLORS[landType] ?? DEFAULT_LAND_COLOR;
  }

  return getThermalProperties(state, x, y).color;
}

export function describeSurface(state: SimulationState, x: number, y: number): string {
  if (!isInBounds(x, y)) {
    return DEFAULT_THERMAL_PROPERTIES.name;
  }

  return getThermalProperties(state, x, y).name;
}
