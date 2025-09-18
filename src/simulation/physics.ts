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
import { clamp, getThermalProperties, isInBounds } from './utils';

export type ThermodynamicsOptions = {
    month: number;
    hour: number;
    sunAltitude: number;
    timeFactor: number;
    enableDiffusion: boolean;
    enableInversions: boolean;
    enableDownslope: boolean;
};

export type SimulationMetrics = {
    minTemperature: number;
    maxTemperature: number;
    avgTemperature: number;
    totalPrecipitation: number;
    maxCloudHeight: number;
    avgSnowDepth: number;
};

export function calculateInversionLayer(
    state: SimulationState,
    hour: number,
    windSpeed: number,
    cloudCover = 0
): void {
    const isNightTime = hour <= 6 || hour >= 19;

    if (!isNightTime || windSpeed > 15 || cloudCover > 0.5) {
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

    const windFactor = Math.max(0, 1 - windSpeed / 15);
    const hourFactor = hour <= 6 ? (6 - hour) / 6 : (hour - 19) / 5;

    state.inversionHeight = valleyAvgElev + 50 + 200 * windFactor * hourFactor;
    state.inversionStrength = windFactor * hourFactor * Math.min(1, terrainRelief / 100);

    state.inversionHeight = Math.min(state.inversionHeight, valleyAvgElev + 300);

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
    if (sunAltitude <= 0 || !isInBounds(x - 1, y - 1) || !isInBounds(x + 1, y + 1)) {
        return 0;
    }

    const dzdx = (state.elevation[y][x + 1] - state.elevation[y][x - 1]) / (2 * CELL_SIZE);
    const dzdy = (state.elevation[y + 1][x] - state.elevation[y - 1][x]) / (2 * CELL_SIZE);

    const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    const aspect = Math.atan2(-dzdy, dzdx);

    const solarIntensity = Math.max(
        0,
        Math.cos(slope) * sunAltitude + Math.sin(slope) * sunAltitude * Math.cos(aspect - Math.PI)
    );

    let cloudReduction = 1;
    if (state.cloudCoverage && state.cloudCoverage[y] && state.cloudCoverage[y][x] > 0) {
        const cloudRadiation = calculateCloudRadiation(state, x, y, sunAltitude);
        cloudReduction = cloudRadiation.solarTransmission;
    }

    return Math.min(3, solarIntensity * SOLAR_INTENSITY_FACTOR * cloudReduction);
}

function calculatePhysicsRates(
    state: SimulationState,
    month: number,
    hour: number,
    enableInversions: boolean,
    enableDownslope: boolean
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
                    const coolingEffectRate = -state.inversionStrength * relativeDepth * 4;
                    state.inversionAndDownslopeRate[y][x] += coolingEffectRate;
                } else if (elev < state.inversionHeight + 100) {
                    const heightAboveInversion = elev - state.inversionHeight;
                    const warmBeltEffectRate = state.inversionStrength * Math.exp(-heightAboveInversion / 40) * 3;

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

                state.inversionAndDownslopeRate[y][x] += clamp(totalEffectRate, -5, 12);

                const localWindSpeed = state.windVectorField[y][x].speed;
                if (localWindSpeed > 5) {
                    const mixing = Math.min(0.3, localWindSpeed / 50);
                    const baseTemp = calculateBaseTemperature(month, hour);
                    const mixingRate = (baseTemp - state.temperature[y][x]) * mixing;
                    state.inversionAndDownslopeRate[y][x] += mixingRate;
                }
            }
        }
    }
}

export function updateThermodynamics(state: SimulationState, options: ThermodynamicsOptions): void {
    const { month, hour, sunAltitude, timeFactor, enableDiffusion, enableInversions, enableDownslope } = options;

    calculatePhysicsRates(state, month, hour, enableInversions, enableDownslope);

    let newTemperature: number[][] = state.temperature.map(row => [...row]);
    let newSoilTemperature: number[][] = state.soilTemperature.map(row => [...row]);

    if (timeFactor > 0) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const prevAirTemp = state.temperature[y][x];
                const prevSoilTemp = state.soilTemperature[y][x];
                const thermalProps = getThermalProperties(state, x, y);

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
                    const coolingRate = 1.2 * cloudFactor;
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

                if (state.latentHeatEffect[y][x] > 0) {
                    airEnergyBalance += state.latentHeatEffect[y][x] / timeFactor;
                }

                const stdTempAtElev = 15 - ((state.elevation[y][x] - BASE_ELEVATION) / 100) * LAPSE_RATE;
                airEnergyBalance += (stdTempAtElev - prevAirTemp) * 0.05;

                const MAX_HOURLY_CHANGE = 10;
                airEnergyBalance = clamp(airEnergyBalance, -MAX_HOURLY_CHANGE, MAX_HOURLY_CHANGE);
                soilEnergyBalance = clamp(soilEnergyBalance, -MAX_HOURLY_CHANGE, MAX_HOURLY_CHANGE);

                newTemperature[y][x] += airEnergyBalance * timeFactor;
                newSoilTemperature[y][x] += soilEnergyBalance * timeFactor;
            }
        }
    }

    updateSnowCover(state, newTemperature, sunAltitude, timeFactor);

    if (enableDiffusion) {
        for (let i = 0; i < DIFFUSION_ITERATIONS; i++) {
            const diffusedTemp = newTemperature.map(row => [...row]);
            for (let y = 1; y < GRID_SIZE - 1; y++) {
                for (let x = 1; x < GRID_SIZE - 1; x++) {
                    const avgNeighborTemp =
                        (newTemperature[y - 1][x] +
                            newTemperature[y + 1][x] +
                            newTemperature[y][x - 1] +
                            newTemperature[y][x + 1]) /
                        4;
                    diffusedTemp[y][x] += (avgNeighborTemp - newTemperature[y][x]) * DIFFUSION_RATE;
                }
            }
            newTemperature = diffusedTemp;
        }
    }

    const ABSOLUTE_MIN_TEMP = -80;
    const ABSOLUTE_MAX_TEMP = 80;

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
    const flatTemp = state.temperature.flat();
    const minTemperature = Math.min(...flatTemp);
    const maxTemperature = Math.max(...flatTemp);
    const avgTemperature = flatTemp.reduce((sum, value) => sum + value, 0) / (GRID_SIZE * GRID_SIZE);

    const totalPrecipitation = state.precipitation.flat().reduce((sum, value) => sum + value, 0);
    const maxCloudHeight = Math.max(...state.cloudTop.flat());
    const avgSnowDepth = state.snowDepth.flat().reduce((sum, value) => sum + value, 0) / (GRID_SIZE * GRID_SIZE);

    return {
        minTemperature,
        maxTemperature,
        avgTemperature,
        totalPrecipitation,
        maxCloudHeight,
        avgSnowDepth,
    };
}
