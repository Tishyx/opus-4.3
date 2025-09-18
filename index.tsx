import {
    BASE_ELEVATION,
    CELL_SIZE,
    DIFFUSION_ITERATIONS,
    DIFFUSION_RATE,
    GRID_SIZE,
    LAPSE_RATE,
    SETTLEMENT_HEAT_RADIUS,
    SETTLEMENT_PROPERTIES,
    SHADOW_COOLING,
    SOIL_PROPERTIES,
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
import { calculateBaseTemperature } from './src/simulation/temperature';
import { calculateCloudRadiation, updateCloudDynamics } from './src/simulation/clouds';
import { advectGrid, calculateDownslopeWinds } from './src/simulation/wind';
import { updateFogSimulation } from './src/simulation/fog';
import { initializeSoilMoisture } from './src/simulation/soil';
import { calculateSnowEffects, updateSnowCover } from './src/simulation/snow';
import {
    clamp,
    describeSurface,
    distance,
    getLandColor,
    getThermalProperties,
    isInBounds,
    resolveLandType,
    resolveSoilType,
} from './src/simulation/utils';

// ===== GLOBAL STATE =====
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip') as HTMLElement;

const state: SimulationState = createSimulationState();
resizeCanvas(canvas);
const SIM_MINUTES_PER_REAL_SECOND = 15; // At 1x speed, 1 real second = 15 sim minutes

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
    initializeSoilMoisture(state);
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
        const cloudRadiation = calculateCloudRadiation(state, x, y, sunAltitude);
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
        calculateDownslopeWinds(state, currentHour, windSpeed, windDir, windGustiness);
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
        updateCloudDynamics(state, {
            month,
            hour: currentHour,
            windSpeed,
            windDir,
            timeFactor,
        });
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
    
    updateFogSimulation(state, currentHour, sunAltitude, timeFactor);
    
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

                const snowEffects = calculateSnowEffects(state, x, y, sunAltitude);
                
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
    
    updateSnowCover(state, newTemperature, sunAltitude, timeFactor);

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
            ctx.fillStyle = getLandColor(state, x, y, showSoil);
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
        const surface = describeSurface(state, x, y);
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
                    const landType = resolveLandType(state.currentBrush);
                    if (landType !== undefined) {
                        state.landCover[y][x] = landType;
                        needsRecalculation = true;
                    }
                } else if (state.currentBrushCategory === 'soil') {
                    const soilType = resolveSoilType(state.currentBrush);
                    if (soilType !== undefined) {
                        state.soilType[y][x] = soilType;
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
            initializeSoilMoisture(state);
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