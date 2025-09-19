import { MONTHLY_DAYLIGHT_HOURS } from './constants';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

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
  const wrapped = ((monthValue % period) + period) % period;
  const lowerIndex = Math.floor(wrapped);
  const upperIndex = (lowerIndex + 1) % period;
  const fraction = wrapped - lowerIndex;
  const lowerValue = values[lowerIndex];
  const upperValue = values[upperIndex];
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
