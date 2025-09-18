import {
  BASE_ELEVATION,
  CELL_SIZE,
  GRID_SIZE,
} from '../shared/constants';
import { LAND_TYPES, SOIL_TYPES } from '../shared/types';
import type { SimulationState } from './state';
import { CLOUD_TYPES, PRECIP_TYPES } from './weatherTypes';
import { clamp, distance, isInBounds } from './utils';

function generatePerlinNoise(): number[][] {
  const noise: number[][] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    noise[y] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const nx = (x / GRID_SIZE) * 4;
      const ny = (y / GRID_SIZE) * 4;

      const value =
        BASE_ELEVATION +
        Math.sin(nx * Math.PI) * Math.cos(ny * Math.PI) * 50 +
        Math.sin(nx * Math.PI * 3) * Math.cos(ny * Math.PI * 3) * 20 +
        (Math.random() - 0.5) * 10;

      noise[y][x] = value;
    }
  }
  return noise;
}

function addInitialFeatures(state: SimulationState): void {
  for (let x = 10; x < 90; x++) {
    for (let y = 40; y <= 50; y++) {
      const ridgeHeight = 800 + Math.sin(x / 10) * 200;
      const distFromRidge = Math.abs(y - 45);
      state.elevation[y][x] = ridgeHeight - distFromRidge * 80;
      if (state.elevation[y][x] > 800) {
        state.soilType[y][x] = SOIL_TYPES.ROCK;
      }
    }
  }

  for (let y = 10; y < 30; y++) {
    for (let x = 10; x < 90; x++) {
      const distFromCenter = Math.abs(y - 20);
      state.elevation[y][x] = Math.max(
        60,
        state.elevation[y][x] - (10 - distFromCenter) * 5,
      );
      if (state.elevation[y][x] < 80) {
        state.soilType[y][x] = SOIL_TYPES.CLAY;
      }
    }
  }

  for (let y = 51; y < 70; y++) {
    for (let x = 10; x < 90; x++) {
      const ridgeHeight = 800 + Math.sin(x / 10) * 200;
      const mountainBaseHeight = ridgeHeight - 5 * 80;
      state.elevation[y][x] = Math.max(80, mountainBaseHeight - (y - 50) * 12);
    }
  }

  for (let y = 65; y < 80; y++) {
    for (let x = 30; x < 60; x++) {
      if (Math.random() > 0.3) {
        state.soilType[y][x] = SOIL_TYPES.SAND;
      }
    }
  }

  const lakeX = 27;
  const lakeY = 20;
  const lakeRadius = 6;
  for (let y = lakeY - lakeRadius; y <= lakeY + lakeRadius; y++) {
    for (let x = lakeX - lakeRadius; x <= lakeX + lakeRadius; x++) {
      if (isInBounds(x, y) && distance(x, y, lakeX, lakeY) < lakeRadius) {
        state.landCover[y][x] = LAND_TYPES.WATER;
        state.elevation[y][x] = 65;
      }
    }
  }

  for (let y = 30; y < 45; y++) {
    for (let x = 20; x < 80; x++) {
      if (isInBounds(x, y) && Math.random() > 0.3) {
        state.landCover[y][x] = LAND_TYPES.FOREST;
        state.soilType[y][x] = SOIL_TYPES.LOAM;
      }
    }
  }

  const urbanX = 50;
  const urbanY = 55;
  const urbanRadius = 40;
  for (let y = urbanY - urbanRadius; y <= urbanY + urbanRadius; y++) {
    for (let x = urbanX - urbanRadius; x <= urbanRadius + urbanX; x++) {
      if (
        isInBounds(x, y) &&
        Math.abs(x - urbanX) + Math.abs(y - urbanY) < urbanRadius
      ) {
        state.landCover[y][x] = LAND_TYPES.SETTLEMENT;
      }
    }
  }
}

