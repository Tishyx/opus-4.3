import {
    BASE_ELEVATION,
    CELL_SIZE,
    DIFFUSION_ITERATIONS,
    DIFFUSION_RATE,
    GRID_SIZE,
    LAPSE_RATE,
    SOLAR_INTENSITY_FACTOR,
} from '../shared/constants';
import { LAND_TYPES } from '../shared/types';
import type { SimulationState } from './state';
import { calculateBaseTemperature } from './temperature';
import { calculateCloudRadiation } from './clouds';
import { calculateSnowEffects, updateSnowCover } from './snow';
import { clamp, computeDewPoint, getThermalProperties, isInBounds } from './utils';
import { ClimateOverrides, DEFAULT_CLIMATE_OVERRIDES, blendHumidityTowardsTarget } from './climate';

export type ThermodynamicsOptions = {
    month: number;
    hour: number;
    sunAltitude: number;
    timeFactor: number;
    enableDiffusion: boolean;
    enableInversions: boolean;
    enableDownslope: boolean;
    climate?: ClimateOverrides;
};

export type SimulationMetrics = {
    minTemperature: number;
    maxTemperature: number;
    avgTemperature: number;
    totalPrecipitation: number;
    maxCloudHeight: number;
    avgSnowDepth: number;
};

const MAX_SOLAR_INTENSITY = 2.4;
const MIN_CLOUD_TRANSMISSION = 0.2;
const INVERSION_WIND_THRESHOLD = 15;
const INVERSION_BASE_OFFSET = 60;
const INVERSION_DEPTH_SCALE = 180;
const INVERSION_TERRAIN_RELIEF_SCALE = 120;
const MAX_INVERSION_THICKNESS = 280;
const INVERSION_COOLING_MULTIPLIER = -3.2;
const WARM_BELT_MULTIPLIER = 2.4;
const WARM_BELT_DECAY = 50;
const DOWNSLOPE_RATE_MIN = -4;
const DOWNSLOPE_RATE_MAX = 9;
const WIND_MIXING_MAX = 0.35;
const WIND_MIXING_DIVISOR = 55;
const HUMIDITY_THERMAL_SENSITIVITY = 0.4;
const HUMIDITY_LATENT_COEFFICIENT = 1.6;
const BASE_TURBULENCE_RATE = 0.055;
const NIGHT_COOLING_BASE = 1.1;
const MAX_HOURLY_TEMP_CHANGE = 7;
const ABSOLUTE_MIN_TEMP = -70;
const ABSOLUTE_MAX_TEMP = 65;
const HUMIDITY_TARGET_RELAXATION = 0.25;

export function calculateInversionLayer(
    state: SimulationState,
    hour: number,
    windSpeed: number,
    cloudCover = 0
): void {
    const isNightTime = hour <= 6 || hour >= 19;

    if (!isNightTime || windSpeed > INVERSION_WIND_THRESHOLD || cloudCover > 0.5) {
        state.inversionHeight = 0;
        state.inversionStrength = 0;
        return;
    }

    let minElev = Infinity;
    let maxElev = -Infinity;
    let valleyElevSum = 0;
    let valleyCount = 0;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const elev = state.elevation[y][x];
            minElev = Math.min(minElev, elev);
            maxElev = Math.max(maxElev, elev);

            if (elev < BASE_ELEVATION + 20) {
                valleyElevSum += elev;
                valleyCount++;
            }
        }
    }

    const valleyAvgElev = valleyCount > 0 ? valleyElevSum / valleyCount : BASE_ELEVATION;
    const terrainRelief = maxElev - minElev;

    const windFactor = Math.max(0, 1 - windSpeed / INVERSION_WIND_THRESHOLD);
    const hourFactor = hour <= 6 ? (6 - hour) / 6 : (hour - 19) / 5;

    state.inversionHeight =
        valleyAvgElev +
        INVERSION_BASE_OFFSET +
        INVERSION_DEPTH_SCALE * windFactor * hourFactor;
    state.inversionStrength =
        windFactor * hourFactor * Math.min(1, terrainRelief / INVERSION_TERRAIN_RELIEF_SCALE);

    state.inversionHeight = Math.min(state.inversionHeight, valleyAvgElev + MAX_INVERSION_THICKNESS);

    if (windSpeed > 10 || terrainRelief < 30) {
        state.inversionStrength *= 0.5;
    }
}

