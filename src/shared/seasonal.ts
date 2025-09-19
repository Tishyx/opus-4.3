import { MONTHLY_DAYLIGHT_HOURS } from './constants';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const isFiniteNumber = (value: number): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeCyclePosition = (value: number, period: number): number => {
  if (period <= 0) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
};

const findNearestFiniteValue = (
  values: number[],
  startIndex: number,
  fallback: number,
): number => {
  const length = values.length;

  if (length === 0) {
    return fallback;
  }

  for (let offset = 0; offset < length; offset += 1) {
    const backwardIndex = (startIndex - offset + length) % length;
    const backwardValue = values[backwardIndex];
    if (isFiniteNumber(backwardValue)) {
      return backwardValue;
    }

    const forwardIndex = (startIndex + offset) % length;
    const forwardValue = values[forwardIndex];
    if (isFiniteNumber(forwardValue)) {
      return forwardValue;
    }
  }

  return fallback;
};

export function toMonthValue(month: number): number {
  if (!Number.isFinite(month)) {
    return 0;
  }
  return month - 1;
}

export function sampleMonthlyCycle(monthValue: number, values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const period = values.length;
  const wrapped = normalizeCyclePosition(monthValue, period);
  const lowerIndex = Math.floor(wrapped);
  const upperIndex = (lowerIndex + 1) % period;
  const fraction = wrapped - lowerIndex;
  const lowerValue = findNearestFiniteValue(values, lowerIndex, 0);
  const upperValue = findNearestFiniteValue(values, upperIndex, lowerValue);

  if (!isFiniteNumber(lowerValue) && !isFiniteNumber(upperValue)) {
    return 0;
  }

  if (!isFiniteNumber(lowerValue)) {
    return upperValue;
  }

  if (!isFiniteNumber(upperValue)) {
    return lowerValue;
  }

  return lowerValue + (upperValue - lowerValue) * fraction;
}

export function getDaylightHoursFromMonthValue(monthValue: number): number {
  const daylightHours = sampleMonthlyCycle(monthValue, MONTHLY_DAYLIGHT_HOURS);
  return clamp(daylightHours, 0, 24);
}

export function getDaylightHoursForMonth(month: number): number {
  const monthValue = toMonthValue(month);
  return getDaylightHoursFromMonthValue(monthValue);
}

export function getSunCycleFromMonthValue(monthValue: number): {
  daylightHours: number;
  sunriseHour: number;
  sunsetHour: number;
} {
  const daylightHours = getDaylightHoursFromMonthValue(monthValue);
  const clampedDaylight = clamp(daylightHours, 0, 24);
  const sunriseHour = clamp(12 - clampedDaylight / 2, 0, 24);
  const sunsetHour = clamp(sunriseHour + clampedDaylight, 0, 24);

  return {
    daylightHours: clampedDaylight,
    sunriseHour,
    sunsetHour,
  };
}

export function getSunCycleForMonth(month: number): {
  daylightHours: number;
  sunriseHour: number;
  sunsetHour: number;
} {
  const monthValue = toMonthValue(month);
  return getSunCycleFromMonthValue(monthValue);
}
