import { clamp } from './utils';

export interface ClimateOverrides {
  baseTemperatureOffset: number;
  humidityTarget: number;
  seasonalIntensity: number;
  seasonalShift: number;
}

export const DEFAULT_CLIMATE_OVERRIDES: ClimateOverrides = {
  baseTemperatureOffset: 0,
  humidityTarget: 0.6,
  seasonalIntensity: 1,
  seasonalShift: 0,
};

export function blendHumidityTowardsTarget(
  currentHumidity: number,
  targetHumidity: number,
  blendFactor: number,
): number {
  const safeCurrent = clamp(currentHumidity, 0, 1);
  const safeTarget = clamp(targetHumidity, 0, 1);
  const safeBlend = clamp(blendFactor, 0, 1);
  return safeCurrent + (safeTarget - safeCurrent) * safeBlend;
}