export function calculateSolarInsolation(
    state: SimulationState,
    x: number,
    y: number,
    sunAltitude: number
): number {
    if (sunAltitude <= 0) {
        return 0;
    }

    const centerElev = state.elevation[y][x];

    const leftElev = x > 0 ? state.elevation[y][x - 1] : centerElev;
    const rightElev = x < GRID_SIZE - 1 ? state.elevation[y][x + 1] : centerElev;
    const dzdx =
        x > 0 && x < GRID_SIZE - 1
            ? (rightElev - leftElev) / (2 * CELL_SIZE)
            : x === 0
              ? (rightElev - centerElev) / CELL_SIZE
              : (centerElev - leftElev) / CELL_SIZE;

    const topElev = y > 0 ? state.elevation[y - 1][x] : centerElev;
    const bottomElev = y < GRID_SIZE - 1 ? state.elevation[y + 1][x] : centerElev;
    const dzdy =
        y > 0 && y < GRID_SIZE - 1
            ? (bottomElev - topElev) / (2 * CELL_SIZE)
            : y === 0
              ? (bottomElev - centerElev) / CELL_SIZE
              : (centerElev - topElev) / CELL_SIZE;

    const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    const aspect = Math.atan2(-dzdy, dzdx);

    const sinAltitude = clamp(sunAltitude, 0, 1);
    const cosAltitude = Math.sqrt(Math.max(0, 1 - sinAltitude * sinAltitude));
    const solarIntensity = Math.max(
        0,
        sinAltitude * Math.cos(slope) + cosAltitude * Math.sin(slope) * Math.cos(aspect - Math.PI)
    );

    let cloudReduction = 1;
    if (state.cloudCoverage && state.cloudCoverage[y] && state.cloudCoverage[y][x] > 0) {
        const cloudRadiation = calculateCloudRadiation(state, x, y, sunAltitude);
        cloudReduction = Math.max(MIN_CLOUD_TRANSMISSION, cloudRadiation.solarTransmission);
    }

    return Math.min(MAX_SOLAR_INTENSITY, solarIntensity * SOLAR_INTENSITY_FACTOR * cloudReduction);
}

function calculatePhysicsRates(
    state: SimulationState,
    month: number,
    hour: number,
    enableInversions: boolean,
    enableDownslope: boolean,
    climate: ClimateOverrides
): void {
    state.inversionAndDownslopeRate = Array(GRID_SIZE)
        .fill(null)
        .map(() => Array(GRID_SIZE).fill(0));

    if (enableInversions && state.inversionStrength > 0) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const elev = state.elevation[y][x];
                if (elev < state.inversionHeight) {
                    const depthBelowInversion = state.inversionHeight - elev;
                    const relativeDepth = depthBelowInversion / (state.inversionHeight - BASE_ELEVATION + 50);
                    const coolingEffectRate =
                        state.inversionStrength * relativeDepth * INVERSION_COOLING_MULTIPLIER;
                    state.inversionAndDownslopeRate[y][x] += coolingEffectRate;
                } else if (elev < state.inversionHeight + 100) {
                    const heightAboveInversion = elev - state.inversionHeight;
                    const warmBeltEffectRate =
                        state.inversionStrength * Math.exp(-heightAboveInversion / WARM_BELT_DECAY) *
                        WARM_BELT_MULTIPLIER;

                    if (isInBounds(x - 1, y - 1) && isInBounds(x + 1, y + 1)) {
                        const avgSurrounding =
                            (state.elevation[y - 1][x] +
                                state.elevation[y + 1][x] +
                                state.elevation[y][x - 1] +
                                state.elevation[y][x + 1]) /
                            4;
                        const isSlope = Math.abs(elev - avgSurrounding) < 20;
                        const notValleyFloor = elev > avgSurrounding - 5;
                        if (isSlope && notValleyFloor) {
                            state.inversionAndDownslopeRate[y][x] += warmBeltEffectRate;
                        }
                    }
                }
            }
        }
    }

    if (enableDownslope) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                let totalEffectRate = 0;

                if (state.downSlopeWinds[y][x] < 0) {
                    totalEffectRate += state.downSlopeWinds[y][x];
                }

                if (state.foehnEffect[y][x] > 0) {
                    totalEffectRate += state.foehnEffect[y][x];
                }

                state.inversionAndDownslopeRate[y][x] += clamp(
                    totalEffectRate,
                    DOWNSLOPE_RATE_MIN,
                    DOWNSLOPE_RATE_MAX
                );

                const localWindSpeed = state.windVectorField[y][x].speed;
                if (localWindSpeed > 5) {
                    const mixing = Math.min(WIND_MIXING_MAX, localWindSpeed / WIND_MIXING_DIVISOR);
                    const baseTemp = calculateBaseTemperature(month, hour, climate);
                    const mixingRate = (baseTemp - state.temperature[y][x]) * mixing;
                    state.inversionAndDownslopeRate[y][x] += mixingRate;
                }
            }
        }
    }
}