export function calculateContiguousAreas(state: SimulationState): void {
  state.contiguousAreas = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(0));
  state.areasizes = new Map();
  let areaId = 0;
  const visited = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(false));

  function floodFill(startX: number, startY: number, landType: number) {
    areaId++;
    const queue: [number, number][] = [[startX, startY]];
    const cells: [number, number][] = [];
    visited[startY][startX] = true;

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      cells.push([x, y]);
      state.contiguousAreas[y][x] = areaId;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;

          if (
            isInBounds(nx, ny) &&
            !visited[ny][nx] &&
            state.landCover[ny][nx] === landType
          ) {
            visited[ny][nx] = true;
            queue.push([nx, ny]);
          }
        }
      }
    }

    state.areasizes.set(areaId, cells.length);
    return cells;
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (!visited[y][x]) {
        floodFill(x, y, state.landCover[y][x]);
      }
    }
  }
}

export function calculateDistanceFields(state: SimulationState): void {
  state.waterDistance = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(Infinity));
  state.nearestWaterAreaId = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(0));
  state.forestDistance = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(Infinity));
  state.nearestForestAreaId = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(0));
  state.urbanDistance = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(Infinity));
  state.forestDepth = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(0));

  const waterQueue: [number, number, number, number][] = [];
  const forestQueue: [number, number, number, number][] = [];
  const urbanQueue: [number, number, number][] = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const areaId = state.contiguousAreas[y][x];
      if (state.landCover[y][x] === LAND_TYPES.WATER) {
        state.waterDistance[y][x] = 0;
        state.nearestWaterAreaId[y][x] = areaId;
        waterQueue.push([x, y, 0, areaId]);
      }
      if (state.landCover[y][x] === LAND_TYPES.FOREST) {
        state.forestDistance[y][x] = 0;
        state.nearestForestAreaId[y][x] = areaId;
        forestQueue.push([x, y, 0, areaId]);
      }
      if (
        state.landCover[y][x] === LAND_TYPES.URBAN ||
        state.landCover[y][x] === LAND_TYPES.SETTLEMENT
      ) {
        state.urbanDistance[y][x] = 0;
        urbanQueue.push([x, y, 0]);
      }
    }
  }

  while (waterQueue.length > 0) {
    const [x, y, dist, areaId] = waterQueue.shift()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const newDist = dist + Math.sqrt(dx * dx + dy * dy);
        if (isInBounds(nx, ny) && newDist < state.waterDistance[ny][nx]) {
          state.waterDistance[ny][nx] = newDist;
          state.nearestWaterAreaId[ny][nx] = areaId;
          waterQueue.push([nx, ny, newDist, areaId]);
        }
      }
    }
  }

  while (forestQueue.length > 0) {
    const [x, y, dist, areaId] = forestQueue.shift()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const newDist = dist + Math.sqrt(dx * dx + dy * dy);
        if (isInBounds(nx, ny) && newDist < state.forestDistance[ny][nx]) {
          state.forestDistance[ny][nx] = newDist;
          state.nearestForestAreaId[ny][nx] = areaId;
          forestQueue.push([nx, ny, newDist, areaId]);
        }
      }
    }
  }

  while (urbanQueue.length > 0) {
    const [x, y, dist] = urbanQueue.shift()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const newDist = dist + Math.sqrt(dx * dx + dy * dy);
        if (isInBounds(nx, ny) && newDist < state.urbanDistance[ny][nx]) {
          state.urbanDistance[ny][nx] = newDist;
          urbanQueue.push([nx, ny, newDist]);
        }
      }
    }
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (state.landCover[y][x] === LAND_TYPES.FOREST) {
        let minDistToEdge = Infinity;
        for (let radius = 1; radius < 20; radius++) {
          let foundEdge = false;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                const nx = x + dx;
                const ny = y + dy;
                if (
                  isInBounds(nx, ny) &&
                  state.landCover[ny][nx] !== LAND_TYPES.FOREST
                ) {
                  const d = Math.sqrt(dx * dx + dy * dy);
                  minDistToEdge = Math.min(minDistToEdge, d);
                  foundEdge = true;
                }
              }
            }
          }
          if (foundEdge) break;
        }
        state.forestDepth[y][x] =
          minDistToEdge === Infinity ? 20 : minDistToEdge;
      }
    }
  }
}

