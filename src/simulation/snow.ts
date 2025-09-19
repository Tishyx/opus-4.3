import { GRID_SIZE, SOLAR_INTENSITY_FACTOR } from '../shared/constants';
import { LAND_TYPES } from '../shared/types';
import type { SimulationState } from './state';
import { clamp } from './utils';

const DEGREE_DAY_MELT_FACTOR = 0.35;
const SOLAR_MELT_FACTOR = 1.1;
const FOREST_SHADE_FACTOR = 0.55;
const GROUND_MELT_FACTOR = 0.18;
const MELT_TO_SOIL_MOISTURE = 0.1;
const LATENT_COOLING_PER_CM = 0.08;
const MIN_AIR_TEMP_AFTER_MELT = -4;
const SUBLIMATION_RATE = 0.18;
const SETTLING_BASE_RATE = 0.005;
const SETTLING_DEEP_SNOW_THRESHOLD = 25;
const SETTLING_MAX_RATE = 0.02;
const REFREEZE_RATE = 0.02;

export function updateSnowCover(
  state: SimulationState,
  temperatureGrid: number[][],
  sunAltitude: number,
  timeFactor: number
): void {
  if (timeFactor <= 0) {
    return;
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      let depth = state.snowDepth[y][x];
      if (depth <= 0 && sunAltitude <= 0) {
        continue;
      }

      const airTemp = temperatureGrid[y][x];
      const soilTemp = state.soilTemperature[y][x];
      const humidity = clamp(state.humidity[y][x] ?? 0.5, 0, 1);

      if (depth > 0) {
        const sunShade =
          state.landCover[y][x] === LAND_TYPES.FOREST ? FOREST_SHADE_FACTOR : 1;
        const meltFromAir = Math.max(0, airTemp) * DEGREE_DAY_MELT_FACTOR;
        const meltFromGround = Math.max(0, soilTemp) * GROUND_MELT_FACTOR;
        const meltFromSun = sunAltitude > 0 ? sunAltitude * SOLAR_MELT_FACTOR * sunShade : 0;
        const meltDepth = Math.min(
          depth,
          (meltFromAir + meltFromGround + meltFromSun) * timeFactor
        );

        if (meltDepth > 0) {
          depth -= meltDepth;

          const latentCooling = Math.min(
            Math.max(airTemp, 0),
            meltDepth * LATENT_COOLING_PER_CM
          );
          temperatureGrid[y][x] = Math.max(
            MIN_AIR_TEMP_AFTER_MELT,
            temperatureGrid[y][x] - latentCooling
          );

          const availableCapacity = 1 - state.soilMoisture[y][x];
          if (availableCapacity > 0) {
            const meltMoisture = meltDepth * MELT_TO_SOIL_MOISTURE;
            const infiltration = Math.min(meltMoisture, availableCapacity);
            state.soilMoisture[y][x] += infiltration;
          }
        }

        const settlingRate = Math.min(
          SETTLING_MAX_RATE,
          SETTLING_BASE_RATE + Math.max(0, depth - SETTLING_DEEP_SNOW_THRESHOLD) / 800
        );

        if (settlingRate > 0 && depth > 0) {
          const settlingLoss = depth * settlingRate * timeFactor;
          depth = Math.max(0, depth - settlingLoss);
        }
      }

      if (depth > 0 && sunAltitude > 0 && airTemp <= 0) {
        const dryness = 1 - humidity;
        if (dryness > 0) {
          const sublimationLoss = dryness * sunAltitude * SUBLIMATION_RATE * timeFactor;
          depth = Math.max(0, depth - sublimationLoss);
        }
      }

      if (airTemp < -1 && soilTemp < 0 && state.soilMoisture[y][x] > 0) {
        const freezePotential = Math.min(
          state.soilMoisture[y][x],
          (Math.abs(airTemp) + Math.abs(soilTemp)) * 0.5 * REFREEZE_RATE * timeFactor
        );

        if (freezePotential > 0) {
          state.soilMoisture[y][x] -= freezePotential;
          depth += freezePotential / MELT_TO_SOIL_MOISTURE;
        }
      }

      state.snowDepth[y][x] = depth;
    }
  }
}

export function calculateSnowEffects(
  state: SimulationState,
  x: number,
  y: number,
  sunAltitude: number
): { albedoEffect: number; insulationEffect: number } {
  if (state.snowDepth[y][x] <= 0) {
    return { albedoEffect: 0, insulationEffect: 0 };
  }

  const depth = state.snowDepth[y][x];
  const albedoDepthFactor = 1 - Math.exp(-depth / 12);
  const snowAlbedo = 0.78;
  const albedoCooling = -snowAlbedo * albedoDepthFactor * sunAltitude * SOLAR_INTENSITY_FACTOR;

  const insulationEffect = 1 - Math.exp(-depth / 18);

  return { albedoEffect: albedoCooling, insulationEffect };
}