export function updateThermodynamics(state: SimulationState, options: ThermodynamicsOptions): void {
    const {
        month,
        hour,
        sunAltitude,
        timeFactor,
        enableDiffusion,
        enableInversions,
        enableDownslope,
        climate: climateOverrides = DEFAULT_CLIMATE_OVERRIDES,
    } = options;

    calculatePhysicsRates(state, month, hour, enableInversions, enableDownslope, climateOverrides);

    let newTemperature: number[][] = state.temperature.map(row => [...row]);
    let newSoilTemperature: number[][] = state.soilTemperature.map(row => [...row]);

    if (timeFactor > 0) {
        const humidityBlend = Math.min(Math.max(timeFactor * HUMIDITY_TARGET_RELAXATION, 0), 1);
        const targetHumidity = clamp(climateOverrides.humidityTarget, 0.01, 1);
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const prevAirTemp = state.temperature[y][x];
                const prevSoilTemp = state.soilTemperature[y][x];
                const thermalProps = getThermalProperties(state, x, y);
                let cellHumidity = state.humidity[y][x];

                if (humidityBlend > 0) {
                    cellHumidity = blendHumidityTowardsTarget(cellHumidity, targetHumidity, humidityBlend);
                    state.humidity[y][x] = cellHumidity;
                    state.dewPoint[y][x] = computeDewPoint(prevAirTemp, cellHumidity);
                }

                let airEnergyBalance = 0;
                let soilEnergyBalance = 0;

                const snowEffects = calculateSnowEffects(state, x, y, sunAltitude);

                if (sunAltitude > 0) {
                    const insolation = calculateSolarInsolation(state, x, y, sunAltitude);
                    const surfaceAlbedo = snowEffects.albedoEffect !== 0 ? 0.8 : thermalProps.albedo;
                    const absorbedEnergy = insolation * (1 - surfaceAlbedo);
                    soilEnergyBalance += absorbedEnergy / thermalProps.heatCapacity;
                }

                if (sunAltitude <= 0) {
                    const cloudFactor = 1 - (state.cloudCoverage[y][x] || 0) * 0.75;
                    const coolingRate = NIGHT_COOLING_BASE * cloudFactor;
                    const soilCooling = coolingRate * (1 - snowEffects.insulationEffect);
                    soilEnergyBalance -= soilCooling / thermalProps.heatCapacity;
                    airEnergyBalance -= coolingRate * 0.2;
                }

                const tempDiff = prevSoilTemp - prevAirTemp;
                let exchangeRate = tempDiff * thermalProps.conductivity * 0.8 * (1 - snowEffects.insulationEffect);

                if (thermalProps.name === 'Water') {
                    exchangeRate *= 2.0;
                }

                airEnergyBalance += exchangeRate;
                soilEnergyBalance -= exchangeRate / thermalProps.heatCapacity;

                if (state.soilMoisture[y][x] > 0 && prevAirTemp > 0 && sunAltitude > 0) {
                    const evapCoolingRate = state.soilMoisture[y][x] * thermalProps.evaporation * sunAltitude * 1.0;
                    airEnergyBalance -= evapCoolingRate;
                    soilEnergyBalance -= (evapCoolingRate * 0.5) / thermalProps.heatCapacity;
                    if (state.isSimulating) {
                        state.soilMoisture[y][x] = Math.max(
                            0,
                            state.soilMoisture[y][x] - thermalProps.evaporation * 0.005 * timeFactor
                        );
                    }
                }

                if (state.landCover[y][x] === LAND_TYPES.FOREST) {
                    const depthFactor = Math.min(1, state.forestDepth[y][x] / 12);
                    airEnergyBalance += sunAltitude > 0 ? -1.0 * depthFactor : 0.3 * depthFactor;
                }

                airEnergyBalance += state.inversionAndDownslopeRate[y][x];

                const latentEffect = state.latentHeatEffect[y][x];
                if (latentEffect !== 0) {
                    airEnergyBalance += latentEffect;
                }

                const humidity = clamp(cellHumidity, 0, 1);
                const dewPoint = state.dewPoint[y][x];
                const humidityOffset = (humidity - 0.5) * HUMIDITY_THERMAL_SENSITIVITY;
                airEnergyBalance -= humidityOffset;

                if (humidity > 0.85 && prevAirTemp > dewPoint) {
                    const latentCooling = (humidity - 0.85) * HUMIDITY_LATENT_COEFFICIENT;
                    airEnergyBalance -= latentCooling;
                } else if (humidity < 0.3 && sunAltitude > 0) {
                    const dryHeating = (0.3 - humidity) * HUMIDITY_LATENT_COEFFICIENT * 0.35;
                    airEnergyBalance += dryHeating;
                }

                const stdTempAtElev = 15 - ((state.elevation[y][x] - BASE_ELEVATION) / 100) * LAPSE_RATE;
                airEnergyBalance += (stdTempAtElev - prevAirTemp) * BASE_TURBULENCE_RATE;

                airEnergyBalance = clamp(
                    airEnergyBalance,
                    -MAX_HOURLY_TEMP_CHANGE,
                    MAX_HOURLY_TEMP_CHANGE
                );
                soilEnergyBalance = clamp(
                    soilEnergyBalance,
                    -MAX_HOURLY_TEMP_CHANGE,
                    MAX_HOURLY_TEMP_CHANGE
                );

                newTemperature[y][x] += airEnergyBalance * timeFactor;
                newSoilTemperature[y][x] += soilEnergyBalance * timeFactor;
            }
        }
    }

    updateSnowCover(state, newTemperature, sunAltitude, timeFactor);

    if (enableDiffusion && timeFactor > 0) {
        const sampleTemperature = (grid: number[][], sx: number, sy: number) => {
            const clampedX = clamp(sx, 0, GRID_SIZE - 1);
            const clampedY = clamp(sy, 0, GRID_SIZE - 1);
            return grid[clampedY][clampedX];
        };
        const diffusionRate = DIFFUSION_RATE * Math.min(timeFactor, 1);
        for (let i = 0; i < DIFFUSION_ITERATIONS; i++) {
            const diffusedTemp = newTemperature.map(row => [...row]);
            for (let y = 0; y < GRID_SIZE; y++) {
                for (let x = 0; x < GRID_SIZE; x++) {
                    const north = sampleTemperature(newTemperature, x, y - 1);
                    const south = sampleTemperature(newTemperature, x, y + 1);
                    const west = sampleTemperature(newTemperature, x - 1, y);
                    const east = sampleTemperature(newTemperature, x + 1, y);
                    const avgNeighborTemp = (north + south + west + east) / 4;
                    diffusedTemp[y][x] += (avgNeighborTemp - newTemperature[y][x]) * diffusionRate;
                }
            }
            newTemperature = diffusedTemp;
        }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            newTemperature[y][x] = clamp(newTemperature[y][x], ABSOLUTE_MIN_TEMP, ABSOLUTE_MAX_TEMP);
            newSoilTemperature[y][x] = clamp(newSoilTemperature[y][x], ABSOLUTE_MIN_TEMP, ABSOLUTE_MAX_TEMP);
        }
    }

    state.temperature = newTemperature;
    state.soilTemperature = newSoilTemperature;
}

