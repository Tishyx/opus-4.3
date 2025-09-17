import {
    BASE_ELEVATION,
    CELL_SIZE,
    COLD_AIR_FLOW_INTENSITY,
    DIFFUSION_ITERATIONS,
    DIFFUSION_RATE,
    EPSILON,
    FOG_ADVECTION_RATE,
    FOG_DIFFUSION_RATE,
    FOG_DOWNSLOPE_RATE,
    FOG_SUN_DISSIPATION,
    FOG_TEMP_DISSIPATION,
    FOG_WIND_DISSIPATION,
    GRID_SIZE,
    LAND_COLORS,
    LAND_TYPE_MAP,
    LAPSE_RATE,
    MONTHLY_TEMPS,
    SETTLEMENT_HEAT_RADIUS,
    SETTLEMENT_PROPERTIES,
    SHADOW_COOLING,
    SOIL_PROPERTIES,
    SOIL_TYPE_MAP,
    SOLAR_INTENSITY_FACTOR,
    URBAN_HEAT_RADIUS,
    URBAN_PROPERTIES,
    WATER_PROPERTIES,
    WIND_CHILL_FACTOR,
} from './src/shared/constants';
import { LAND_TYPES, SOIL_TYPES } from './src/shared/types';
import {
    createSimulationState,
    resizeCanvas,
    type SimulationState,
} from './src/simulation/state';
import { CLOUD_TYPES, PRECIP_TYPES } from './src/simulation/weatherTypes';

// ===== GLOBAL STATE =====
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip') as HTMLElement;

const state: SimulationState = createSimulationState();
resizeCanvas(canvas);
const SIM_MINUTES_PER_REAL_SECOND = 15; // At 1x speed, 1 real second = 15 sim minutes

// ===== UTILITY FUNCTIONS =====
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

// Helper to get the correct thermal properties for a cell
function getThermalProperties(x: number, y: number) {
    const land = state.landCover[y][x];
    if (land === LAND_TYPES.WATER) return WATER_PROPERTIES;
    if (land === LAND_TYPES.URBAN) return URBAN_PROPERTIES;
    if (land === LAND_TYPES.SETTLEMENT) return SETTLEMENT_PROPERTIES;
    return SOIL_PROPERTIES[state.soilType[y][x]];
}

// ===== ATMOSPHERIC ADVECTION ENGINE =====
function bilinearInterpolate(grid: number[][], x: number, y: number): number {
    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.ceil(x);
    const y2 = Math.ceil(y);
    const xFrac = x - x1;
    const yFrac = y - y1;

    // Boundary checks
    const p11 = isInBounds(x1, y1) ? grid[y1][x1] : 0;
    const p12 = isInBounds(x1, y2) ? grid[y2][x1] : 0;
    const p21 = isInBounds(x2, y1) ? grid[y1][x2] : 0;
    const p22 = isInBounds(x2, y2) ? grid[y2][x2] : 0;

    const val1 = p11 * (1 - yFrac) + p12 * yFrac;
    const val2 = p21 * (1 - yFrac) + p22 * yFrac;

    return val1 * (1 - xFrac) + val2 * xFrac;
}

function advectGrid(
    grid: number[][],
    windField: {x: number, y: number, speed: number}[][],
    timeFactor: number
): number[][] {
    const newGrid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    const dt = timeFactor * 5; // Advection time step scaling factor

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const wind = windField[y][x];
            // Trace backward in time to find the source of the air
            const sourceX = x - wind.x * dt;
            const sourceY = y - wind.y * dt;
            
            // Sample the value from the original grid at the source location
            const advectedValue = bilinearInterpolate(grid, sourceX, sourceY);
            
            newGrid[y][x] = advectedValue;
        }
    }
    return newGrid;
}


// ===== CLOUD DYNAMICS SYSTEM =====

// Step 1: Simple cloud coverage affecting solar radiation
function calculateCloudCoverage(x: number, y: number, hour: number, humidity: number[][]): number {
    // Base cloud coverage from humidity
    let coverage = 0;
    
    // Higher humidity = more clouds
    if (state.humidity[y][x] > 0.7) {
        coverage = (state.humidity[y][x] - 0.7) / 0.3; // 0 to 1 scale
    }
    
    // Increase cloud coverage in afternoon (convective development)
    if (hour >= 12 && hour <= 17) {
        const afternoonFactor = Math.sin((hour - 12) / 5 * Math.PI);
        coverage += afternoonFactor * 0.3;
    }
    
    // Increase clouds over water bodies (evaporation)
    if (state.landCover[y][x] === LAND_TYPES.WATER) {
        coverage += 0.2;
    }
    
    return Math.min(1, coverage);
}

// Step 2: Orographic cloud formation
function calculateOrographicClouds(x: number, y: number, windSpeed: number, windDir: number, humidity: number[][], temperature: number[][]): number {
    if (windSpeed < 5) return 0; // Need wind for orographic lift
    
    const windDirRad = windDir * Math.PI / 180;
    const windX = Math.sin(windDirRad);
    const windY = -Math.cos(windDirRad);
    
    // Check if on windward side of slope
    let isWindward = false;
    let liftAmount = 0;
    
    if (isInBounds(x-1, y-1) && isInBounds(x+1, y+1)) {
        const dzdx = (state.elevation[y][x + 1] - state.elevation[y][x - 1]) / (2 * CELL_SIZE);
        const dzdy = (state.elevation[y + 1][x] - state.elevation[y - 1][x]) / (2 * CELL_SIZE);
        
        // Dot product of wind and upslope direction
        const slopeDotWind = dzdx * windX + dzdy * windY;
        
        if (slopeDotWind > 0) {
            isWindward = true;
            liftAmount = slopeDotWind * windSpeed / 10;
        }
    }
    
    if (!isWindward) return 0;
    
    // Calculate lifting condensation level (LCL)
    const dewPointDeficit = state.temperature[y][x] - state.dewPoint[y][x];
    const LCL = 125 * dewPointDeficit; // Approximate LCL height in meters
    
    // If terrain forces air above LCL, clouds form
    const forcedLift = liftAmount * 100; // Convert to meters
    
    if (forcedLift > LCL) {
        const cloudIntensity = Math.min(1, (forcedLift - LCL) / 200);
        return cloudIntensity;
    }
    
    return 0;
}

