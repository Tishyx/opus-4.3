import { CELL_SIZE, GRID_SIZE } from '../shared/constants';
import { LAND_TYPES, SOIL_TYPES } from '../shared/types';
import type { SimulationState } from './state';
import { CLOUD_TYPES, PRECIP_TYPES } from './weatherTypes';
import { clamp, getThermalProperties, isInBounds } from './utils';
import { calculateBaseTemperature } from './temperature';

type ConvectiveClouds = {
  development: number;
  type: number;
  cape: number;
  thermalStrength: number;
};

type CloudMicrophysics = {
  ice: number;
  dropletSize: number;
  precipEfficiency: number;
  graupel: number;
};

type PrecipitationResult = {
  rate: number;
  type: number;
};

type CloudRadiation = {
  solarTransmission: number;
  longwaveWarming: number;
};

function calculateCloudCoverage(state: SimulationState, x: number, y: number, hour: number): number {
  let coverage = 0;

  if (state.humidity[y][x] > 0.7) {
    coverage = (state.humidity[y][x] - 0.7) / 0.3;
  }

  if (hour >= 12 && hour <= 17) {
    const afternoonFactor = Math.sin(((hour - 12) / 5) * Math.PI);
    coverage += afternoonFactor * 0.3;
  }

  if (state.landCover[y][x] === LAND_TYPES.WATER) {
    coverage += 0.2;
  }

  return Math.min(1, coverage);
}

function calculateOrographicClouds(
  state: SimulationState,
  x: number,
  y: number,
  windSpeed: number,
  windDir: number
): number {
  if (windSpeed < 5) {
    return 0;
  }

  const windDirRad = (windDir * Math.PI) / 180;
  const windX = Math.sin(windDirRad);
  const windY = -Math.cos(windDirRad);

  let isWindward = false;
  let liftAmount = 0;

  if (isInBounds(x - 1, y - 1) && isInBounds(x + 1, y + 1)) {
    const dzdx = (state.elevation[y][x + 1] - state.elevation[y][x - 1]) / (2 * CELL_SIZE);
    const dzdy = (state.elevation[y + 1][x] - state.elevation[y - 1][x]) / (2 * CELL_SIZE);

    const slopeDotWind = dzdx * windX + dzdy * windY;

    if (slopeDotWind > 0) {
      isWindward = true;
      liftAmount = (slopeDotWind * windSpeed) / 10;
    }
  }

  if (!isWindward) {
    return 0;
  }

  const dewPointDeficit = state.temperature[y][x] - state.dewPoint[y][x];
  const LCL = 125 * dewPointDeficit;
  const forcedLift = liftAmount * 100;

  if (forcedLift > LCL) {
    const excessLift = forcedLift - LCL;
    const humidityFactor = state.humidity[y][x];
    const temperatureFactor = clamp(1 - Math.abs(state.temperature[y][x] - 15) / 20, 0.2, 1);

    return clamp((excessLift / 1000) * humidityFactor * temperatureFactor, 0, 2);
  }

  return 0;
}

function calculatePrecipitation(state: SimulationState, x: number, y: number): PrecipitationResult {
  const localCloudWater = state.cloudWater[y][x];
  const localCloudType = state.cloudType[y][x];

  let precipRate = 0;
  let precipType = PRECIP_TYPES.NONE;

  if (localCloudType === CLOUD_TYPES.CUMULONIMBUS) {
    precipRate = localCloudWater * 1.5;
  } else if (localCloudType === CLOUD_TYPES.CUMULUS) {
    precipRate = localCloudWater * 0.7;
  } else if (localCloudType === CLOUD_TYPES.NIMBOSTRATUS) {
    precipRate = localCloudWater * 0.9;
  } else if (localCloudType === CLOUD_TYPES.STRATUS) {
    precipRate = localCloudWater * 0.5;
  }

  const precipEfficiency = state.cloudWater[y][x] > 0.5 ? 0.6 : 0.3;
  const precipProbability = Math.min(1, state.cloudWater[y][x] * 0.7);

  if (Math.random() < precipProbability) {
    const randomFactor = 0.7 + Math.random() * 0.6;
    precipRate = localCloudWater * precipEfficiency * randomFactor;
  }

  precipRate = Math.min(precipRate, 2);

  if (precipRate > 0.01) {
    if (state.temperature[y][x] > 2) {
      precipType = PRECIP_TYPES.RAIN;
    } else if (state.temperature[y][x] <= -5) {
      precipType = PRECIP_TYPES.SNOW;
    } else {
      precipType = PRECIP_TYPES.SLEET;
    }
  } else {
    precipRate = 0;
    precipType = PRECIP_TYPES.NONE;
  }

  return { rate: precipRate, type: precipType };
}

