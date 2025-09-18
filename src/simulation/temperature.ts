import { MONTHLY_TEMPS } from '../shared/constants';

export function calculateBaseTemperature(month: number, hour: number): number {
  const monthTemp = MONTHLY_TEMPS[month - 1];
  const isDayTime = hour >= 6 && hour <= 18;

  if (isDayTime) {
    const hoursSinceSunrise = hour - 6;
    const hourModifier = Math.sin((hoursSinceSunrise / 12) * Math.PI) * 6;
    return monthTemp + hourModifier;
  }

  const nightHours = hour <= 6 ? hour + 6 : hour - 18;
  const nightCooling = -2 - (nightHours / 12) * 2;
  return monthTemp + nightCooling;
}
