export const LAND_TYPES = {
  GRASSLAND: 0,
  FOREST: 1,
  WATER: 2,
  URBAN: 3,
  SETTLEMENT: 4,
} as const;

export type LandType = (typeof LAND_TYPES)[keyof typeof LAND_TYPES];

export const SOIL_TYPES = {
  LOAM: 0,
  SAND: 1,
  CLAY: 2,
  ROCK: 3,
} as const;

export type SoilType = (typeof SOIL_TYPES)[keyof typeof SOIL_TYPES];