export function calculateHillshade(state: SimulationState): void {
  const sunAzimuth = (315 * Math.PI) / 180;
  const sunAltitude = (45 * Math.PI) / 180;

  for (let y = 1; y < GRID_SIZE - 1; y++) {
    for (let x = 1; x < GRID_SIZE - 1; x++) {
      const dzdx =
        (state.elevation[y][x + 1] - state.elevation[y][x - 1]) /
        (2 * CELL_SIZE);
      const dzdy =
        (state.elevation[y + 1][x] - state.elevation[y - 1][x]) /
        (2 * CELL_SIZE);

      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const aspect = Math.atan2(dzdy, dzdx);

      const shade =
        Math.cos(sunAltitude) * Math.cos(slope) +
        Math.sin(sunAltitude) * Math.sin(slope) *
          Math.cos(sunAzimuth - aspect);

      state.hillshade[y][x] = clamp(shade, 0, 1);
    }
  }
}

export function initializeEnvironment(state: SimulationState): void {
  state.elevation = generatePerlinNoise();

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      state.landCover[y][x] = LAND_TYPES.GRASSLAND;

      if (state.elevation[y][x] > 140) {
        state.soilType[y][x] = SOIL_TYPES.ROCK;
      } else if (state.elevation[y][x] < 80) {
        state.soilType[y][x] = Math.random() > 0.5 ? SOIL_TYPES.CLAY : SOIL_TYPES.LOAM;
      } else {
        const rand = Math.random();
        if (rand < 0.4) state.soilType[y][x] = SOIL_TYPES.LOAM;
        else if (rand < 0.7) state.soilType[y][x] = SOIL_TYPES.SAND;
        else state.soilType[y][x] = SOIL_TYPES.CLAY;
      }

      state.temperature[y][x] = 20;
      state.hillshade[y][x] = 1;
      state.waterDistance[y][x] = Infinity;
      state.nearestWaterAreaId[y][x] = 0;
      state.forestDistance[y][x] = Infinity;
      state.nearestForestAreaId[y][x] = 0;
      state.forestDepth[y][x] = 0;
      state.urbanDistance[y][x] = Infinity;
      state.contiguousAreas[y][x] = 0;
      state.fogDensity[y][x] = 0;
      state.downSlopeWinds[y][x] = 0;
      state.windVectorField[y][x].x = 0;
      state.windVectorField[y][x].y = 0;
      state.windVectorField[y][x].speed = 0;
      state.foehnEffect[y][x] = 0;
      state.soilMoisture[y][x] = 0;
      state.soilTemperature[y][x] = 20;
      state.snowDepth[y][x] = 0;
      state.cloudCoverage[y][x] = 0;
      state.cloudBase[y][x] = 0;
      state.cloudTop[y][x] = 0;
      state.cloudType[y][x] = CLOUD_TYPES.NONE;
      state.cloudOpticalDepth[y][x] = 0;
      state.precipitation[y][x] = 0;
      state.precipitationType[y][x] = PRECIP_TYPES.NONE;
      state.humidity[y][x] = 0.5 + Math.random() * 0.2;
      state.dewPoint[y][x] = 10;
      state.convectiveEnergy[y][x] = 0;
      state.thermalStrength[y][x] = 0;
      state.cloudWater[y][x] = 0;
      state.iceContent[y][x] = 0;
      state.latentHeatEffect[y][x] = 0;
    }
  }

  addInitialFeatures(state);
  calculateContiguousAreas(state);
  calculateDistanceFields(state);
  calculateHillshade(state);
}
