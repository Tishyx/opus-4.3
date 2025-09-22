import { LAND_TYPES, type LandType, SOIL_TYPES, type SoilType } from './types';

export const GRID_SIZE = 100;
export const CELL_SIZE = 6;
export const BASE_ELEVATION = 100;
export const LAPSE_RATE = 0.65; // °C per 100m
export const SOLAR_INTENSITY_FACTOR = 1.35;
export const SHADOW_COOLING = 0.65;
export const WIND_CHILL_FACTOR = 0.025;
export const COLD_AIR_FLOW_INTENSITY = 1.6;
export const DIFFUSION_ITERATIONS = 3;
export const DIFFUSION_RATE = 0.05;
export const URBAN_HEAT_RADIUS = 45;
export const SETTLEMENT_HEAT_RADIUS = 18;
export const FOG_WIND_DISSIPATION = 0.03;
export const FOG_SUN_DISSIPATION = 0.45;
export const FOG_TEMP_DISSIPATION = 0.25;
export const FOG_ADVECTION_RATE = 0.08;
export const FOG_DOWNSLOPE_RATE = 0.15;
export const FOG_DIFFUSION_RATE = 0.35;
export const EPSILON = 1e-6;

export const MONTHLY_TEMPS = [-6, -4, 1, 8, 14, 18, 20, 19, 14, 8, 2, -3];
export const MONTHLY_DAYLIGHT_HOURS = [8.6, 9.7, 11.7, 13.8, 15.2, 16.0, 15.4, 13.8, 11.9, 10.3, 8.9, 8.2];
export const MONTHLY_DIURNAL_VARIATION = [4.0, 4.5, 6.0, 7.5, 9.0, 10.0, 9.2, 7.8, 6.2, 5.0, 4.3, 3.8];

export const LAND_TYPE_MAP = {
  grassland: LAND_TYPES.GRASSLAND,
  forest: LAND_TYPES.FOREST,
  water: LAND_TYPES.WATER,
  urban: LAND_TYPES.URBAN,
  settlement: LAND_TYPES.SETTLEMENT,
} as const satisfies Record<string, LandType>;

export const SOIL_TYPE_MAP = {
  loam: SOIL_TYPES.LOAM,
  sand: SOIL_TYPES.SAND,
  clay: SOIL_TYPES.CLAY,
  rock: SOIL_TYPES.ROCK,
} as const satisfies Record<string, SoilType>;

export const WATER_PROPERTIES = {
  name: 'Water',
  color: '#4a9eff',
  heatCapacity: 12.0,
  conductivity: 3.2,
  waterRetention: 1.0,
  albedo: 0.07,
  evaporation: 1.3,
};

export const URBAN_PROPERTIES = {
  name: 'Urban',
  color: '#8b8b8b',
  heatCapacity: 1.5,
  conductivity: 1.8,
  waterRetention: 0.07,
  albedo: 0.15,
  evaporation: 0.08,
};

export const SETTLEMENT_PROPERTIES = {
  name: 'Settlement',
  color: '#a67c52',
  heatCapacity: 1.2,
  conductivity: 1.3,
  waterRetention: 0.25,
  albedo: 0.22,
  evaporation: 0.32,
};

export const SOIL_PROPERTIES = {
  [SOIL_TYPES.LOAM]: {
    name: 'Loam',
    color: '#8B7355',
    heatCapacity: 1.05,
    conductivity: 0.9,
    waterRetention: 0.65,
    albedo: 0.22,
    evaporation: 0.95,
  },
  [SOIL_TYPES.SAND]: {
    name: 'Sand',
    color: '#F4E4BC',
    heatCapacity: 0.75,
    conductivity: 0.35,
    waterRetention: 0.18,
    albedo: 0.6,
    evaporation: 1.1,
  },
  [SOIL_TYPES.CLAY]: {
    name: 'Clay',
    color: '#A0522D',
    heatCapacity: 1.15,
    conductivity: 1.1,
    waterRetention: 0.95,
    albedo: 0.14,
    evaporation: 0.55,
  },
  [SOIL_TYPES.ROCK]: {
    name: 'Rock/Bedrock',
    color: '#696969',
    heatCapacity: 1.1,
    conductivity: 1.8,
    waterRetention: 0.08,
    albedo: 0.28,
    evaporation: 0.08,
  },
};

export const LAND_COLORS = {
  [LAND_TYPES.GRASSLAND]: '#90b56a',
  [LAND_TYPES.FOREST]: '#2d5a2d',
  [LAND_TYPES.WATER]: '#4a9eff',
  [LAND_TYPES.URBAN]: '#8b8b8b',
  [LAND_TYPES.SETTLEMENT]: '#a67c52',
};
