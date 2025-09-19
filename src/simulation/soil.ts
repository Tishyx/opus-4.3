import { GRID_SIZE } from '../shared/constants';
import { LAND_TYPES } from '../shared/types';
import type { SimulationState } from './state';
import { clamp, getThermalProperties, isInBounds } from './utils';

const WATER_PROXIMITY_RADIUS = 15;
const WATER_MAX_INFLUENCE = 0.35;
const FOREST_CANOPY_RETENTION = 0.14;
const GRASSLAND_RETENTION = 0.06;
const URBAN_RUNOFF_PENALTY = 0.2;
const SETTLEMENT_RUNOFF_PENALTY = 0.1;
const SHADE_RETENTION = 0.12;
const FOREST_EDGE_RADIUS = 12;
const FOREST_EDGE_BONUS = 0.08;
const BASE_RETENTION_WEIGHT = 0.55;
const HIGHLAND_THRESHOLD = 900;
const HIGHLAND_DRAINAGE = 0.18;
const ALPINE_THRESHOLD = 1300;
const ALPINE_ADDITIONAL_DRAINAGE = 0.1;
const MICRO_VARIATION_STRENGTH = 0.06;

function pseudoRandom(x: number, y: number): number {
  const seed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return seed - Math.floor(seed);
}

function computeSlopeFactor(state: SimulationState, x: number, y: number): number {
  let totalDifference = 0;
  let samples = 0;
  const currentElevation = state.elevation[y][x];

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const nx = x + dx;
      const ny = y + dy;

      if (!isInBounds(nx, ny)) {
        continue;
      }

      totalDifference += Math.abs(currentElevation - state.elevation[ny][nx]);
      samples++;
    }
  }

  if (samples === 0) {
    return 0;
  }

  const averageDifference = totalDifference / samples;
  return clamp(averageDifference / 180, 0, 1);
}

export function initializeSoilMoisture(state: SimulationState): void {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (state.landCover[y][x] === LAND_TYPES.WATER) {
        state.soilMoisture[y][x] = 1;
        continue;
      }

      const thermalProps = getThermalProperties(state, x, y);
      let baseMoisture = thermalProps.waterRetention * BASE_RETENTION_WEIGHT + 0.05;

      const slopeFactor = computeSlopeFactor(state, x, y);
      if (slopeFactor > 0) {
        baseMoisture *= 1 - slopeFactor * 0.6;
      }

      const hillshade = clamp(state.hillshade[y][x] ?? 1, 0, 1);
      const shadeBonus = (1 - hillshade) * SHADE_RETENTION;
      baseMoisture += shadeBonus;

      const waterDistance = state.waterDistance[y][x];
      if (Number.isFinite(waterDistance) && waterDistance <= WATER_PROXIMITY_RADIUS) {
        const proximity = 1 - waterDistance / WATER_PROXIMITY_RADIUS;
        baseMoisture += proximity * WATER_MAX_INFLUENCE * thermalProps.waterRetention;
      }

      const forestDistance = state.forestDistance[y][x];
      if (Number.isFinite(forestDistance) && forestDistance <= FOREST_EDGE_RADIUS) {
        const forestInfluence = 1 - forestDistance / FOREST_EDGE_RADIUS;
        baseMoisture += forestInfluence * FOREST_EDGE_BONUS;
      }

      switch (state.landCover[y][x]) {
        case LAND_TYPES.FOREST:
          baseMoisture += FOREST_CANOPY_RETENTION;
          break;
        case LAND_TYPES.GRASSLAND:
          baseMoisture += GRASSLAND_RETENTION;
          break;
        case LAND_TYPES.URBAN:
          baseMoisture -= URBAN_RUNOFF_PENALTY;
          break;
        case LAND_TYPES.SETTLEMENT:
          baseMoisture -= SETTLEMENT_RUNOFF_PENALTY;
          break;
      }

      const elevation = state.elevation[y][x];
      if (elevation > HIGHLAND_THRESHOLD) {
        const highlandFactor = Math.min(1, (elevation - HIGHLAND_THRESHOLD) / 400);
        baseMoisture -= highlandFactor * HIGHLAND_DRAINAGE;
        if (elevation > ALPINE_THRESHOLD) {
          const alpineFactor = Math.min(1, (elevation - ALPINE_THRESHOLD) / 500);
          baseMoisture -= alpineFactor * ALPINE_ADDITIONAL_DRAINAGE;
        }
      }

      const noise = pseudoRandom(x, y) - 0.5;
      baseMoisture += noise * MICRO_VARIATION_STRENGTH;

      state.soilMoisture[y][x] = clamp(baseMoisture, 0, 1);
    }
  }
}