// Step 3: Precipitation and moisture feedback (REVISED FOR REALISM)
function calculatePrecipitation(x: number, y: number, cloudWater: number[][], cloudType: number[][], temperature: number[][]): {rate: number, type: number} {
    let precipRate = 0; // rate in mm/hr
    let precipType = PRECIP_TYPES.NONE;
    const localCloudWater = state.cloudWater[y][x];

    // No precipitation if there's very little cloud water
    if (localCloudWater < 0.2) return { rate: 0, type: PRECIP_TYPES.NONE };

    let precipEfficiency = 0;
    let precipProbability = 0;

    // Determine efficiency and probability based on cloud type
    switch(state.cloudType[y][x]) {
        case CLOUD_TYPES.CUMULUS:
            precipProbability = Math.max(0, (localCloudWater - 0.5) / 0.5); 
            precipEfficiency = 0.2;
            break;
        case CLOUD_TYPES.CUMULONIMBUS:
            precipProbability = Math.max(0, (localCloudWater - 0.3) / 0.7);
            precipEfficiency = 0.9;
            break;
        case CLOUD_TYPES.STRATUS:
            precipProbability = Math.max(0, (localCloudWater - 0.2) / 0.8);
            precipEfficiency = 0.15;
            break;
        case CLOUD_TYPES.OROGRAPHIC:
            precipProbability = Math.max(0, (localCloudWater - 0.25) / 0.75);
            precipEfficiency = 0.4;
            break;
    }

    if (Math.random() < precipProbability) {
        const randomFactor = 0.7 + Math.random() * 0.6;
        precipRate = localCloudWater * precipEfficiency * randomFactor;
    }

    precipRate = Math.min(precipRate, 2.0); // Cap precipitation rate (e.g., 2 mm/hr)

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

// Step 4: Convective cloud development
function calculateConvectiveClouds(x: number, y: number, hour: number, surfaceTemp: number, humidity: number[][]): {development: number, type: number, cape: number, thermalStrength: number} {
    const baseTemp = calculateBaseTemperature(
        parseInt((document.getElementById('month') as HTMLSelectElement).value),
        hour
    );
    
    let thermal = 0;
    
    if (hour >= 10 && hour <= 17) {
        const tempExcess = surfaceTemp - baseTemp;
        
        if (state.landCover[y][x] === LAND_TYPES.URBAN) {
            thermal = tempExcess * 1.3;
        } else if (state.soilType[y][x] === SOIL_TYPES.SAND) {
            thermal = tempExcess * 1.1;
        } else if (state.landCover[y][x] === LAND_TYPES.GRASSLAND) {
            thermal = tempExcess;
        } else if (state.landCover[y][x] === LAND_TYPES.WATER || state.landCover[y][x] === LAND_TYPES.FOREST) {
            thermal = tempExcess * 0.5;
        }
    }
    
    const CAPE = Math.max(0, thermal * state.humidity[y][x] * 100);
    
    let cloudDevelopment = 0;
    let cloudTypeResult = CLOUD_TYPES.NONE;
    
    if (CAPE > 500) {
        cloudDevelopment = Math.min(1, CAPE / 3000);
        if (CAPE > 2000) {
            cloudTypeResult = CLOUD_TYPES.CUMULONIMBUS;
        } else {
            cloudTypeResult = CLOUD_TYPES.CUMULUS;
        }
    }
    
    return { 
        development: cloudDevelopment, 
        type: cloudTypeResult,
        cape: CAPE,
        thermalStrength: thermal
    };
}

// Step 5: Cloud microphysics
function calculateCloudMicrophysics(x: number, y: number, cloudWater: number[][], temperature: number[][], updraftSpeed: number): {ice: number, dropletSize: number, precipEfficiency: number, graupel: number} {
    let iceContent = 0;
    let dropletSize = 5;
    let precipitationEfficiency = 0;
    
    if (state.temperature[y][x] < 0 && state.cloudWater[y][x] > 0) {
        const freezingRate = Math.exp(-state.temperature[y][x] / 10);
        state.iceContent = state.cloudWater[y][x] * freezingRate;
        state.cloudWater[y][x] *= (1 - freezingRate * 0.5);
    }
    
    if (state.temperature[y][x] > 0 && state.cloudWater[y][x] > 0.3) {
        dropletSize = 5 + updraftSpeed * 2;
        if (dropletSize > 20) {
            precipitationEfficiency = Math.min(1, dropletSize / 50);
        }
    }
    
    let graupelFormation = 0;
    if (state.temperature[y][x] > -10 && state.temperature[y][x] < 0 && updraftSpeed > 5) {
        graupelFormation = state.iceContent * 0.3;
    }
    
    return {
        ice: state.iceContent,
        dropletSize: dropletSize,
        precipEfficiency: precipitationEfficiency,
        graupel: graupelFormation
    };
}

function calculateCloudRadiation(x: number, y: number, cloudCoverage: number[][], cloudOpticalDepth: number[][], sunAltitude: number): {solarTransmission: number, longwaveWarming: number} {
    let solarTransmission = 1;
    if (state.cloudCoverage[y][x] > 0) {
        const opticalPath = state.cloudOpticalDepth[y][x] / Math.max(0.1, Math.sin(sunAltitude));
        solarTransmission = (1 - state.cloudCoverage[y][x]) + 
                           state.cloudCoverage[y][x] * Math.exp(-opticalPath);
    }
    
    let longwaveEffect = 0;
    if (state.cloudCoverage[y][x] > 0) {
        longwaveEffect = state.cloudCoverage[y][x] * 3;
    }
    
    return {
        solarTransmission: solarTransmission,
        longwaveWarming: longwaveEffect
    };
}

function updateHumidity(x: number, y: number, temperature: number[][], windSpeed: number, precipRate: number, precipType: number, timeFactor: number): void {
    let evaporationRate = 0; // rate in %/hr
    
    if (state.landCover[y][x] === LAND_TYPES.WATER) {
        evaporationRate = 2.0 * Math.max(0, state.temperature[y][x] / 30) * (1 + windSpeed / 20);
    } else if (state.landCover[y][x] === LAND_TYPES.FOREST) {
        evaporationRate = 1.0 * Math.max(0, state.temperature[y][x] / 30);
    } else if (state.soilMoisture[y][x] > 0) {
        const thermalProps = getThermalProperties(x, y);
        const soilEvap = state.soilMoisture[y][x] * thermalProps.evaporation;
        evaporationRate = soilEvap * 1.0 * Math.max(0, state.temperature[y][x] / 30);
    }
    
    let precipReductionRate = 0;
    if (precipRate > 0 && precipType !== PRECIP_TYPES.SNOW) {
        precipReductionRate = precipRate * 10; // 1mm/hr rain reduces humidity by 10%/hr
    }

    const humidityChange = (evaporationRate - precipReductionRate) * timeFactor / 100;
    state.humidity[y][x] = clamp(state.humidity[y][x] + humidityChange, 0.01, 1);
    
    const a = 17.27;
    const b = 237.7;
    const relHumidity = state.humidity[y][x];
    const gamma = Math.log(relHumidity) + (a * state.temperature[y][x]) / (b + state.temperature[y][x]);
    state.dewPoint[y][x] = (b * gamma) / (a - gamma);
}

function updateCloudDynamics(hour: number, windSpeed: number, windDir: number, timeFactor: number): void {
    if (timeFactor <= 0) return;

    const sunAltitude = Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const orographicFormationRate = calculateOrographicClouds(x, y, windSpeed, windDir, state.humidity, state.temperature) * 2.0; // rate in water/hr
            
            const convective = calculateConvectiveClouds(x, y, hour, state.temperature[y][x], state.humidity);
            const convectiveFormationRate = convective.development * 2.0;
            
            state.convectiveEnergy[y][x] = convective.cape;
            state.thermalStrength[y][x] = convective.state.thermalStrength;
            
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
            
            const precip = calculatePrecipitation(x, y, state.cloudWater, state.cloudType, state.temperature);
            const precipRate = precip.rate; // mm/hr
            state.precipitation[y][x] = precipRate;
            state.precipitationType[y][x] = precip.type;
            const precipWaterLossRate = precipRate * 0.1;

            const cloudWaterChange = (cloudFormationRate - solarDissipationRate - precipWaterLossRate) * timeFactor;
            state.cloudWater[y][x] = clamp(state.cloudWater[y][x] + cloudWaterChange, 0, 1.5);
            
            state.cloudCoverage[y][x] = Math.min(1, state.cloudWater[y][x]);
            state.cloudOpticalDepth[y][x] = state.cloudWater[y][x] * 10;
            
            updateHumidity(x, y, state.temperature, windSpeed, precipRate, precip.type, timeFactor);
            
            const updraft = state.thermalStrength[y][x] * 2;
            const microphysics = calculateCloudMicrophysics(x, y, state.cloudWater, state.temperature, updraft);
            state.iceContent[y][x] = microphysics.ice;
            
            if (precipRate > 0) {
                 if (precip.type === PRECIP_TYPES.SNOW) {
                    const snowAccumulation = precipRate * 10 * timeFactor;
                    state.snowDepth[y][x] += snowAccumulation;
                    state.latentHeatEffect[y][x] += precipRate * 0.8;
                } else {
                    const thermalProps = getThermalProperties(x, y);
                    const infiltration = Math.min(precipRate * timeFactor, 1 - state.soilMoisture[y][x]);
                    state.soilMoisture[y][x] += infiltration * thermalProps.waterRetention;
                }
            }
        }
    }
    
    smoothCloudFields();
}

function smoothCloudFields() {
    const smoothed = state.cloudCoverage.map(row => [...row]);
    
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


// ===== SNOW DYNAMICS =====
function updateSnowCover(temperatureGrid: number[][], sunAltitude: number, timeFactor: number) {
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (state.snowDepth[y][x] > 0) {
                if (temperatureGrid[y][x] > 0) {
                    const meltRate = (temperatureGrid[y][x] * 0.5 + sunAltitude * 2.0);
                    const latentCooling = -Math.min(temperatureGrid[y][x], meltRate * 0.15);
                    temperatureGrid[y][x] += latentCooling;
                    state.snowDepth[y][x] = Math.max(0, state.snowDepth[y][x] - meltRate * timeFactor);
                    const meltwater = Math.min(meltRate * timeFactor / 10, 1 - state.soilMoisture[y][x]);
                    state.soilMoisture[y][x] += meltwater;

                }
                if (sunAltitude > 0) {
                     state.snowDepth[y][x] = Math.max(0, state.snowDepth[y][x] - sunAltitude * 0.05 * timeFactor);
                }
            }
        }
    }
}

function calculateSnowEffects(x: number, y: number, sunAltitude: number): { albedoEffect: number, insulationEffect: number } {
    if (state.snowDepth[y][x] <= 0) {
        return { albedoEffect: 0, insulationEffect: 0 };
    }

    const snowAlbedo = 0.8;
    const effectiveAlbedo = snowAlbedo * Math.min(1, state.snowDepth[y][x] / 10);
    const albedoCooling = -effectiveAlbedo * sunAltitude * SOLAR_INTENSITY_FACTOR * 1.5;

    const insulationFactor = Math.min(1, state.snowDepth[y][x] / 20);

    return { albedoEffect: albedoCooling, insulationEffect: insulationFactor };
}


