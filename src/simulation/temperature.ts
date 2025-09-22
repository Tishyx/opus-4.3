import {
  MONTHLY_DAYLIGHT_HOURS,
  MONTHLY_DIURNAL_VARIATION,
  MONTHLY_TEMPS,
} from '../shared/constants';
import {
  getDaylightHoursFromMonthValue,
  sampleMonthlyCycle,
  toMonthValue,
} from '../shared/seasonal';
import type { ClimateOverrides } from './climate';

const arrayMin = (values: readonly number[]) =>
  values.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY);

const arrayMax = (values: readonly number[]) =>
  values.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY);

const MIN_DAYLIGHT_HOURS = arrayMin(MONTHLY_DAYLIGHT_HOURS);
const MAX_DAYLIGHT_HOURS = arrayMax(MONTHLY_DAYLIGHT_HOURS);
const MAX_DIURNAL_VARIATION = arrayMax(MONTHLY_DIURNAL_VARIATION);
const ANNUAL_MEAN_TEMP =
  MONTHLY_TEMPS.length > 0
    ? MONTHLY_TEMPS.reduce((sum, value) => sum + value, 0) / MONTHLY_TEMPS.length
    : 0;

const EVENING_WARMTH_BASE = 0.12;
const EVENING_WARMTH_RANGE = 0.05;
const EVENING_WARMTH_DIURNAL_WEIGHT = 0.04;
const PREDAWN_WARMTH_BASE = 0.28;
const PREDAWN_WARMTH_RANGE = 0.12;
const PREDAWN_WARMTH_DIURNAL_WEIGHT = 0.08;
const PREDAWN_WINDOW_BASE = 2.2;
const PREDAWN_WINDOW_RANGE = 1.0;
const PREDAWN_WINDOW_DIURNAL_WEIGHT = 0.4;
const SEASONAL_LAG_MONTHS = 0.6;
const NIGHT_COOLING_BASE = 0.78;
const NIGHT_COOLING_RANGE = 0.14;
const NIGHT_COOLING_DIURNAL_WEIGHT = 0.5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const clamp01 = (value: number) => clamp(value, 0, 1);

const normalizeSpan = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }
  if (max <= min) {
    return 0;
  }
  return clamp01((value - min) / (max - min));
};

const normalizeHour = (hour: number) => {
  if (!Number.isFinite(hour)) {
    return 0;
  }
  const wrapped = hour % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped;
};

