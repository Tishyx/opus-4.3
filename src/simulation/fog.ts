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

const MAX_HOURLY_FOG_RATE = 0.6;

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

      const wind = state.windVectorField[y][x];
      const currentFog = state.fogDensity[y][x];
      const relativeHumidity = clamp(state.humidity[y][x], 0, 1);
      const dewPointDiff = state.dewPoint[y][x] - state.temperature[y][x];
      const saturationFactor = clamp((dewPointDiff + 3) / 7, 0, 1);
      const calmFactor = clamp((3 - wind.speed) / 3, 0, 1);
      const soilMoisture = clamp(state.soilMoisture[y][x], 0, 1);
      const hillshade = clamp(state.hillshade[y][x], 0, 1);

      if (state.inversionStrength > 0 && state.elevation[y][x] < state.inversionHeight) {
        const depth = Math.max(0, state.inversionHeight - state.elevation[y][x]);
        const normalizedDepth = clamp(depth / 120, 0, 1);
        formationRate += state.inversionStrength * normalizedDepth * (0.25 + calmFactor * 0.45);
      }

      if (dewPointDiff >= -3) {
        const dewBonus = clamp((dewPointDiff + 3) / 6, 0, 1);
        const humidityBoost = 0.35 + relativeHumidity * 0.65;
        formationRate += dewBonus * humidityBoost * (0.5 + calmFactor * 0.5);
      }

      formationRate += soilMoisture * 0.05 * (0.6 + saturationFactor * 0.4);

      if (state.snowDepth[y][x] > 0) {
        const snowFactor = clamp(state.snowDepth[y][x] / 80, 0, 0.12);
        formationRate += snowFactor * (0.4 + calmFactor * 0.6);
      }

      if (state.waterDistance[y][x] < 8) {
        const waterFactor = clamp((8 - state.waterDistance[y][x]) / 8, 0, 1);
        const nocturnalBoost = sunAltitude <= 0 ? 1.2 : 0.6;
        formationRate += waterFactor * (0.15 + relativeHumidity * 0.25) * nocturnalBoost * (0.4 + calmFactor * 0.6);
      }

      if (wind.speed < 2) {
        formationRate += (2 - wind.speed) * 0.08 * (0.3 + saturationFactor * 0.7);
      }

      if (sunAltitude > 0) {
        const shading = 1 - hillshade;
        dissipationRate += sunAltitude * FOG_SUN_DISSIPATION * (0.7 + shading * 0.6);
      }

      dissipationRate += wind.speed * FOG_WIND_DISSIPATION * (1 + wind.speed / 15);

      if (dewPointDiff < 0) {
        dissipationRate += -dewPointDiff * FOG_TEMP_DISSIPATION * (0.7 + (1 - relativeHumidity) * 0.6);
      }

      dissipationRate += (1 - relativeHumidity) * 0.15;

      if (state.downSlopeWinds[y][x] > 0) {
        dissipationRate += state.downSlopeWinds[y][x] * 0.12;
      }

      if (currentFog > 0.6) {
        dissipationRate += (currentFog - 0.6) * 0.5;
      }

      if (wind.speed >= 6) {
        dissipationRate += (wind.speed - 6) * 0.08;
      }

      fogChangeRate[y][x] = clamp(formationRate - dissipationRate, -MAX_HOURLY_FOG_RATE, MAX_HOURLY_FOG_RATE);
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

