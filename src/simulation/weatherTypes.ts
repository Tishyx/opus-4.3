export const CLOUD_TYPES = {
  NONE: 0,
  CUMULUS: 1,
  STRATOCUMULUS: 2,
  STRATUS: 3,
  CUMULONIMBUS: 4,
  OROGRAPHIC: 5,
  CIRRUS: 6,
  ALTOSTRATUS: 7,
  NIMBOSTRATUS: 8,
  ALTOCUMULUS: 9,
  CIRROSTRATUS: 10,
} as const;

export type CloudType = (typeof CLOUD_TYPES)[keyof typeof CLOUD_TYPES];

export const PRECIP_TYPES = {
  NONE: 0,
  DRIZZLE: 1,
  RAIN: 2,
  SNOW: 3,
  SLEET: 4,
  FREEZING_RAIN: 5,
  GRAUPEL: 6,
  HAIL: 7,
} as const;

export type PrecipitationType = (typeof PRECIP_TYPES)[keyof typeof PRECIP_TYPES];