const smoothstep = (edge0: number, edge1: number, value: number) => {
  if (edge1 === edge0) {
    return 0;
  }
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const computeTemperatureProfileParams = (
  daylightHours: number,
  diurnalRange: number,
  maxDiurnalVariation: number,
) => {
  const daylightFactor = normalizeSpan(daylightHours, MIN_DAYLIGHT_HOURS, MAX_DAYLIGHT_HOURS);
  const nightFactor = 1 - daylightFactor;
  const safeMaxDiurnal = Math.max(maxDiurnalVariation, 0.1);
  const diurnalFactor = normalizeSpan(diurnalRange, 0, safeMaxDiurnal);

  const eveningWarmthFraction = clamp01(
    EVENING_WARMTH_BASE +
      EVENING_WARMTH_RANGE * daylightFactor +
      EVENING_WARMTH_DIURNAL_WEIGHT * diurnalFactor * daylightFactor,
  );

  const preDawnWarmthFraction = clamp01(
    PREDAWN_WARMTH_BASE +
      PREDAWN_WARMTH_RANGE * nightFactor +
      PREDAWN_WARMTH_DIURNAL_WEIGHT * diurnalFactor * nightFactor,
  );

  const preDawnWindowHours =
    PREDAWN_WINDOW_BASE +
    PREDAWN_WINDOW_RANGE * nightFactor * (0.6 + PREDAWN_WINDOW_DIURNAL_WEIGHT * (1 - diurnalFactor));

  const nightCoolingExponent =
    NIGHT_COOLING_BASE +
    NIGHT_COOLING_RANGE * nightFactor * (0.5 + NIGHT_COOLING_DIURNAL_WEIGHT * (1 - diurnalFactor));

  return {
    eveningWarmthFraction,
    preDawnWarmthFraction,
    preDawnWindowHours,
    nightCoolingExponent,
  };
};

export function calculateBaseTemperature(
  month: number,
  hour: number,
  overrides?: Partial<ClimateOverrides>,
): number {
  const monthValue = toMonthValue(month);
  const safeOverrides = overrides ?? {};
  const seasonalIntensityRaw = safeOverrides.seasonalIntensity;
  const baseTemperatureOffset = Number.isFinite(safeOverrides.baseTemperatureOffset)
    ? (safeOverrides.baseTemperatureOffset as number)
    : 0;
  const seasonalShift = Number.isFinite(safeOverrides.seasonalShift)
    ? (safeOverrides.seasonalShift as number)
    : 0;
  const safeSeasonalIntensity = Number.isFinite(seasonalIntensityRaw)
    ? clamp(seasonalIntensityRaw as number, 0, 4)
    : 1;

  const shiftedMonthValue = monthValue + seasonalShift;
  const normalizedHour = normalizeHour(hour);

  const seasonalAverage = sampleMonthlyCycle(shiftedMonthValue - SEASONAL_LAG_MONTHS, MONTHLY_TEMPS);
  const daylightHours = getDaylightHoursFromMonthValue(shiftedMonthValue);
  const baseDiurnalRange = Math.max(0, sampleMonthlyCycle(shiftedMonthValue, MONTHLY_DIURNAL_VARIATION));

  const averageTemp =
    ANNUAL_MEAN_TEMP + (seasonalAverage - ANNUAL_MEAN_TEMP) * safeSeasonalIntensity + baseTemperatureOffset;
  const diurnalRange = baseDiurnalRange * safeSeasonalIntensity;

  const {
    eveningWarmthFraction,
    preDawnWarmthFraction,
    preDawnWindowHours,
    nightCoolingExponent,
  } = computeTemperatureProfileParams(
    daylightHours,
    diurnalRange,
    MAX_DIURNAL_VARIATION * Math.max(safeSeasonalIntensity, 1),
  );

  const sunrise = 12 - daylightHours / 2;
  const sunset = 12 + daylightHours / 2;
  const midday = (sunrise + sunset) / 2;
  const totalNightHours = Math.max(24 - daylightHours, 0.1);

  const maxTemp = averageTemp + diurnalRange / 2;
  const minTemp = averageTemp - diurnalRange / 2;
  const eveningTemp = averageTemp + diurnalRange * eveningWarmthFraction;

  const isDayTime = normalizedHour >= sunrise && normalizedHour <= sunset;

  if (isDayTime && daylightHours > 0) {
    if (normalizedHour <= midday) {
      const riseDuration = Math.max(midday - sunrise, 0.1);
      const progress = clamp01((normalizedHour - sunrise) / riseDuration);
      const warmFactor = Math.sin((progress * Math.PI) / 2);
      return minTemp + (maxTemp - minTemp) * warmFactor;
    }

    const setDuration = Math.max(sunset - midday, 0.1);
    const progress = clamp01((normalizedHour - midday) / setDuration);
    const coolFactor = Math.cos((progress * Math.PI) / 2);
    return eveningTemp + (maxTemp - eveningTemp) * coolFactor;
  }

  const hoursSinceSunset =
    normalizedHour > sunset
      ? normalizedHour - sunset
      : normalizedHour + (24 - sunset);
  const nightProgress = clamp01(hoursSinceSunset / totalNightHours);
  const coolingBase = Math.cos((nightProgress * Math.PI) / 2);
  const adjustedCooling = Math.pow(clamp01(coolingBase), nightCoolingExponent);
  let nightTemperature = minTemp + (eveningTemp - minTemp) * adjustedCooling;

  const hoursUntilSunrise =
    normalizedHour < sunrise
      ? sunrise - normalizedHour
      : 24 - normalizedHour + sunrise;
  const twilightWindow = Math.min(preDawnWindowHours, totalNightHours);

  if (daylightHours > 0 && hoursUntilSunrise <= twilightWindow) {
    const warmUpProgress = smoothstep(
      0,
      twilightWindow,
      twilightWindow - hoursUntilSunrise,
    );
    const preDawnTarget = minTemp + (maxTemp - minTemp) * preDawnWarmthFraction;
    nightTemperature =
      nightTemperature * (1 - warmUpProgress) + preDawnTarget * warmUpProgress;
  }

  return nightTemperature;
}
