import { BASE_ELEVATION, CELL_SIZE, GRID_SIZE } from '../shared/constants';

type VectorFieldCell = { x: number; y: number; speed: number };

type Grid = number[][];

type VectorField = VectorFieldCell[][];

function createGrid(initialValue: number): Grid {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(initialValue));
}

function createVectorField(): VectorField {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ x: 0, y: 0, speed: 0 }))
  );
}

export interface SimulationState {
  elevation: Grid;
  landCover: Grid;
  soilType: Grid;
  temperature: Grid;
  hillshade: Grid;
  waterDistance: Grid;
  nearestWaterAreaId: Grid;
  forestDistance: Grid;
  nearestForestAreaId: Grid;
  forestDepth: Grid;
  urbanDistance: Grid;
  contiguousAreas: Grid;
  areasizes: Map<number, number>;
  inversionHeight: number;
  inversionStrength: number;
  fogDensity: Grid;
  downSlopeWinds: Grid;
  windVectorField: VectorField;
  foehnEffect: Grid;
  inversionAndDownslopeRate: Grid;
  soilMoisture: Grid;
  soilTemperature: Grid;
  cloudCoverage: Grid;
  cloudBase: Grid;
  cloudTop: Grid;
  cloudType: Grid;
  cloudOpticalDepth: Grid;
  precipitation: Grid;
  precipitationType: Grid;
  humidity: Grid;
  dewPoint: Grid;
  convectiveEnergy: Grid;
  thermalStrength: Grid;
  cloudWater: Grid;
  iceContent: Grid;
  latentHeatEffect: Grid;
  snowDepth: Grid;
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
    landCover: createGrid(0),
    soilType: createGrid(0),
    temperature: createGrid(20),
    hillshade: createGrid(1),
    waterDistance: createGrid(Number.POSITIVE_INFINITY),
    nearestWaterAreaId: createGrid(0),
    forestDistance: createGrid(Number.POSITIVE_INFINITY),
    nearestForestAreaId: createGrid(0),
    forestDepth: createGrid(0),
    urbanDistance: createGrid(Number.POSITIVE_INFINITY),
    contiguousAreas: createGrid(0),
    areasizes: new Map<number, number>(),
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
    cloudType: createGrid(0),
    cloudOpticalDepth: createGrid(0),
    precipitation: createGrid(0),
    precipitationType: createGrid(0),
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
    lastFrameTime: performance.now(),
  };
}

export function resetGrid(grid: Grid, value: number): void {
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