// ===== SOIL THERMAL DYNAMICS =====
function initializeSoilMoisture(): void {
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const thermalProps = getThermalProperties(x, y);
            let baseMoisture = thermalProps.waterRetention * 0.5;
            
            if (state.waterDistance[y][x] < 10) {
                baseMoisture += (10 - state.waterDistance[y][x]) / 10 * 0.3;
            }
            
            if (isInBounds(x-1, y-1) && isInBounds(x+1, y+1)) {
                const slope = Math.abs(state.elevation[y][x] - state.elevation[y-1][x]) + 
                             Math.abs(state.elevation[y][x] - state.elevation[y+1][x]);
                if (slope > 20) {
                    baseMoisture *= 0.7;
                }
            }
            
            state.soilMoisture[y][x] = Math.min(1, baseMoisture);
        }
    }
}

// ===== DOWNSLOPE WIND CALCULATIONS =====
function calculateDownslopeWinds(hour: number, baseWindSpeed: number, windDir: number, windGustiness: number): void {
    state.downSlopeWinds = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    state.windVectorField = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null).map(() => ({x: 0, y: 0, speed: 0})));
    state.foehnEffect = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    
    const isNightTime = hour <= 6 || hour >= 19;
    const windDirRad = windDir * Math.PI / 180;
    
    for (let y = 2; y < GRID_SIZE - 2; y++) {
        for (let x = 2; x < GRID_SIZE - 2; x++) {
            const dzdx = (state.elevation[y][x + 2] - state.elevation[y][x - 2]) / (4 * CELL_SIZE);
            const dzdy = (state.elevation[y + 2][x] - state.elevation[y - 2][x]) / (4 * CELL_SIZE);
            
            const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
            const slopeAngle = Math.atan(slope);
            
            if (isNightTime && slopeAngle > 0.1) {
                const katabaticStrength = Math.min(1, slopeAngle / 0.5) * (1 - baseWindSpeed / 30);
                
                let isSurfaceSlope = true;
                for (let d = 1; d <= 2; d++) {
                    const checkX = Math.round(x - dzdx * d);
                    const checkY = Math.round(y - dzdy * d);
                    if (isInBounds(checkX, checkY)) {
                        const elevDiff = Math.abs(state.elevation[checkY][checkX] - state.elevation[y][x]);
                        if (elevDiff > 30) {
                            isSurfaceSlope = false;
                            break;
                        }
                    }
                }
                
                if (isSurfaceSlope) {
                    const coldAirFlow = katabaticStrength * 0.8;
                    if (slope > EPSILON) {
                        state.windVectorField[y][x].x = -dzdx / slope * coldAirFlow * 5;
                        state.windVectorField[y][x].y = -dzdy / slope * coldAirFlow * 5;
                        state.windVectorField[y][x].speed = coldAirFlow * 5;
                        state.downSlopeWinds[y][x] = -coldAirFlow * 1.5;
                    }
                }
            }
            
            if (baseWindSpeed > 10 && slopeAngle > 0.15) {
                const windX = Math.sin(windDirRad);
                const windY = -Math.cos(windDirRad);
                
                let isLeeSide = false;
                let maxUpwindHeight = state.elevation[y][x];
                
                for (let d = 1; d <= 10; d++) {
                    const checkX = Math.round(x - windX * d);
                    const checkY = Math.round(y - windY * d);
                    
                    if (isInBounds(checkX, checkY)) {
                        if (state.elevation[checkY][checkX] > maxUpwindHeight + 20) {
                            isLeeSide = true;
                            maxUpwindHeight = state.elevation[checkY][checkX];
                        }
                    }
                }
                
                if (isLeeSide) {
                    const descentHeight = maxUpwindHeight - state.elevation[y][x];
                    const adiabaticWarming = descentHeight * 0.01;
                    const foehnStrength = Math.min(1, descentHeight / 100) * (baseWindSpeed / 30);
                    state.foehnEffect[y][x] = Math.min(12, adiabaticWarming * foehnStrength);
                    
                    state.windVectorField[y][x].x += windX * foehnStrength * 10;
                    state.windVectorField[y][x].y += windY * foehnStrength * 10;
                    state.windVectorField[y][x].speed = Math.sqrt(
                        state.windVectorField[y][x].x * state.windVectorField[y][x].x + 
                        state.windVectorField[y][x].y * state.windVectorField[y][x].y
                    );
                }
            }
            
            let higherNeighbors = 0;
            const valleyCheckRadius = 5;
            for (let dy = -valleyCheckRadius; dy <= valleyCheckRadius; dy++) {
                for (let dx = -valleyCheckRadius; dx <= valleyCheckRadius; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (isInBounds(nx, ny) && state.elevation[ny][nx] > state.elevation[y][x] + 25) {
                        higherNeighbors++;
                    }
                }
            }

            const totalNeighbors = Math.pow(valleyCheckRadius * 2 + 1, 2) - 1;
            if (higherNeighbors > totalNeighbors * 0.4) {
                let exits: { elev: number, x: number, y: number }[] = [];
                for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
                    const nx = Math.round(x + valleyCheckRadius * Math.cos(angle));
                    const ny = Math.round(y + valleyCheckRadius * Math.sin(angle));
                    if (isInBounds(nx, ny)) {
                        exits.push({ elev: state.elevation[ny][nx], x: nx, y: ny });
                    }
                }
                exits.sort((a, b) => a.elev - b.elev);
                const lowestExits = exits.slice(0, Math.max(2, Math.floor(exits.length / 3)));

                let bestPair = { p1: null as any, p2: null as any, dist: 0 };
                if (lowestExits.length >= 2) {
                    for (let i = 0; i < lowestExits.length; i++) {
                        for (let j = i + 1; j < lowestExits.length; j++) {
                            const p1 = lowestExits[i]; const p2 = lowestExits[j];
                            const distSq = (p1.x - p2.x)**2 + (p1.y - p2.y)**2;
                            if (distSq > bestPair.dist) {
                                bestPair = { p1, p2, dist: distSq };
                            }
                        }
                    }
                }
                
                let axisVec = {x: 0, y: 0};
                if (bestPair.p1) {
                    axisVec = {x: bestPair.p2.x - bestPair.p1.x, y: bestPair.p2.y - bestPair.p1.y};
                }

                const axisMag = Math.sqrt(axisVec.x * axisVec.x + axisVec.y * axisVec.y);
                if (axisMag > EPSILON) {
                    const valleyDirection = {x: axisVec.x / axisMag, y: axisVec.y / axisMag};

                    let valleyWidth = 0;
                    const perpVec = {x: -valleyDirection.y, y: valleyDirection.x};
                    for (const sign of [-1, 1]) {
                        for (let d = 1; d < 15; d++) {
                            const checkX = Math.round(x + perpVec.x * d * sign);
                            const checkY = Math.round(y + perpVec.y * d * sign);
                            if (!isInBounds(checkX, checkY) || state.elevation[checkY][checkX] > state.elevation[y][x] + 30) {
                                valleyWidth += d; break;
                            }
                            if (d === 14) valleyWidth += d;
                        }
                    }

                    const windX = Math.sin(windDirRad);
                    const windY = -Math.cos(windDirRad);
                    const alignment = windX * valleyDirection.x + windY * valleyDirection.y;
                    
                    const narrownessFactor = Math.max(0, (15 - valleyWidth) / 15);
                    const venturiMultiplier = 1.0 + narrownessFactor * 1.2;
                    
                    const channelStrength = 0.4 + narrownessFactor * 0.6;
                    
                    const baseValleySpeed = baseWindSpeed * Math.abs(alignment);
                    const finalValleySpeed = baseValleySpeed * venturiMultiplier;
                    
                    const channeledVecX = valleyDirection.x * Math.sign(alignment || 1);
                    const channeledVecY = valleyDirection.y * Math.sign(alignment || 1);
                    
                    const blendedVecX = (windX * (1 - channelStrength)) + (channeledVecX * channelStrength);
                    const blendedVecY = (windY * (1 - channelStrength)) + (channeledVecY * channelStrength);
                    
                    state.windVectorField[y][x].x += blendedVecX * finalValleySpeed * 0.8;
                    state.windVectorField[y][x].y += blendedVecY * finalValleySpeed * 0.8;
                }
            }
        }
    }

    if (windGustiness > 0) {
        for (let y = 1; y < GRID_SIZE - 1; y++) {
            for (let x = 1; x < GRID_SIZE - 1; x++) {
                let roughness = 0;
                let elevSum = 0;
                let elevSqSum = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const elev = state.elevation[y+dy][x+dx];
                        elevSum += elev;
                        elevSqSum += elev * elev;
                    }
                }
                const avgElev = elevSum / 9;
                const stdDev = Math.sqrt(elevSqSum / 9 - avgElev * avgElev);
                roughness = stdDev / 20;

                const thermalTurbulence = (state.thermalStrength[y][x] || 0) / 15;

                const gustFactor = (windGustiness / 100) * (1 + roughness + thermalTurbulence);
                const localWindSpeed = Math.sqrt(state.windVectorField[y][x].x**2 + state.windVectorField[y][x].y**2) + baseWindSpeed;
                const gustMagnitude = localWindSpeed * gustFactor * 0.5;

                state.windVectorField[y][x].x += (Math.random() - 0.5) * 2 * gustMagnitude;
                state.windVectorField[y][x].y += (Math.random() - 0.5) * 2 * gustMagnitude;
            }
        }
    }
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const vec = state.windVectorField[y][x];
            vec.speed = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
        }
    }

    smoothWindField();
}