function calculateConvectiveClouds(
  state: SimulationState,
  x: number,
  y: number,
  month: number,
  hour: number
): ConvectiveClouds {
  const baseTemp = calculateBaseTemperature(month, hour);
  let thermal = 0;

  if (hour >= 10 && hour <= 17) {
    const tempExcess = state.temperature[y][x] - baseTemp;

    if (state.landCover[y][x] === LAND_TYPES.URBAN) {
      thermal = tempExcess * 1.3;
    } else if (state.soilType[y][x] === SOIL_TYPES.SAND) {
      thermal = tempExcess * 1.1;
    } else if (state.landCover[y][x] === LAND_TYPES.GRASSLAND) {
      thermal = tempExcess;
    } else if (
      state.landCover[y][x] === LAND_TYPES.WATER ||
      state.landCover[y][x] === LAND_TYPES.FOREST
    ) {
      thermal = tempExcess * 0.5;
    }
  }

  const cape = Math.max(0, thermal * state.humidity[y][x] * 100);

  let cloudDevelopment = 0;
  let cloudTypeResult = CLOUD_TYPES.NONE;

  if (cape > 500) {
    cloudDevelopment = Math.min(1, cape / 3000);
    cloudTypeResult = cape > 2000 ? CLOUD_TYPES.CUMULONIMBUS : CLOUD_TYPES.CUMULUS;
  }

  return {
    development: cloudDevelopment,
    type: cloudTypeResult,
    cape,
    thermalStrength: thermal,
  };
}

function calculateCloudMicrophysics(
  state: SimulationState,
  x: number,
  y: number,
  updraftSpeed: number
): CloudMicrophysics {
  let iceContent = state.iceContent[y][x];
  let dropletSize = 5;
  let precipitationEfficiency = 0;

  if (state.temperature[y][x] < 0 && state.cloudWater[y][x] > 0) {
    const freezingRate = Math.exp(-state.temperature[y][x] / 10);
    iceContent = state.cloudWater[y][x] * freezingRate;
    state.cloudWater[y][x] *= 1 - freezingRate * 0.5;
  }

  if (state.temperature[y][x] > 0 && state.cloudWater[y][x] > 0.3) {
    dropletSize = 5 + updraftSpeed * 2;
    if (dropletSize > 20) {
      precipitationEfficiency = Math.min(1, dropletSize / 50);
    }
  }

  let graupelFormation = 0;
  if (state.temperature[y][x] > -10 && state.temperature[y][x] < 0 && updraftSpeed > 5) {
    graupelFormation = iceContent * 0.3;
  }

  return {
    ice: iceContent,
    dropletSize,
    precipEfficiency: precipitationEfficiency,
    graupel: graupelFormation,
  };
}

function updateHumidity(
  state: SimulationState,
  x: number,
  y: number,
  windSpeed: number,
  precipRate: number,
  precipType: number,
  timeFactor: number
): void {
  let evaporationRate = 0;

  if (state.landCover[y][x] === LAND_TYPES.WATER) {
    evaporationRate = 2 * Math.max(0, state.temperature[y][x] / 30) * (1 + windSpeed / 20);
  } else if (state.landCover[y][x] === LAND_TYPES.FOREST) {
    evaporationRate = 1 * Math.max(0, state.temperature[y][x] / 30);
  } else if (state.soilMoisture[y][x] > 0) {
    const thermalProps = getThermalProperties(state, x, y);
    const soilEvap = state.soilMoisture[y][x] * thermalProps.evaporation;
    evaporationRate = soilEvap * Math.max(0, state.temperature[y][x] / 30);
  }

  let precipReductionRate = 0;
  if (precipRate > 0 && precipType !== PRECIP_TYPES.SNOW) {
    precipReductionRate = precipRate * 10;
  }

  const humidityChange = ((evaporationRate - precipReductionRate) * timeFactor) / 100;
  state.humidity[y][x] = clamp(state.humidity[y][x] + humidityChange, 0.01, 1);

  const a = 17.27;
  const b = 237.7;
  const relHumidity = state.humidity[y][x];
  const gamma = Math.log(relHumidity) + (a * state.temperature[y][x]) / (b + state.temperature[y][x]);
  state.dewPoint[y][x] = (b * gamma) / (a - gamma);
}

function smoothCloudFields(state: SimulationState): void {
  const smoothed = state.cloudCoverage.map((row) => [...row]);

  for (let y = 1; y < GRID_SIZE - 1; y++) {
    for (let x = 1; x < GRID_SIZE - 1; x++) {
      let sum = 0;
      let count = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += state.cloudCoverage[y + dy][x + dx];
          count++;
        }
      }

      smoothed[y][x] = sum / count;
    }
  }

  state.cloudCoverage = smoothed;
}

