import { LAND_TYPES, SOIL_TYPES } from './types';

export const GRID_SIZE = 100;
export const CELL_SIZE = 6;
export const BASE_ELEVATION = 100;
export const LAPSE_RATE = 0.65; // °C per 100m
export const SOLAR_INTENSITY_FACTOR = 1.5;
export const SHADOW_COOLING = 0.8;
export const WIND_CHILL_FACTOR = 0.03;
export const COLD_AIR_FLOW_INTENSITY = 2;
export const DIFFUSION_ITERATIONS = 2;
export const DIFFUSION_RATE = 0.08;
export const URBAN_HEAT_RADIUS = 60;
export const SETTLEMENT_HEAT_RADIUS = 4;
export const FOG_WIND_DISSIPATION = 0.02;
export const FOG_SUN_DISSIPATION = 0.5;
export const FOG_TEMP_DISSIPATION = 0.3;
export const FOG_ADVECTION_RATE = 0.1;
export const FOG_DOWNSLOPE_RATE = 0.2;
export const FOG_DIFFUSION_RATE = 0.4;
export const EPSILON = 1e-6;

export const MONTHLY_TEMPS = [-10, -8, -3, 2, 8, 13, 15, 15, 8, 2, -4, -9];

export const LAND_TYPE_MAP: Record<string, number> = {
  grassland: LAND_TYPES.GRASSLAND,
  forest: LAND_TYPES.FOREST,
  water: LAND_TYPES.WATER,
  urban: LAND_TYPES.URBAN,
  settlement: LAND_TYPES.SETTLEMENT,
};

export const SOIL_TYPE_MAP: Record<string, number> = {
  loam: SOIL_TYPES.LOAM,
  sand: SOIL_TYPES.SAND,
  clay: SOIL_TYPES.CLAY,
  rock: SOIL_TYPES.ROCK,
};

export const WATER_PROPERTIES = {
  name: 'Water',
  color: '#4a9eff',
  heatCapacity: 15.0,
  conductivity: 4.0,
  waterRetention: 1.0,
  albedo: 0.08,
  evaporation: 1.5,
};

export const URBAN_PROPERTIES = {
  name: 'Urban',
  color: '#8b8b8b',
  heatCapacity: 1.6,
  conductivity: 2.0,
  waterRetention: 0.05,
  albedo: 0.12,
  evaporation: 0.1,
};

export const SETTLEMENT_PROPERTIES = {
  name: 'Settlement',
  color: '#a67c52',
  heatCapacity: 1.3,
  conductivity: 1.6,
  waterRetention: 0.2,
  albedo: 0.18,
  evaporation: 0.4,
};

export const SOIL_PROPERTIES = {
  [SOIL_TYPES.LOAM]: {
    name: 'Loam',
    color: '#8B7355',
    heatCapacity: 1.0,
    conductivity: 1.0,
    waterRetention: 0.7,
    albedo: 0.2,
    evaporation: 1.0,
  },
  [SOIL_TYPES.SAND]: {
    name: 'Sand',
    color: '#F4E4BC',
    heatCapacity: 0.8,
    conductivity: 0.4,
    waterRetention: 0.2,
    albedo: 0.55,
    evaporation: 1.2,
  },
  [SOIL_TYPES.CLAY]: {
    name: 'Clay',
    color: '#A0522D',
    heatCapacity: 1.1,
    conductivity: 1.3,
    waterRetention: 0.9,
    albedo: 0.15,
    evaporation: 0.6,
  },
  [SOIL_TYPES.ROCK]: {
    name: 'Rock/Bedrock',
    color: '#696969',
    heatCapacity: 1.2,
    conductivity: 2.0,
    waterRetention: 0.1,
    albedo: 0.25,
    evaporation: 0.1,
  },
};

export const LAND_COLORS = {
  [LAND_TYPES.GRASSLAND]: '#90b56a',
  [LAND_TYPES.FOREST]: '#2d5a2d',
  [LAND_TYPES.WATER]: '#4a9eff',
  [LAND_TYPES.URBAN]: '#8b8b8b',
  [LAND_TYPES.SETTLEMENT]: '#a67c52',
};
