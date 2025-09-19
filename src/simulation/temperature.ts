import { MONTHLY_DIURNAL_VARIATION, MONTHLY_TEMPS } from '../shared/constants';
import {
  getDaylightHoursFromMonthValue,
  sampleMonthlyCycle,
  toMonthValue,
} from '../shared/seasonal';

const EVENING_WARMTH_FRACTION = 0.15;
const PREDAWN_WARMTH_FRACTION = 0.35;
const PREDAWN_WINDOW_HOURS = 2.5;
const SEASONAL_LAG_MONTHS = 0.6;
const NIGHT_COOLING_EXPONENT = 0.85;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const clamp01 = (value: number) => clamp(value, 0, 1);

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

export function calculateBaseTemperature(month: number, hour: number): number {
  const monthValue = toMonthValue(month);
  const normalizedHour = normalizeHour(hour);

  const averageTemp = sampleMonthlyCycle(monthValue - SEASONAL_LAG_MONTHS, MONTHLY_TEMPS);
  const daylightHours = getDaylightHoursFromMonthValue(monthValue);
  const diurnalRange = Math.max(0, sampleMonthlyCycle(monthValue, MONTHLY_DIURNAL_VARIATION));

  const sunrise = 12 - daylightHours / 2;
  const sunset = 12 + daylightHours / 2;
  const midday = (sunrise + sunset) / 2;
  const totalNightHours = Math.max(24 - daylightHours, 0.1);

  const maxTemp = averageTemp + diurnalRange / 2;
  const minTemp = averageTemp - diurnalRange / 2;
  const eveningTemp = averageTemp + diurnalRange * EVENING_WARMTH_FRACTION;

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
  const adjustedCooling = Math.pow(clamp01(coolingBase), NIGHT_COOLING_EXPONENT);
  let nightTemperature = minTemp + (eveningTemp - minTemp) * adjustedCooling;

  const hoursUntilSunrise =
    normalizedHour < sunrise
      ? sunrise - normalizedHour
      : 24 - normalizedHour + sunrise;
  const twilightWindow = Math.min(PREDAWN_WINDOW_HOURS, totalNightHours);

  if (daylightHours > 0 && hoursUntilSunrise <= twilightWindow) {
    const warmUpProgress = smoothstep(
      0,
      twilightWindow,
      twilightWindow - hoursUntilSunrise,
    );
    const preDawnTarget =
      minTemp + (maxTemp - minTemp) * PREDAWN_WARMTH_FRACTION;
    nightTemperature =
      nightTemperature * (1 - warmUpProgress) + preDawnTarget * warmUpProgress;
  }

  return nightTemperature;
}