export function calculateSimulationMetrics(state: SimulationState): SimulationMetrics {
    const totalCells = GRID_SIZE * GRID_SIZE;

    const temperatureValues = state.temperature.flat().filter(Number.isFinite);
    const minTemperature = temperatureValues.length > 0 ? Math.min(...temperatureValues) : 0;
    const maxTemperature = temperatureValues.length > 0 ? Math.max(...temperatureValues) : 0;
    const avgTemperature =
        temperatureValues.length > 0
            ? temperatureValues.reduce((sum, value) => sum + value, 0) / temperatureValues.length
            : 0;

    const precipitationValues = state.precipitation.flat().filter(Number.isFinite);
    const totalPrecipitation =
        precipitationValues.reduce((sum, value) => sum + value, 0) /
        Math.max(1, precipitationValues.length);

    const cloudHeights = state.cloudTop.flat().filter(Number.isFinite);
    const maxCloudHeight = cloudHeights.length > 0 ? Math.max(...cloudHeights) : 0;

    const snowDepthValues = state.snowDepth.flat().filter(Number.isFinite);
    const avgSnowDepth =
        snowDepthValues.reduce((sum, value) => sum + value, 0) /
        Math.max(1, snowDepthValues.length);

    return {
        minTemperature,
        maxTemperature,
        avgTemperature,
        totalPrecipitation,
        maxCloudHeight,
        avgSnowDepth,
    };
}