function smoothWindField(): void {
    const smoothed: {x: number, y: number, speed: number}[][] = Array(GRID_SIZE).fill(null).map(() => 
        Array(GRID_SIZE).fill(null).map(() => ({x: 0, y: 0, speed: 0}))
    );
    
    for (let y = 1; y < GRID_SIZE - 1; y++) {
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            let sumX = 0, sumY = 0, count = 0;
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const weight = (dx === 0 && dy === 0) ? 4 : 1;
                    sumX += state.windVectorField[y + dy][x + dx].x * weight;
                    sumY += state.windVectorField[y + dy][x + dx].y * weight;
                    count += weight;
                }
            }
            
            smoothed[y][x].x = sumX / count;
            smoothed[y][x].y = sumY / count;
            smoothed[y][x].speed = Math.sqrt(smoothed[y][x].x * smoothed[y][x].x + smoothed[y][x].y * smoothed[y][x].y);
        }
    }
    
    for (let y = 1; y < GRID_SIZE - 1; y++) {
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            state.windVectorField[y][x] = smoothed[y][x];
        }
    }
}

// ===== DYNAMIC FOG SIMULATION =====
function updateFogSimulation(hour: number, sunAltitude: number, timeFactor: number) {
    if (timeFactor <= 0) return;

    let fogChangeRate: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

    // Step 1: Calculate formation and dissipation rates
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            let formationRate = 0;
            let dissipationRate = 0;

            if (state.inversionStrength > 0 && state.elevation[y][x] < state.inversionHeight) {
                const depth = (state.inversionHeight - state.elevation[y][x]) / 100;
                formationRate += state.inversionStrength * depth * 0.5;
            }

            if (state.temperature[y][x] < state.dewPoint[y][x] + 2) {
                const saturation = (state.dewPoint[y][x] + 2 - state.temperature[y][x]) / 4;
                formationRate += saturation * state.humidity[y][x];
            }
            
            if (sunAltitude <= 0 && state.waterDistance[y][x] < 5) {
                formationRate += (5 - state.waterDistance[y][x]) / 5 * 0.3 * (1 - state.windVectorField[y][x].speed / 20);
            }

            if (sunAltitude > 0) {
                dissipationRate += sunAltitude * FOG_SUN_DISSIPATION;
            }

            dissipationRate += state.windVectorField[y][x].speed * FOG_WIND_DISSIPATION;
            
            if (state.temperature[y][x] > state.dewPoint[y][x]) {
                dissipationRate += (state.temperature[y][x] - state.dewPoint[y][x]) * FOG_TEMP_DISSIPATION;
            }

            fogChangeRate[y][x] = formationRate - dissipationRate;
        }
    }
    
    // Step 2: Apply changes and advection
    let newFogDensity = state.fogDensity.map(row => [...row]);
    for (let y = 1; y < GRID_SIZE - 1; y++) {
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            // Apply local formation/dissipation
            newFogDensity[y][x] += fogChangeRate[y][x] * timeFactor;

            // Advection
            const wind = state.windVectorField[y][x];
            if (wind.speed > 0.5) {
                const upwindX = clamp(Math.round(x - wind.x * 0.2), 0, GRID_SIZE - 1);
                const upwindY = clamp(Math.round(y - wind.y * 0.2), 0, GRID_SIZE - 1);
                const advectionChange = (state.fogDensity[upwindY][upwindX] - state.fogDensity[y][x]) * FOG_ADVECTION_RATE * Math.min(1, wind.speed / 10);
                newFogDensity[y][x] += advectionChange * timeFactor;
            }
            
            // Downslope creep
            let highNeighborFog = 0;
            let elevDiffSum = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    const elevDiff = state.elevation[ny][nx] - state.elevation[y][x];
                    if (elevDiff > 0) {
                        highNeighborFog += state.fogDensity[ny][nx] * elevDiff;
                        elevDiffSum += elevDiff;
                    }
                }
            }
            if (elevDiffSum > 0) {
                const avgHighNeighborFog = highNeighborFog / elevDiffSum;
                const downslopeChange = (avgHighNeighborFog - state.fogDensity[y][x]) * FOG_DOWNSLOPE_RATE;
                newFogDensity[y][x] += downslopeChange * timeFactor;
            }

            // Diffusion
            const avgNeighborFog = (
                state.fogDensity[y - 1][x] + state.fogDensity[y + 1][x] +
                state.fogDensity[y][x - 1] + state.fogDensity[y][x + 1]
            ) / 4;
            const diffusionChange = (avgNeighborFog - state.fogDensity[y][x]) * FOG_DIFFUSION_RATE;
            newFogDensity[y][x] += diffusionChange * timeFactor;
        }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            state.fogDensity[y][x] = clamp(newFogDensity[y][x], 0, 1);
        }
    }
}


// ===== TEMPERATURE INVERSION CALCULATIONS =====
function calculateInversionLayer(hour: number, windSpeed: number, cloudCover = 0): void {
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
    
    state.inversionHeight = valleyAvgElev + 50 + (200 * windFactor * hourFactor);
    state.inversionStrength = windFactor * hourFactor * Math.min(1, terrainRelief / 100);
    
    state.inversionHeight = Math.min(state.inversionHeight, valleyAvgElev + 300);
    
    if (windSpeed > 10 || terrainRelief < 30) {
        state.inversionStrength *= 0.5;
    }
}

// ===== AREA AND DISTANCE CALCULATIONS =====
function calculateContiguousAreas(): void {
    state.contiguousAreas = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    state.areasizes = new Map();
    let areaId = 0;
    const visited = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(false));
    
    function floodFill(startX: number, startY: number, landType: number) {
        areaId++;
        const queue: [number, number][] = [[startX, startY]];
        const cells: [number, number][] = [];
        visited[startY][startX] = true;
        
        while (queue.length > 0) {
            const [x, y] = queue.shift()!;
            cells.push([x, y]);
            state.contiguousAreas[y][x] = areaId;
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    
                    if (isInBounds(nx, ny) && !visited[ny][nx] && state.landCover[ny][nx] === landType) {
                        visited[ny][nx] = true;
                        queue.push([nx, ny]);
                    }
                }
            }
        }
        
        state.areasizes.set(areaId, cells.length);
        return cells;
    }
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (!visited[y][x]) {
                floodFill(x, y, state.landCover[y][x]);
            }
        }
    }
}

