import {
  MONTHLY_DAYLIGHT_HOURS,
  MONTHLY_DIURNAL_VARIATION,
  MONTHLY_TEMPS,
} from '../shared/constants';

const EVENING_WARMTH_FRACTION = 0.15;

export function calculateBaseTemperature(month: number, hour: number): number {
  const monthIndex = Math.min(
    Math.max(Math.floor(month) - 1, 0),
    MONTHLY_TEMPS.length - 1,
  );

  const averageTemp = MONTHLY_TEMPS[monthIndex];
  const daylightHours = MONTHLY_DAYLIGHT_HOURS[monthIndex];
  const diurnalRange = MONTHLY_DIURNAL_VARIATION[monthIndex];

  const sunrise = 12 - daylightHours / 2;
  const sunset = 12 + daylightHours / 2;
  const midday = (sunrise + sunset) / 2;
  const totalNightHours = Math.max(24 - daylightHours, 0.1);

  const maxTemp = averageTemp + diurnalRange / 2;
  const minTemp = averageTemp - diurnalRange / 2;
  const eveningTemp = averageTemp + diurnalRange * EVENING_WARMTH_FRACTION;

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const isDayTime = hour >= sunrise && hour <= sunset;

  if (isDayTime && daylightHours > 0) {
    if (hour <= midday) {
      const riseDuration = Math.max(midday - sunrise, 0.1);
      const progress = clamp01((hour - sunrise) / riseDuration);
      const warmFactor = Math.sin((progress * Math.PI) / 2);
      return minTemp + (maxTemp - minTemp) * warmFactor;
    }

    const setDuration = Math.max(sunset - midday, 0.1);
    const progress = clamp01((hour - midday) / setDuration);
    const coolFactor = Math.cos((progress * Math.PI) / 2);
    return eveningTemp + (maxTemp - eveningTemp) * coolFactor;
  }

  const hoursSinceSunset =
    hour > sunset ? hour - sunset : hour + (24 - sunset);
  const nightProgress = clamp01(hoursSinceSunset / totalNightHours);
  const damping = Math.cos((nightProgress * Math.PI) / 2);
  return minTemp + (eveningTemp - minTemp) * damping;
}
