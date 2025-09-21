import { BASE_ELEVATION, CELL_SIZE, GRID_SIZE } from '../shared/constants';
import { LAND_TYPES, type LandType, SOIL_TYPES, type SoilType } from '../shared/types';
import { CLOUD_TYPES, type CloudType, PRECIP_TYPES, type PrecipitationType } from './weatherTypes';

export type VectorFieldCell = { x: number; y: number; speed: number };

type Grid<T = number> = T[][];

export type VectorField = VectorFieldCell[][];

function createGrid<T>(initialValue: T): Grid<T> {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(initialValue));
}

function createVectorField(): VectorField {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ x: 0, y: 0, speed: 0 }))
  );
}

export interface SimulationState {
  elevation: Grid<number>;
  landCover: Grid<LandType>;
  soilType: Grid<SoilType>;
  temperature: Grid<number>;
  hillshade: Grid<number>;
  waterDistance: Grid<number>;
  nearestWaterAreaId: Grid<number>;
  forestDistance: Grid<number>;
  nearestForestAreaId: Grid<number>;
  forestDepth: Grid<number>;
  urbanDistance: Grid<number>;
  contiguousAreas: Grid<number>;
  areaSizes: Map<number, number>;
  inversionHeight: number;
  inversionStrength: number;
  fogDensity: Grid<number>;
  downSlopeWinds: Grid<number>;
  windVectorField: VectorField;
  foehnEffect: Grid<number>;
  inversionAndDownslopeRate: Grid<number>;
  soilMoisture: Grid<number>;
  soilTemperature: Grid<number>;
  cloudCoverage: Grid<number>;
  cloudBase: Grid<number>;
  cloudTop: Grid<number>;
  cloudType: Grid<CloudType>;
  cloudOpticalDepth: Grid<number>;
  precipitation: Grid<number>;
  precipitationType: Grid<PrecipitationType>;
  humidity: Grid<number>;
  dewPoint: Grid<number>;
  convectiveEnergy: Grid<number>;
  thermalStrength: Grid<number>;
  cloudWater: Grid<number>;
  iceContent: Grid<number>;
  latentHeatEffect: Grid<number>;
  snowDepth: Grid<number>;
  currentBrush: string;
  currentBrushCategory: string;
  brushSize: number;
  terrainStrength: number;
  isDrawing: boolean;
  isRightClick: boolean;
  isSimulating: boolean;
  simulationTime: number;
  simulationSpeed: number;
  lastFrameTime: number;
}

export function createSimulationState(): SimulationState {
  return {
    elevation: createGrid(BASE_ELEVATION),
    landCover: createGrid(LAND_TYPES.GRASSLAND),
    soilType: createGrid(SOIL_TYPES.LOAM),
    temperature: createGrid(20),
    hillshade: createGrid(1),
    waterDistance: createGrid(Number.POSITIVE_INFINITY),
    nearestWaterAreaId: createGrid(0),
    forestDistance: createGrid(Number.POSITIVE_INFINITY),
    nearestForestAreaId: createGrid(0),
    forestDepth: createGrid(0),
    urbanDistance: createGrid(Number.POSITIVE_INFINITY),
    contiguousAreas: createGrid(0),
    areaSizes: new Map<number, number>(),
    inversionHeight: 0,
    inversionStrength: 0,
    fogDensity: createGrid(0),
    downSlopeWinds: createGrid(0),
    windVectorField: createVectorField(),
    foehnEffect: createGrid(0),
    inversionAndDownslopeRate: createGrid(0),
    soilMoisture: createGrid(0),
    soilTemperature: createGrid(20),
    cloudCoverage: createGrid(0),
    cloudBase: createGrid(0),
    cloudTop: createGrid(0),
    cloudType: createGrid(CLOUD_TYPES.NONE),
    cloudOpticalDepth: createGrid(0),
    precipitation: createGrid(0),
    precipitationType: createGrid(PRECIP_TYPES.NONE),
    humidity: createGrid(0.5),
    dewPoint: createGrid(10),
    convectiveEnergy: createGrid(0),
    thermalStrength: createGrid(0),
    cloudWater: createGrid(0),
    iceContent: createGrid(0),
    latentHeatEffect: createGrid(0),
    snowDepth: createGrid(0),
    currentBrush: 'terrain',
    currentBrushCategory: 'terrain',
    brushSize: 15,
    terrainStrength: 5,
    isDrawing: false,
    isRightClick: false,
    isSimulating: false,
    simulationTime: 6 * 60,
    simulationSpeed: 10,
    lastFrameTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

export function resetGrid<T>(grid: Grid<T>, value: T): void {
  for (let y = 0; y < GRID_SIZE; y++) {
    grid[y].fill(value);
  }
}

export function resetVectorField(field: VectorField): void {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      field[y][x].x = 0;
      field[y][x].y = 0;
      field[y][x].speed = 0;
    }
  }
}

export function resizeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = GRID_SIZE * CELL_SIZE;
  canvas.height = GRID_SIZE * CELL_SIZE;
}
