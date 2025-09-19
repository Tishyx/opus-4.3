import {
  FOG_ADVECTION_RATE,
  FOG_DIFFUSION_RATE,
  FOG_DOWNSLOPE_RATE,
  FOG_SUN_DISSIPATION,
  FOG_TEMP_DISSIPATION,
  FOG_WIND_DISSIPATION,
  GRID_SIZE,
} from '../shared/constants';
import type { SimulationState } from './state';
import { clamp, computeBoundaryDamping, isInBounds } from './utils';

export function updateFogSimulation(
  state: SimulationState,
  hour: number,
  sunAltitude: number,
  timeFactor: number
): void {
  if (timeFactor <= 0) return;

  const fogChangeRate: number[][] = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(0));

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      let formationRate = 0;
      let dissipationRate = 0;

      if (state.inversionStrength > 0 && state.elevation[y][x] < state.inversionHeight) {
        const depth = (state.inversionHeight - state.elevation[y][x]) / 100;
        formationRate += state.inversionStrength * depth * 0.5;
      }

      if (state.temperature[y][x] < state.dewPoint[y][x] + 2) {
        const saturation = (state.dewPoint[y][x] + 2 - state.temperature[y][x]) / 4;
        formationRate += saturation * state.humidity[y][x];
      }

      if (sunAltitude <= 0 && state.waterDistance[y][x] < 5) {
        formationRate += ((5 - state.waterDistance[y][x]) / 5) * 0.3 * (1 - state.windVectorField[y][x].speed / 20);
      }

      if (sunAltitude > 0) {
        dissipationRate += sunAltitude * FOG_SUN_DISSIPATION;
      }

      dissipationRate += state.windVectorField[y][x].speed * FOG_WIND_DISSIPATION;

      if (state.temperature[y][x] > state.dewPoint[y][x]) {
        dissipationRate += (state.temperature[y][x] - state.dewPoint[y][x]) * FOG_TEMP_DISSIPATION;
      }

      fogChangeRate[y][x] = formationRate - dissipationRate;
    }
  }

  const newFogDensity = state.fogDensity.map((row) => [...row]);
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      newFogDensity[y][x] += fogChangeRate[y][x] * timeFactor;

      const wind = state.windVectorField[y][x];
      if (wind.speed > 0.5) {
        const rawUpwindX = x - wind.x * 0.2;
        const rawUpwindY = y - wind.y * 0.2;
        const upwindX = clamp(Math.round(rawUpwindX), 0, GRID_SIZE - 1);
        const upwindY = clamp(Math.round(rawUpwindY), 0, GRID_SIZE - 1);
        const boundaryFactor = computeBoundaryDamping(rawUpwindX, rawUpwindY);
        const sourceFog = state.fogDensity[upwindY][upwindX] * boundaryFactor;
        const advectionChange =
          (sourceFog - state.fogDensity[y][x]) *
          FOG_ADVECTION_RATE *
          Math.min(1, wind.speed / 10);
        newFogDensity[y][x] += advectionChange * timeFactor;
      }

      let highNeighborFog = 0;
      let elevDiffSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!isInBounds(nx, ny)) {
            continue;
          }
          const elevDiff = state.elevation[ny][nx] - state.elevation[y][x];
          if (elevDiff > 0) {
            highNeighborFog += state.fogDensity[ny][nx] * elevDiff;
            elevDiffSum += elevDiff;
          }
        }
      }
      if (elevDiffSum > 0) {
        const avgHighNeighborFog = highNeighborFog / elevDiffSum;
        const downslopeChange = (avgHighNeighborFog - state.fogDensity[y][x]) * FOG_DOWNSLOPE_RATE;
        newFogDensity[y][x] += downslopeChange * timeFactor;
      }

      const neighborOffsets: Array<[number, number]> = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ];
      let neighborSum = 0;
      let neighborCount = 0;
      for (const [dx, dy] of neighborOffsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInBounds(nx, ny)) {
          neighborSum += state.fogDensity[ny][nx];
        } else {
          neighborSum += state.fogDensity[y][x];
        }
        neighborCount++;
      }
      const avgNeighborFog = neighborSum / Math.max(1, neighborCount);
      const diffusionChange = (avgNeighborFog - state.fogDensity[y][x]) * FOG_DIFFUSION_RATE;
      newFogDensity[y][x] += diffusionChange * timeFactor;
    }
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      state.fogDensity[y][x] = clamp(newFogDensity[y][x], 0, 1);
    }
  }
}