function calculateDistanceFields(): void {
    state.waterDistance = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
    state.nearestWaterAreaId = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    state.forestDistance = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
    state.nearestForestAreaId = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    state.urbanDistance = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
    state.forestDepth = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

    const waterQueue: [number, number, number, number][] = [];
    const forestQueue: [number, number, number, number][] = [];
    const urbanQueue: [number, number, number][] = [];

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const areaId = state.contiguousAreas[y][x];
            if (state.landCover[y][x] === LAND_TYPES.WATER) {
                state.waterDistance[y][x] = 0;
                state.nearestWaterAreaId[y][x] = areaId;
                waterQueue.push([x, y, 0, areaId]);
            }
            if (state.landCover[y][x] === LAND_TYPES.FOREST) {
                state.forestDistance[y][x] = 0;
                state.nearestForestAreaId[y][x] = areaId;
                forestQueue.push([x, y, 0, areaId]);
            }
            if (state.landCover[y][x] === LAND_TYPES.URBAN || state.landCover[y][x] === LAND_TYPES.SETTLEMENT) {
                state.urbanDistance[y][x] = 0;
                urbanQueue.push([x, y, 0]);
            }
        }
    }

    while (waterQueue.length > 0) {
        const [x, y, dist, areaId] = waterQueue.shift()!;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                const newDist = dist + Math.sqrt(dx * dx + dy * dy);
                if (isInBounds(nx, ny) && newDist < state.waterDistance[ny][nx]) {
                    state.waterDistance[ny][nx] = newDist;
                    state.nearestWaterAreaId[ny][nx] = areaId;
                    waterQueue.push([nx, ny, newDist, areaId]);
                }
            }
        }
    }

    while (forestQueue.length > 0) {
        const [x, y, dist, areaId] = forestQueue.shift()!;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                const newDist = dist + Math.sqrt(dx * dx + dy * dy);
                if (isInBounds(nx, ny) && newDist < state.forestDistance[ny][nx]) {
                    state.forestDistance[ny][nx] = newDist;
                    state.nearestForestAreaId[ny][nx] = areaId;
                    forestQueue.push([nx, ny, newDist, areaId]);
                }
            }
        }
    }

    while (urbanQueue.length > 0) {
        const [x, y, dist] = urbanQueue.shift()!;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                const newDist = dist + Math.sqrt(dx * dx + dy * dy);
                if (isInBounds(nx, ny) && newDist < state.urbanDistance[ny][nx]) {
                    state.urbanDistance[ny][nx] = newDist;
                    urbanQueue.push([nx, ny, newDist]);
                }
            }
        }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (state.landCover[y][x] === LAND_TYPES.FOREST) {
                let minDistToEdge = Infinity;
                for (let radius = 1; radius < 20; radius++) {
                    let foundEdge = false;
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                                const nx = x + dx;
                                const ny = y + dy;
                                if (isInBounds(nx, ny) && state.landCover[ny][nx] !== LAND_TYPES.FOREST) {
                                    const d = Math.sqrt(dx * dx + dy * dy);
                                    minDistToEdge = Math.min(minDistToEdge, d);
                                    foundEdge = true;
                                }
                            }
                        }
                    }
                    if (foundEdge) break;
                }
                state.forestDepth[y][x] = minDistToEdge === Infinity ? 20 : minDistToEdge;
            }
        }
    }
}

// ===== TERRAIN GENERATION =====
function generatePerlinNoise(): number[][] {
    const noise: number[][] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        noise[y] = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const nx = x / GRID_SIZE * 4;
            const ny = y / GRID_SIZE * 4;
            
            const value = BASE_ELEVATION + 
                Math.sin(nx * Math.PI) * Math.cos(ny * Math.PI) * 50 +
                Math.sin(nx * Math.PI * 3) * Math.cos(ny * Math.PI * 3) * 20 +
                (Math.random() - 0.5) * 10;
            
            noise[y][x] = value;
        }
    }
    return noise;
}

function initializeGrids(): void {
    state.elevation = generatePerlinNoise();
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            state.landCover[y][x] = LAND_TYPES.GRASSLAND;
            
            if (state.elevation[y][x] > 140) {
                state.soilType[y][x] = SOIL_TYPES.ROCK;
            } else if (state.elevation[y][x] < 80) {
                state.soilType[y][x] = Math.random() > 0.5 ? SOIL_TYPES.CLAY : SOIL_TYPES.LOAM;
            } else {
                const rand = Math.random();
                if (rand < 0.4) state.soilType[y][x] = SOIL_TYPES.LOAM;
                else if (rand < 0.7) state.soilType[y][x] = SOIL_TYPES.SAND;
                else state.soilType[y][x] = SOIL_TYPES.CLAY;
            }
            
            state.temperature[y][x] = 20;
            state.hillshade[y][x] = 1;
            state.waterDistance[y][x] = Infinity;
            state.nearestWaterAreaId[y][x] = 0;
            state.forestDistance[y][x] = Infinity;
            state.nearestForestAreaId[y][x] = 0;
            state.forestDepth[y][x] = 0;
            state.urbanDistance[y][x] = Infinity;
            state.contiguousAreas[y][x] = 0;
            state.fogDensity[y][x] = 0;
            state.downSlopeWinds[y][x] = 0;
            state.windVectorField[y][x] = {x: 0, y: 0, speed: 0};
            state.foehnEffect[y][x] = 0;
            state.soilMoisture[y][x] = 0;
            state.soilTemperature[y][x] = 20;
            state.snowDepth[y][x] = 0;
            state.cloudCoverage[y][x] = 0;
            state.cloudBase[y][x] = 0;
            state.cloudTop[y][x] = 0;
            state.cloudType[y][x] = CLOUD_TYPES.NONE;
            state.cloudOpticalDepth[y][x] = 0;
            state.precipitation[y][x] = 0;
            state.precipitationType[y][x] = PRECIP_TYPES.NONE;
            state.humidity[y][x] = 0.5 + Math.random() * 0.2;
            state.dewPoint[y][x] = 10;
            state.convectiveEnergy[y][x] = 0;
            state.thermalStrength[y][x] = 0;
            state.cloudWater[y][x] = 0;
            state.iceContent[y][x] = 0;
            state.latentHeatEffect[y][x] = 0;
        }
    }
    
    addInitialFeatures();
    calculateContiguousAreas();
    calculateDistanceFields();
    initializeSoilMoisture();
    calculateHillshade();
    
    runSimulation(0);
}

function addInitialFeatures(): void {
    for (let x = 10; x < 90; x++) {
        for (let y = 40; y <= 50; y++) {
            const ridgeHeight = 800 + Math.sin(x / 10) * 200;
            const distFromRidge = Math.abs(y - 45);
            state.elevation[y][x] = ridgeHeight - distFromRidge * 80;
            if (state.elevation[y][x] > 800) {
                state.soilType[y][x] = SOIL_TYPES.ROCK;
            }
        }
    }
    
    for (let y = 10; y < 30; y++) {
        for (let x = 10; x < 90; x++) {
            const distFromCenter = Math.abs(y - 20);
            state.elevation[y][x] = Math.max(60, state.elevation[y][x] - (10 - distFromCenter) * 5);
            if (state.elevation[y][x] < 80) {
                state.soilType[y][x] = SOIL_TYPES.CLAY;
            }
        }
    }
    
    for (let y = 51; y < 70; y++) {
        for (let x = 10; x < 90; x++) {
            const ridgeHeight = 800 + Math.sin(x / 10) * 200;
            const mountainBaseHeight = ridgeHeight - 5 * 80;
            state.elevation[y][x] = Math.max(80, mountainBaseHeight - (y - 50) * 12);
        }
    }
    
    for (let y = 65; y < 80; y++) {
        for (let x = 30; x < 60; x++) {
            if (Math.random() > 0.3) {
                state.soilType[y][x] = SOIL_TYPES.SAND;
            }
        }
    }
    
    const lakeX = 27, lakeY = 20, lakeRadius = 6;
    for (let y = lakeY - lakeRadius; y <= lakeY + lakeRadius; y++) {
        for (let x = lakeX - lakeRadius; x <= lakeX + lakeRadius; x++) {
            if (isInBounds(x, y) && distance(x, y, lakeX, lakeY) < lakeRadius) {
                state.landCover[y][x] = LAND_TYPES.WATER;
                state.elevation[y][x] = 65;
            }
        }
    }
    
    for (let y = 30; y < 45; y++) {
        for (let x = 20; x < 80; x++) {
            if (isInBounds(x, y) && Math.random() > 0.3) {
                state.landCover[y][x] = LAND_TYPES.FOREST;
                state.soilType[y][x] = SOIL_TYPES.LOAM;
            }
        }
    }
    
    const urbanX = 50, urbanY = 55, urbanRadius = 40;
    for (let y = urbanY - urbanRadius; y <= urbanY + urbanRadius; y++) {
        for (let x = urbanX - urbanRadius; x <= urbanX + urbanRadius; x++) {
            if (isInBounds(x, y) && Math.abs(x - urbanX) + Math.abs(y - urbanY) < urbanRadius) {
                state.landCover[y][x] = LAND_TYPES.SETTLEMENT;
            }
        }
    }
}

// ===== HILLSHADE CALCULATION =====
function calculateHillshade(): void {
    const sunAzimuth = 315 * Math.PI / 180;
    const sunAltitude = 45 * Math.PI / 180;
    
    for (let y = 1; y < GRID_SIZE - 1; y++) {
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            const dzdx = (state.elevation[y][x + 1] - state.elevation[y][x - 1]) / (2 * CELL_SIZE);
            const dzdy = (state.elevation[y + 1][x] - state.elevation[y - 1][x]) / (2 * CELL_SIZE);
            
            const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
            const aspect = Math.atan2(dzdy, dzdx);
            
            const shade = Math.cos(sunAltitude) * Math.cos(slope) +
                         Math.sin(sunAltitude) * Math.sin(slope) * 
                         Math.cos(sunAzimuth - aspect);
            
            state.hillshade[y][x] = clamp(shade, 0, 1);
        }
    }
}

