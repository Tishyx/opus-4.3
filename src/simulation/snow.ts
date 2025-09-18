import { GRID_SIZE, SOLAR_INTENSITY_FACTOR } from '../shared/constants';
import type { SimulationState } from './state';

export function updateSnowCover(
  state: SimulationState,
  temperatureGrid: number[][],
  sunAltitude: number,
  timeFactor: number
): void {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (state.snowDepth[y][x] > 0) {
        if (temperatureGrid[y][x] > 0) {
          const meltRate = temperatureGrid[y][x] * 0.5 + sunAltitude * 2.0;
          const latentCooling = -Math.min(temperatureGrid[y][x], meltRate * 0.15);
          temperatureGrid[y][x] += latentCooling;
          state.snowDepth[y][x] = Math.max(0, state.snowDepth[y][x] - meltRate * timeFactor);
          const meltwater = Math.min((meltRate * timeFactor) / 10, 1 - state.soilMoisture[y][x]);
          state.soilMoisture[y][x] += meltwater;
        }
        if (sunAltitude > 0) {
          state.snowDepth[y][x] = Math.max(0, state.snowDepth[y][x] - sunAltitude * 0.05 * timeFactor);
        }
      }
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

  const snowAlbedo = 0.8;
  const effectiveAlbedo = snowAlbedo * Math.min(1, state.snowDepth[y][x] / 10);
  const albedoCooling = -effectiveAlbedo * sunAltitude * SOLAR_INTENSITY_FACTOR * 1.5;

  const insulationFactor = Math.min(1, state.snowDepth[y][x] / 20);

  return { albedoEffect: albedoCooling, insulationEffect: insulationFactor };
}

