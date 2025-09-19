import { CELL_SIZE, EPSILON, GRID_SIZE } from '../shared/constants';
import { LAND_TYPES } from '../shared/types';
import { resetGrid, resetVectorField, type SimulationState, type VectorField } from './state';
import { isInBounds } from './utils';

type ExitPoint = { elev: number; x: number; y: number };

function clampCoord(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > GRID_SIZE - 1) {
    return GRID_SIZE - 1;
  }
  return value;
}

function bilinearInterpolate(grid: number[][], x: number, y: number): number {
  const clampedX = clampCoord(x);
  const clampedY = clampCoord(y);

  const x1 = Math.floor(clampedX);
  const y1 = Math.floor(clampedY);
  const x2 = Math.min(x1 + 1, GRID_SIZE - 1);
  const y2 = Math.min(y1 + 1, GRID_SIZE - 1);
  const xFrac = clampedX - x1;
  const yFrac = clampedY - y1;

  const p11 = grid[y1][x1];
  const p12 = grid[y2][x1];
  const p21 = grid[y1][x2];
  const p22 = grid[y2][x2];

  const val1 = p11 * (1 - yFrac) + p12 * yFrac;
  const val2 = p21 * (1 - yFrac) + p22 * yFrac;

  return val1 * (1 - xFrac) + val2 * xFrac;
}

export function advectGrid(
  grid: number[][],
  windField: VectorField,
  timeFactor: number
): number[][] {
  const newGrid = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(0));
  const dt = timeFactor * 5;

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const wind = windField[y][x];
      const sourceX = clampCoord(x - wind.x * dt);
      const sourceY = clampCoord(y - wind.y * dt);

      newGrid[y][x] = bilinearInterpolate(grid, sourceX, sourceY);
    }
  }

  return newGrid;
}