// ===== TEMPERATURE SIMULATION =====
function calculateBaseTemperature(month: number, hour: number): number {
    const monthTemp = MONTHLY_TEMPS[month - 1];
    const isDayTime = hour >= 6 && hour <= 18;
    
    if (isDayTime) {
        const hoursSinceSunrise = hour - 6;
        const hourModifier = Math.sin((hoursSinceSunrise / 12) * Math.PI) * 6;
        return monthTemp + hourModifier;
    } else {
        const nightHours = hour <= 6 ? hour + 6 : hour - 18;
        const nightCooling = -2 - (nightHours / 12) * 2;
        return monthTemp + nightCooling;
    }
}

function calculateSolarInsolation(x: number, y: number, sunAltitude: number): number {
    if (sunAltitude <= 0 || !isInBounds(x-1, y-1) || !isInBounds(x+1, y+1)) {
        return 0;
    }
    
    const dzdx = (state.elevation[y][x + 1] - state.elevation[y][x - 1]) / (2 * CELL_SIZE);
    const dzdy = (state.elevation[y + 1][x] - state.elevation[y - 1][x]) / (2 * CELL_SIZE);
    
    const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    const aspect = Math.atan2(-dzdy, dzdx);
    
    const solarIntensity = Math.max(0, 
        Math.cos(slope) * sunAltitude + 
        Math.sin(slope) * sunAltitude * Math.cos(aspect - Math.PI)
    );
    
    let cloudReduction = 1;
    if (state.cloudCoverage && state.cloudCoverage[y] && state.cloudCoverage[y][x] > 0) {
        const cloudRadiation = calculateCloudRadiation(x, y, state.cloudCoverage, state.cloudOpticalDepth, sunAltitude);
        cloudReduction = cloudRadiation.solarTransmission;
    }
    
    return Math.min(3, solarIntensity * SOLAR_INTENSITY_FACTOR * cloudReduction);
}

function calculatePhysicsRates(month: number, hour: number, enableInversions: boolean, enableDownslope: boolean) {
    // Reset the rate grid
    state.inversionAndDownslopeRate = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

    // Inversion effects
    if (enableInversions && state.inversionStrength > 0) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const elev = state.elevation[y][x];
                if (elev < state.inversionHeight) {
                    const depthBelowInversion = state.inversionHeight - elev;
                    const relativeDepth = depthBelowInversion / (state.inversionHeight - BASE_ELEVATION + 50);
                    const coolingEffectRate = -state.inversionStrength * relativeDepth * 4; // This is now a rate per hour
                    state.inversionAndDownslopeRate[y][x] += coolingEffectRate;

                } else if (elev < state.inversionHeight + 100) {
                    const heightAboveInversion = elev - state.inversionHeight;
                    const warmBeltEffectRate = state.inversionStrength * Math.exp(-heightAboveInversion / 40) * 3; // Rate per hour

                    if (isInBounds(x - 1, y - 1) && isInBounds(x + 1, y + 1)) {
                        const avgSurrounding = (
                            state.elevation[y - 1][x] + state.elevation[y + 1][x] +
                            state.elevation[y][x - 1] + state.elevation[y][x + 1]
                        ) / 4;
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

    // Downslope wind effects
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
                    // This is the rate of change towards the base temp
                    const mixingRate = (baseTemp - state.temperature[y][x]) * mixing;
                    state.inversionAndDownslopeRate[y][x] += mixingRate;
                }
            }
        }
    }
}