export function updateCloudDynamics(
  state: SimulationState,
  params: { month: number; hour: number; windSpeed: number; windDir: number; timeFactor: number }
): void {
  const { month, hour, windSpeed, windDir, timeFactor } = params;

  if (timeFactor <= 0) {
    return;
  }

  const sunAltitude = Math.max(0, Math.sin(((hour - 6) * Math.PI) / 12));

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const orographicFormationRate =
        calculateOrographicClouds(state, x, y, windSpeed, windDir) * 2;

      const convective = calculateConvectiveClouds(state, x, y, month, hour);
      const convectiveFormationRate = convective.development * 2;

      state.convectiveEnergy[y][x] = convective.cape;
      state.thermalStrength[y][x] = convective.thermalStrength;

      let cloudFormationRate = 0;
      if (orographicFormationRate > 0.5) {
        state.cloudType[y][x] = CLOUD_TYPES.OROGRAPHIC;
        cloudFormationRate = orographicFormationRate;
        state.cloudBase[y][x] = state.elevation[y][x] + 100;
        state.cloudTop[y][x] = state.elevation[y][x] + 500 + orographicFormationRate * 1000;
      } else if (convectiveFormationRate > 0.3) {
        state.cloudType[y][x] = convective.type;
        cloudFormationRate = convectiveFormationRate;
        state.cloudBase[y][x] = state.elevation[y][x] + 500;
        state.cloudTop[y][x] = state.elevation[y][x] + 500 + convective.cape;
      } else if (state.fogDensity[y][x] > 0.5) {
        state.cloudType[y][x] = CLOUD_TYPES.STRATUS;
        cloudFormationRate = state.fogDensity[y][x] * 0.5;
        state.cloudBase[y][x] = state.elevation[y][x];
        state.cloudTop[y][x] = state.elevation[y][x] + 200;
      } else {
        state.cloudType[y][x] = CLOUD_TYPES.NONE;
      }

      const solarDissipationRate = sunAltitude > 0 ? state.cloudWater[y][x] * sunAltitude * 0.8 : 0;

      const precip = calculatePrecipitation(state, x, y);
      const precipRate = precip.rate;
      state.precipitation[y][x] = precipRate;
      state.precipitationType[y][x] = precip.type;
      const precipWaterLossRate = precipRate * 0.1;

      const cloudWaterChange = (cloudFormationRate - solarDissipationRate - precipWaterLossRate) * timeFactor;
      state.cloudWater[y][x] = clamp(state.cloudWater[y][x] + cloudWaterChange, 0, 1.5);

      state.cloudCoverage[y][x] = Math.min(1, state.cloudWater[y][x]);
      state.cloudOpticalDepth[y][x] = state.cloudWater[y][x] * 10;

      updateHumidity(state, x, y, windSpeed, precipRate, precip.type, timeFactor);

      const updraft = state.thermalStrength[y][x] * 2;
      const microphysics = calculateCloudMicrophysics(state, x, y, updraft);
      state.iceContent[y][x] = microphysics.ice;

      if (precipRate > 0) {
        if (precip.type === PRECIP_TYPES.SNOW) {
          const snowAccumulation = precipRate * 10 * timeFactor;
          state.snowDepth[y][x] += snowAccumulation;
          state.latentHeatEffect[y][x] += precipRate * 0.8;
        } else {
          const thermalProps = getThermalProperties(state, x, y);
          const infiltration = Math.min(precipRate * timeFactor, 1 - state.soilMoisture[y][x]);
          state.soilMoisture[y][x] += infiltration * thermalProps.waterRetention;
        }
      }
    }
  }

  smoothCloudFields(state);
}

export function calculateCloudRadiation(
  state: SimulationState,
  x: number,
  y: number,
  sunAltitude: number
): CloudRadiation {
  let solarTransmission = 1;
  if (state.cloudCoverage[y][x] > 0) {
    const opticalPath = state.cloudOpticalDepth[y][x] / Math.max(0.1, Math.sin(sunAltitude));
    solarTransmission =
      1 - state.cloudCoverage[y][x] + state.cloudCoverage[y][x] * Math.exp(-opticalPath);
  }

  let longwaveEffect = 0;
  if (state.cloudCoverage[y][x] > 0) {
    longwaveEffect = state.cloudCoverage[y][x] * 3;
  }

  return {
    solarTransmission,
    longwaveWarming: longwaveEffect,
  };
}

export { calculateCloudCoverage };