export function calculateDownslopeWinds(
  state: SimulationState,
  hour: number,
  baseWindSpeed: number,
  windDir: number,
  windGustiness: number
): void {
  resetGrid(state.downSlopeWinds, 0);
  resetVectorField(state.windVectorField);
  resetGrid(state.foehnEffect, 0);

  const isNightTime = hour <= 6 || hour >= 19;
  const windDirRad = (windDir * Math.PI) / 180;

  const landDragFactors: Record<number, number> = {
    [LAND_TYPES.GRASSLAND]: 0.85,
    [LAND_TYPES.FOREST]: 0.55,
    [LAND_TYPES.WATER]: 0.95,
    [LAND_TYPES.URBAN]: 0.7,
    [LAND_TYPES.SETTLEMENT]: 0.8,
  };

  const getVegetationDrag = (x: number, y: number): number => {
    const landType = state.landCover[y][x];
    let drag = landDragFactors[landType] ?? 0.85;

    if (landType === LAND_TYPES.FOREST) {
      const depth = state.forestDepth[y][x] || 0;
      const depthFactor = 1 - Math.min(1, depth / 20) * 0.4;
      drag *= Math.max(0.2, depthFactor);
    }

    return drag;
  };

  for (let y = 2; y < GRID_SIZE - 2; y++) {
    for (let x = 2; x < GRID_SIZE - 2; x++) {
      const dzdx = (state.elevation[y][x + 2] - state.elevation[y][x - 2]) / (4 * CELL_SIZE);
      const dzdy = (state.elevation[y + 2][x] - state.elevation[y - 2][x]) / (4 * CELL_SIZE);

      const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      const slopeAngle = Math.atan(slope);

      if (isNightTime && slopeAngle > 0.1) {
        const katabaticStrength = Math.min(1, slopeAngle / 0.5) * (1 - baseWindSpeed / 30);

        let isSurfaceSlope = true;
        for (let d = 1; d <= 2; d++) {
          const checkX = Math.round(x - dzdx * d);
          const checkY = Math.round(y - dzdy * d);
          if (isInBounds(checkX, checkY)) {
            const elevDiff = Math.abs(state.elevation[checkY][checkX] - state.elevation[y][x]);
            if (elevDiff > 30) {
              isSurfaceSlope = false;
              break;
            }
          }
        }

        if (isSurfaceSlope) {
          const coldAirFlow = katabaticStrength * 0.8;
          if (slope > EPSILON) {
            state.windVectorField[y][x].x = (-dzdx / slope) * coldAirFlow * 5;
            state.windVectorField[y][x].y = (-dzdy / slope) * coldAirFlow * 5;
            state.windVectorField[y][x].speed = coldAirFlow * 5;
            state.downSlopeWinds[y][x] = -coldAirFlow * 1.5;
          }
        }
      }

      if (baseWindSpeed > 10 && slopeAngle > 0.15) {
        const windX = Math.sin(windDirRad);
        const windY = -Math.cos(windDirRad);

        let isLeeSide = false;
        let maxUpwindHeight = state.elevation[y][x];

        for (let d = 1; d <= 10; d++) {
          const checkX = Math.round(x - windX * d);
          const checkY = Math.round(y - windY * d);

          if (isInBounds(checkX, checkY)) {
            if (state.elevation[checkY][checkX] > maxUpwindHeight + 20) {
              isLeeSide = true;
              maxUpwindHeight = state.elevation[checkY][checkX];
            }
          }
        }

        if (isLeeSide) {
          const descentHeight = maxUpwindHeight - state.elevation[y][x];
          const adiabaticWarming = descentHeight * 0.01;
          const foehnStrength = Math.min(1, descentHeight / 100) * (baseWindSpeed / 30);
          state.foehnEffect[y][x] = Math.min(12, adiabaticWarming * foehnStrength);

          state.windVectorField[y][x].x += windX * foehnStrength * 10;
          state.windVectorField[y][x].y += windY * foehnStrength * 10;
          state.windVectorField[y][x].speed = Math.sqrt(
            state.windVectorField[y][x].x * state.windVectorField[y][x].x +
              state.windVectorField[y][x].y * state.windVectorField[y][x].y
          );
        }
      }

      let higherNeighbors = 0;
      const valleyCheckRadius = 5;
      for (let dy = -valleyCheckRadius; dy <= valleyCheckRadius; dy++) {
        for (let dx = -valleyCheckRadius; dx <= valleyCheckRadius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (isInBounds(nx, ny) && state.elevation[ny][nx] > state.elevation[y][x] + 25) {
            higherNeighbors++;
          }
        }
      }

      const totalNeighbors = Math.pow(valleyCheckRadius * 2 + 1, 2) - 1;
      if (higherNeighbors > totalNeighbors * 0.4) {
        const exits: ExitPoint[] = [];
        for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
          const nx = Math.round(x + valleyCheckRadius * Math.cos(angle));
          const ny = Math.round(y + valleyCheckRadius * Math.sin(angle));
          if (isInBounds(nx, ny)) {
            exits.push({ elev: state.elevation[ny][nx], x: nx, y: ny });
          }
        }
        exits.sort((a, b) => a.elev - b.elev);
        const lowestExits = exits.slice(0, Math.max(2, Math.floor(exits.length / 3)));

        let bestPair: { p1: ExitPoint | null; p2: ExitPoint | null; dist: number } = { p1: null, p2: null, dist: 0 };
        if (lowestExits.length >= 2) {
          for (let i = 0; i < lowestExits.length; i++) {
            for (let j = i + 1; j < lowestExits.length; j++) {
              const p1 = lowestExits[i];
              const p2 = lowestExits[j];
              const distSq = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
              if (distSq > bestPair.dist) {
                bestPair = { p1, p2, dist: distSq };
              }
            }
          }
        }

        let axisVec = { x: 0, y: 0 };
        if (bestPair.p1 && bestPair.p2) {
          axisVec = { x: bestPair.p2.x - bestPair.p1.x, y: bestPair.p2.y - bestPair.p1.y };
        }

        const axisMag = Math.sqrt(axisVec.x * axisVec.x + axisVec.y * axisVec.y);
        if (axisMag > EPSILON) {
          const valleyDirection = { x: axisVec.x / axisMag, y: axisVec.y / axisMag };

          let valleyWidth = 0;
          const perpVec = { x: -valleyDirection.y, y: valleyDirection.x };
          for (const sign of [-1, 1]) {
            for (let d = 1; d < 15; d++) {
              const checkX = Math.round(x + perpVec.x * d * sign);
              const checkY = Math.round(y + perpVec.y * d * sign);
              if (!isInBounds(checkX, checkY) || state.elevation[checkY][checkX] > state.elevation[y][x] + 30) {
                valleyWidth += d;
                break;
              }
              if (d === 14) valleyWidth += d;
            }
          }

          const windX = Math.sin(windDirRad);
          const windY = -Math.cos(windDirRad);
          const alignment = windX * valleyDirection.x + windY * valleyDirection.y;

          const narrownessFactor = Math.max(0, (15 - valleyWidth) / 15);
          const venturiMultiplier = 1.0 + narrownessFactor * 1.2;

          const channelStrength = 0.4 + narrownessFactor * 0.6;

          const baseValleySpeed = baseWindSpeed * Math.abs(alignment);
          const finalValleySpeed = baseValleySpeed * venturiMultiplier;

          const channeledVecX = valleyDirection.x * Math.sign(alignment || 1);
          const channeledVecY = valleyDirection.y * Math.sign(alignment || 1);

          const blendedVecX = windX * (1 - channelStrength) + channeledVecX * channelStrength;
          const blendedVecY = windY * (1 - channelStrength) + channeledVecY * channelStrength;

          state.windVectorField[y][x].x += blendedVecX * finalValleySpeed * 0.8;
          state.windVectorField[y][x].y += blendedVecY * finalValleySpeed * 0.8;
        }
      }
    }
  }

  if (windGustiness > 0) {
    for (let y = 1; y < GRID_SIZE - 1; y++) {
      for (let x = 1; x < GRID_SIZE - 1; x++) {
        let roughness = 0;
        let elevSum = 0;
        let elevSqSum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const elev = state.elevation[y + dy][x + dx];
            elevSum += elev;
            elevSqSum += elev * elev;
          }
        }
        const avgElev = elevSum / 9;
        const stdDev = Math.sqrt(elevSqSum / 9 - avgElev * avgElev);
        roughness = stdDev / 20;

        const thermalTurbulence = (state.thermalStrength[y][x] || 0) / 15;

        const gustFactor = (windGustiness / 100) * (1 + roughness + thermalTurbulence);
        const localWindSpeed =
          Math.sqrt(state.windVectorField[y][x].x ** 2 + state.windVectorField[y][x].y ** 2) + baseWindSpeed;
        const vegetationDrag = getVegetationDrag(x, y);
        const gustMagnitude = localWindSpeed * gustFactor * 0.5 * vegetationDrag;

        state.windVectorField[y][x].x += (Math.random() - 0.5) * 2 * gustMagnitude;
        state.windVectorField[y][x].y += (Math.random() - 0.5) * 2 * gustMagnitude;
      }
    }
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const vec = state.windVectorField[y][x];
      const vegetationDrag = getVegetationDrag(x, y);
      vec.x *= vegetationDrag;
      vec.y *= vegetationDrag;
      vec.speed = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    }
  }

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const vec = state.windVectorField[y][x];
      vec.speed = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    }
  }

  smoothWindField(state);
}

function smoothWindField(state: SimulationState): void {
  const smoothed: VectorField = Array(GRID_SIZE)
    .fill(null)
    .map(() => Array(GRID_SIZE).fill(null).map(() => ({ x: 0, y: 0, speed: 0 })));

  for (let y = 1; y < GRID_SIZE - 1; y++) {
    for (let x = 1; x < GRID_SIZE - 1; x++) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const weight = dx === 0 && dy === 0 ? 4 : 1;
          sumX += state.windVectorField[y + dy][x + dx].x * weight;
          sumY += state.windVectorField[y + dy][x + dx].y * weight;
          count += weight;
        }
      }

      smoothed[y][x].x = sumX / count;
      smoothed[y][x].y = sumY / count;
      smoothed[y][x].speed = Math.sqrt(smoothed[y][x].x * smoothed[y][x].x + smoothed[y][x].y * smoothed[y][x].y);
    }
  }

  for (let y = 1; y < GRID_SIZE - 1; y++) {
    for (let x = 1; x < GRID_SIZE - 1; x++) {
      state.windVectorField[y][x] = smoothed[y][x];
    }
  }
}