function runSimulation(simDeltaTimeMinutes: number): void {
    if (!ctx) return;

    const month = parseInt((document.getElementById('month') as HTMLSelectElement).value);
    const windSpeed = parseInt((document.getElementById('windSpeed') as HTMLInputElement).value);
    const windDir = parseInt((document.getElementById('windDirection') as HTMLSelectElement).value);
    const windGustiness = parseInt((document.getElementById('windGustiness') as HTMLInputElement).value);
    const enableAdvection = (document.getElementById('enableAdvection') as HTMLInputElement).checked;
    const enableDiffusion = (document.getElementById('enableDiffusion') as HTMLInputElement).checked;
    const enableInversions = (document.getElementById('enableInversions') as HTMLInputElement).checked;
    const enableDownslope = (document.getElementById('enableDownslope') as HTMLInputElement).checked;
    const enableClouds = (document.getElementById('enableClouds') as HTMLInputElement).checked;

    const totalMinutesInDay = 24 * 60;
    if (state.simulationTime >= totalMinutesInDay) {
        state.simulationTime -= totalMinutesInDay;
    }
    const currentHour = Math.floor(state.simulationTime / 60);
    const currentMinute = Math.floor(state.simulationTime % 60);

    const day = Math.floor(state.simulationTime / totalMinutesInDay) + 1;
    (document.getElementById('simDay') as HTMLElement).textContent = `Day ${day}`;
    (document.getElementById('simTime') as HTMLElement).textContent = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

    const sunAltitude = Math.max(0, Math.sin((currentHour + currentMinute / 60 - 6) * Math.PI / 12));
    const timeFactor = simDeltaTimeMinutes / 60.0;

    state.latentHeatEffect = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    
    if (enableDownslope) {
        calculateDownslopeWinds(currentHour, windSpeed, windDir, windGustiness);
    } else {
        state.downSlopeWinds = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
        state.windVectorField = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null).map(() => ({x: 0, y: 0, speed: 0})));
        state.foehnEffect = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    }
    
    // --- ADVECTION STEP ---
    if (enableAdvection && timeFactor > 0) {
        state.temperature = advectGrid(state.temperature, state.windVectorField, timeFactor);
        state.humidity = advectGrid(state.humidity, state.windVectorField, timeFactor);
        state.cloudWater = advectGrid(state.cloudWater, state.windVectorField, timeFactor);
    }

    if (enableClouds) {
        updateCloudDynamics(currentHour, windSpeed, windDir, timeFactor);
    } else {
        state.cloudCoverage = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
        state.precipitation = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
        state.thermalStrength = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    }

    if (enableInversions) {
        const totalCloudCover = state.cloudCoverage.flat().reduce((a, b) => a + b, 0) / (GRID_SIZE * GRID_SIZE);
        calculateInversionLayer(currentHour, windSpeed, totalCloudCover);
    } else {
        state.inversionHeight = 0;
        state.inversionStrength = 0;
    }
    
    updateFogSimulation(currentHour, sunAltitude, timeFactor);
    
    calculatePhysicsRates(month, currentHour, enableInversions, enableDownslope);

    let newTemperature: number[][] = state.temperature.map(row => [...row]);
    let newSoilTemperature: number[][] = state.soilTemperature.map(row => [...row]);
    
    if (timeFactor > 0) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const prevAirTemp = state.temperature[y][x];
                const prevSoilTemp = state.soilTemperature[y][x];
                const thermalProps = getThermalProperties(x, y);

                let airEnergyBalance = 0;
                let soilEnergyBalance = 0;

                const snowEffects = calculateSnowEffects(x, y, sunAltitude);
                
                // --- Solar Heating ---
                if (sunAltitude > 0) {
                    const insolation = calculateSolarInsolation(x, y, sunAltitude);
                    const surfaceAlbedo = snowEffects.albedoEffect !== 0 ? 0.8 : thermalProps.albedo;
                    const absorbedEnergy = insolation * (1 - surfaceAlbedo);
                    soilEnergyBalance += absorbedEnergy / thermalProps.heatCapacity;
                }
                
                // --- Radiative Cooling ---
                if (sunAltitude <= 0) {
                    const cloudFactor = 1 - (state.cloudCoverage[y][x] || 0) * 0.75;
                    const coolingRate = 1.2 * cloudFactor;
                    // Snow insulates the ground from radiating heat away
                    const soilCooling = coolingRate * (1 - snowEffects.insulationEffect);
                    soilEnergyBalance -= soilCooling / thermalProps.heatCapacity;
                    airEnergyBalance -= coolingRate * 0.2;
                }
                
                // --- Air-Ground Heat Exchange ---
                const tempDiff = prevSoilTemp - prevAirTemp;
                let exchangeRate = tempDiff * thermalProps.conductivity * 0.8 * (1 - snowEffects.insulationEffect); 

                if (thermalProps.name === 'Water') {
                    // For water, the exchange is much more efficient due to turbulence and moisture.
                    // We increase the rate to ensure air temp closely tracks water temp.
                    exchangeRate *= 2.0;
                }

                airEnergyBalance += exchangeRate;
                soilEnergyBalance -= exchangeRate / thermalProps.heatCapacity;
                
                // --- Evaporative Cooling ---
                if (state.soilMoisture[y][x] > 0 && prevAirTemp > 0 && sunAltitude > 0) {
                    const evapCoolingRate = state.soilMoisture[y][x] * thermalProps.evaporation * sunAltitude * 1.0; // Reduced from 1.2
                    airEnergyBalance -= evapCoolingRate;
                    soilEnergyBalance -= (evapCoolingRate * 0.5) / thermalProps.heatCapacity;
                    if (state.isSimulating) {
                        state.soilMoisture[y][x] = Math.max(0, state.soilMoisture[y][x] - thermalProps.evaporation * 0.005 * timeFactor);
                    }
                }

                // --- Forest Effects ---
                if (state.landCover[y][x] === LAND_TYPES.FOREST) {
                    const depthFactor = Math.min(1, state.forestDepth[y][x] / 12);
                    airEnergyBalance += (sunAltitude > 0) ? -1.0 * depthFactor : 0.3 * depthFactor; // Reduced from -1.5 / 0.5
                }

                // --- Inversion and Downslope Wind Effects (as rates) ---
                airEnergyBalance += state.inversionAndDownslopeRate[y][x];

                // --- Latent Heat from Precipitation ---
                if (state.latentHeatEffect[y][x] > 0) {
                    airEnergyBalance += state.latentHeatEffect[y][x] / timeFactor;
                }
                
                // --- Atmospheric Mixing ---
                const stdTempAtElev = 15 - (state.elevation[y][x] - BASE_ELEVATION) / 100 * LAPSE_RATE;
                airEnergyBalance += (stdTempAtElev - prevAirTemp) * 0.05;

                // --- Clamp Rates & Apply Changes ---
                const MAX_HOURLY_CHANGE = 10;
                airEnergyBalance = clamp(airEnergyBalance, -MAX_HOURLY_CHANGE, MAX_HOURLY_CHANGE);
                soilEnergyBalance = clamp(soilEnergyBalance, -MAX_HOURLY_CHANGE, MAX_HOURLY_CHANGE);

                newTemperature[y][x] += airEnergyBalance * timeFactor;
                newSoilTemperature[y][x] += soilEnergyBalance * timeFactor;
            }
        }
    }
    
    updateSnowCover(newTemperature, sunAltitude, timeFactor);

    if (enableDiffusion) {
        for (let i = 0; i < DIFFUSION_ITERATIONS; i++) {
            const diffusedTemp = newTemperature.map(row => [...row]);
            for (let y = 1; y < GRID_SIZE - 1; y++) {
                for (let x = 1; x < GRID_SIZE - 1; x++) {
                    const avgNeighborTemp = (
                        newTemperature[y - 1][x] + newTemperature[y + 1][x] +
                        newTemperature[y][x - 1] + newTemperature[y][x + 1]
                    ) / 4;
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

    let minT = Infinity, maxT = -Infinity, sumT = 0, totalPrecip = 0, maxCloudH = 0, totalSnow = 0;
    const flatTemp = state.temperature.flat();
    minT = Math.min(...flatTemp);
    maxT = Math.max(...flatTemp);
    sumT = flatTemp.reduce((a, b) => a + b, 0);
    totalPrecip = state.precipitation.flat().reduce((a, b) => a + b, 0);
    maxCloudH = Math.max(...state.cloudTop.flat());
    totalSnow = state.snowDepth.flat().reduce((a, b) => a + b, 0);

    
    (document.getElementById('minTemp') as HTMLElement).textContent = `${minT.toFixed(1)}°C`;
    (document.getElementById('maxTemp') as HTMLElement).textContent = `${maxT.toFixed(1)}°C`;
    (document.getElementById('avgTemp') as HTMLElement).textContent = `${(sumT / (GRID_SIZE * GRID_SIZE)).toFixed(1)}°C`;
    (document.getElementById('totalPrecip') as HTMLElement).textContent = `${totalPrecip.toFixed(2)}mm/hr`;
    (document.getElementById('maxCloudHeight') as HTMLElement).textContent = `${maxCloudH.toFixed(0)}m`;
     (document.getElementById('avgSnowDepth') as HTMLElement).textContent = `${(totalSnow / (GRID_SIZE * GRID_SIZE)).toFixed(1)}cm`;

    
    const inversionInfo = document.getElementById('inversionInfo') as HTMLElement;
    if (enableInversions && state.inversionStrength > 0) {
        inversionInfo.style.display = 'block';
        (document.getElementById('inversionHeight') as HTMLElement).textContent = `${state.inversionHeight.toFixed(0)}m`;
        (document.getElementById('inversionStrength') as HTMLElement).textContent = `${(state.inversionStrength * 100).toFixed(0)}%`;
    } else {
        inversionInfo.style.display = 'none';
    }

    drawGrid();
}

// ===== DRAWING =====
function getTemperatureColor(temp: number): string {
    const minTemp = -10, maxTemp = 40;
    const normalized = clamp((temp - minTemp) / (maxTemp - minTemp), 0, 1);
    
    const hue = (1 - normalized) * 240;
    return `hsl(${hue}, 80%, 50%)`;
}

function drawGrid(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const showSoil = (document.getElementById('showSoilTypes') as HTMLInputElement).checked;
    const showHillshade = (document.getElementById('showHillshade') as HTMLInputElement).checked;
    const showHeatmap = (document.getElementById('showHeatmap') as HTMLInputElement).checked;
    const showClouds = (document.getElementById('showClouds') as HTMLInputElement).checked;
    const showFog = (document.getElementById('showFog') as HTMLInputElement).checked;
    const showPrecip = (document.getElementById('showPrecipitation') as HTMLInputElement).checked;
    const showWind = (document.getElementById('showWindFlow') as HTMLInputElement).checked;
    const showSnow = (document.getElementById('showSnowCover') as HTMLInputElement).checked;


    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const color = showSoil ? getThermalProperties(x, y).color : LAND_COLORS[state.landCover[y][x]];
            ctx.fillStyle = color;
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }
    
    if (showHillshade) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const shade = state.hillshade[y][x];
                ctx.fillStyle = `rgba(0,0,0,${0.5 * (1 - shade)})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }
    
    if (showHeatmap) {
         for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const color = getTemperatureColor(state.temperature[y][x]);
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.globalAlpha = 1.0;
            }
        }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (showSnow && state.snowDepth[y][x] > 0.1) {
                const snowOpacity = Math.min(0.9, state.snowDepth[y][x] / 50);
                ctx.fillStyle = `rgba(255, 255, 255, ${snowOpacity})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            if (showClouds && state.cloudCoverage[y][x] > 0.1) {
                ctx.fillStyle = `rgba(255, 255, 255, ${clamp(state.cloudCoverage[y][x], 0, 0.8)})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            if (showFog && state.fogDensity[y][x] > 0.1) {
                ctx.fillStyle = `rgba(200, 200, 200, ${clamp(state.fogDensity[y][x], 0, 0.7)})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            if (showPrecip && state.precipitation[y][x] > 0.05) {
                const pType = state.precipitationType[y][x];
                let precipColor = 'rgba(100, 150, 255, 0.7)';
                if (pType === PRECIP_TYPES.SNOW) precipColor = 'rgba(220, 220, 255, 0.7)';
                else if (pType === PRECIP_TYPES.SLEET) precipColor = 'rgba(180, 200, 255, 0.7)';
                ctx.fillStyle = precipColor;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }

    if (showWind) {
        ctx.lineWidth = 1;
        for (let y = 0; y < GRID_SIZE; y += 4) {
            for (let x = 0; x < GRID_SIZE; x += 4) {
                const wind = state.windVectorField[y][x];
                if (wind.speed > 1) {
                    const centerX = x * CELL_SIZE + CELL_SIZE * 2;
                    const centerY = y * CELL_SIZE + CELL_SIZE * 2;
                    
                    const angle = Math.atan2(wind.y, wind.x);
                    const length = Math.min(CELL_SIZE * 2, wind.speed);
                    
                    if (state.foehnEffect[y][x] > 0.5) ctx.strokeStyle = 'red';
                    else if (state.downSlopeWinds[y][x] < -0.2) ctx.strokeStyle = 'blue';
                    else ctx.strokeStyle = 'white';
                    
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.lineTo(centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length);
                    ctx.stroke();
                    
                    ctx.beginPath();
                    ctx.moveTo(centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length);
                    ctx.lineTo(centerX + Math.cos(angle - 0.5) * (length-4), centerY + Math.sin(angle - 0.5) * (length-4));
                    ctx.moveTo(centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length);
                    ctx.lineTo(centerX + Math.cos(angle + 0.5) * (length-4), centerY + Math.sin(angle + 0.5) * (length-4));
                    ctx.stroke();
                }
            }
        }
    }
}

// ===== UI AND EVENT HANDLING =====
function handleMouseMove(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);

    if (isInBounds(x, y)) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX + 15}px`;
        tooltip.style.top = `${e.clientY}px`;
        
        const land = Object.keys(LAND_TYPES).find(key => LAND_TYPES[key as keyof typeof LAND_TYPES] === state.landCover[y][x]);
        const surface = getThermalProperties(x, y).name;
        tooltip.innerHTML = `
            <strong>Coords:</strong> ${x}, ${y}<br>
            <strong>Air Temp:</strong> ${state.temperature[y][x].toFixed(1)}°C<br>
            <strong>Surface Temp:</strong> ${state.soilTemperature[y][x].toFixed(1)}°C<br>
            <strong>Elevation:</strong> ${state.elevation[y][x].toFixed(0)}m<br>
            <strong>Land:</strong> ${land}<br>
            <strong>Surface:</strong> ${surface}<br>
            <strong>Humidity:</strong> ${(state.humidity[y][x] * 100).toFixed(0)}%<br>
            <strong>Cloud:</strong> ${(state.cloudCoverage[y][x] * 100).toFixed(0)}%<br>
            <strong>Wind:</strong> ${state.windVectorField[y][x].speed.toFixed(1)} km/h<br>
            <strong>Snow:</strong> ${state.snowDepth[y][x].toFixed(1)}cm
        `;
    } else {
        tooltip.style.display = 'none';
    }

    if (state.isDrawing) {
        drawOnCanvas(x, y);
    }
}

function drawOnCanvas(gridX: number, gridY: number): void {
    let needsRecalculation = false;
    for (let y = gridY - state.brushSize; y <= gridY + state.brushSize; y++) {
        for (let x = gridX - state.brushSize; x <= gridX + state.brushSize; x++) {
            if (isInBounds(x, y) && distance(x, y, gridX, gridY) <= state.brushSize) {
                const power = 1 - (distance(x, y, gridX, gridY) / state.brushSize);
                
                if (state.currentBrushCategory === 'terrain') {
                    const change = (state.isRightClick ? -state.terrainStrength : state.terrainStrength) * power;
                    state.elevation[y][x] = clamp(state.elevation[y][x] + change, 0, 1000);
                     needsRecalculation = true;
                } else if (state.currentBrushCategory === 'land') {
                    if (LAND_TYPE_MAP[state.currentBrush] !== undefined) {
                       state.landCover[y][x] = LAND_TYPE_MAP[state.currentBrush];
                       needsRecalculation = true;
                    }
                } else if (state.currentBrushCategory === 'soil') {
                    if (SOIL_TYPE_MAP[state.currentBrush] !== undefined) {
                        state.soilType[y][x] = SOIL_TYPE_MAP[state.currentBrush];
                        needsRecalculation = true;
                    }
                } else if (state.currentBrushCategory === 'action') {
                    if (state.currentBrush === 'manualPrecipitation') {
                        const currentTemp = state.temperature[y][x];
                        const effectAmount = 0.8 * power;

                        if (currentTemp > -5) {
                            const liquidPrecipAmount = effectAmount * 0.5;
                            const coolingAmount = 1.5 * power;
                            state.soilMoisture[y][x] = Math.min(1, state.soilMoisture[y][x] + liquidPrecipAmount);
                            state.temperature[y][x] -= coolingAmount;
                        } else {
                            const snowAmount = effectAmount * 5;
                            const warmingAmount = 0.5 * power;
                            state.snowDepth[y][x] += snowAmount;
                            state.temperature[y][x] += warmingAmount;
                        }
                    }
                }
            }
        }
    }
    
    if (needsRecalculation) {
        if (state.currentBrushCategory === 'terrain') {
            calculateHillshade();
        } else {
            calculateContiguousAreas();
            calculateDistanceFields();
            initializeSoilMoisture();
        }
    }
    
    // When drawing, only update the static view, don't advance time.
    runSimulation(0);
}

function setupEventListeners(): void {
    document.getElementById('brushCategory')?.addEventListener('change', e => {
        const category = (e.target as HTMLSelectElement).value;
        const terrainBrushes = document.getElementById('terrainBrushes') as HTMLElement;
        const soilBrushes = document.getElementById('soilBrushes') as HTMLElement;
        const terrainStrengthGroup = document.getElementById('terrainStrengthGroup') as HTMLElement;

        if (category === 'terrain') {
            terrainBrushes.style.display = 'block';
            soilBrushes.style.display = 'none';
            const firstBrush = document.querySelector('#terrainBrushes .brush-btn') as HTMLElement;
            firstBrush.click();
        } else {
            terrainBrushes.style.display = 'none';
            soilBrushes.style.display = 'block';
            terrainStrengthGroup.style.display = 'none';
            const firstBrush = document.querySelector('#soilBrushes .brush-btn') as HTMLElement;
            firstBrush.click();
        }
    });

    document.querySelectorAll('.brush-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelector('.brush-btn.active')?.classList.remove('active');
            btn.classList.add('active');
            state.currentBrush = btn.getAttribute('data-brush')!;
            state.currentBrushCategory = btn.getAttribute('data-category')!;
            
            const terrainStrengthGroup = document.getElementById('terrainStrengthGroup') as HTMLElement;
            terrainStrengthGroup.style.display = state.currentBrushCategory === 'terrain' ? 'block' : 'none';
        });
    });
    
    // Re-couple climate settings to provide immediate feedback
    document.getElementById('month')?.addEventListener('change', () => runSimulation(0));
    document.getElementById('windDirection')?.addEventListener('change', () => runSimulation(0));
    document.getElementById('windSpeed')?.addEventListener('input', e => {
        (document.getElementById('windSpeedValue') as HTMLElement).textContent = (e.target as HTMLInputElement).value;
        runSimulation(0);
    });
    document.getElementById('windGustiness')?.addEventListener('input', e => {
        (document.getElementById('windGustinessValue') as HTMLElement).textContent = (e.target as HTMLInputElement).value;
        runSimulation(0);
    });
    
    document.querySelectorAll('#controls input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            // Visualization checkboxes should redraw immediately.
            if (checkbox.id.startsWith('show')) {
                drawGrid();
            } else {
                // Physics checkboxes should trigger a recalculation.
                runSimulation(0);
            }
        });
    });

    document.getElementById('brushSize')?.addEventListener('input', e => {
        state.brushSize = parseInt((e.target as HTMLInputElement).value);
        (document.getElementById('brushSizeValue') as HTMLElement).textContent = state.brushSize.toString();
    });
    document.getElementById('terrainStrength')?.addEventListener('input', e => {
        state.terrainStrength = parseInt((e.target as HTMLInputElement).value);
        (document.getElementById('terrainStrengthValue') as HTMLElement).textContent = state.terrainStrength.toString();
    });

    const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
    playPauseBtn.addEventListener('click', () => {
        state.isSimulating = !state.isSimulating;
        playPauseBtn.innerHTML = state.isSimulating ? '⏸️ Pause' : '▶️ Play';
        if (state.isSimulating) {
            state.lastFrameTime = performance.now();
        }
    });

    document.getElementById('createScenarioBtn')?.addEventListener('click', () => {
        state.isSimulating = false;
        playPauseBtn.innerHTML = '▶️ Play';
        state.simulationTime = 6 * 60; // Reset time to the start of the day
        runSimulation(0); // Run a single frame to apply all current settings at the start time
    });

    document.getElementById('resetBtn')?.addEventListener('click', () => {
        state.isSimulating = false;
        (document.getElementById('playPauseBtn') as HTMLButtonElement).innerHTML = '▶️ Play';
        state.simulationTime = 6 * 60;
        initializeGrids();
    });
    document.getElementById('simSpeed')?.addEventListener('input', e => {
        state.simulationSpeed = parseInt((e.target as HTMLInputElement).value);
        (document.getElementById('speedValue') as HTMLElement).textContent = `${state.simulationSpeed}x`;
    });


    canvas.addEventListener('mousedown', e => {
        state.isDrawing = true;
        state.isRightClick = e.button === 2;
        handleMouseMove(e as MouseEvent);
        e.preventDefault();
    });
    canvas.addEventListener('mouseup', () => {
        if(state.isDrawing){
            state.isDrawing = false;
        }
    });
    canvas.addEventListener('mouseleave', () => {
        state.isDrawing = false;
        tooltip.style.display = 'none';
    });
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ===== SIMULATION LOOP =====
function simulationLoop(currentTime: number) {
    const deltaTime = (currentTime - state.lastFrameTime) / 1000;
    state.lastFrameTime = currentTime;

    if (state.isSimulating) {
        const simDeltaTimeMinutes = deltaTime * SIM_MINUTES_PER_REAL_SECOND * state.simulationSpeed;
        state.simulationTime += simDeltaTimeMinutes;
        runSimulation(simDeltaTimeMinutes);
    }

    requestAnimationFrame(simulationLoop);
}


// ===== INITIALIZATION =====
setupEventListeners();
initializeGrids();
requestAnimationFrame(simulationLoop); // Start the main loop