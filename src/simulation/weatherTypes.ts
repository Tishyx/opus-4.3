export const CLOUD_TYPES = {
  NONE: 0,
  CUMULUS: 1,
  STRATUS: 2,
  CUMULONIMBUS: 3,
  OROGRAPHIC: 4,
  CIRRUS: 5,
  ALTOSTRATUS: 6,
} as const;

export type CloudType = (typeof CLOUD_TYPES)[keyof typeof CLOUD_TYPES];

export const PRECIP_TYPES = {
  NONE: 0,
  RAIN: 1,
  SNOW: 2,
  SLEET: 3,
  FREEZING_RAIN: 4,
  GRAUPEL: 5,
} as const;

export type PrecipitationType = (typeof PRECIP_TYPES)[keyof typeof PRECIP_TYPES];
