// ===== CONSTANTS AND CONFIGURATION =====
const GRID_SIZE = 100;
const CELL_SIZE = 6;
const BASE_ELEVATION = 100;
const LAPSE_RATE = 0.65; // °C per 100m
const SOLAR_INTENSITY_FACTOR = 1.5; // Reduced from 2
const SHADOW_COOLING = 0.8; // Reduced from 1
const WIND_CHILL_FACTOR = 0.03; // Reduced from 0.05
const COLD_AIR_FLOW_INTENSITY = 2; // Reduced from 3
const DIFFUSION_ITERATIONS = 2; // Reduced from 3
const DIFFUSION_RATE = 0.08; // Reduced from 0.15
const URBAN_HEAT_RADIUS = 60; // Reduced from 8
const SETTLEMENT_HEAT_RADIUS = 4; // Reduced from 5
const FOG_WIND_DISSIPATION = 0.02;
const FOG_SUN_DISSIPATION = 0.5;
const FOG_TEMP_DISSIPATION = 0.3;
const FOG_ADVECTION_RATE = 0.1;
const FOG_DOWNSLOPE_RATE = 0.2;
const FOG_DIFFUSION_RATE = 0.4;
const EPSILON = 1e-6; // A small number to prevent division by zero

// Temperature ranges by month (base temperatures)
const MONTHLY_TEMPS = [-10, -8, -3, 2, 8, 13, 15, 15, 8, 2, -4, -9];


// Land cover types
const LAND_TYPES = {
    GRASSLAND: 0,
    FOREST: 1,
    WATER: 2,
    URBAN: 3,
    SETTLEMENT: 4
};

const LAND_TYPE_MAP: { [key: string]: number } = {
    'grassland': LAND_TYPES.GRASSLAND,
    'forest': LAND_TYPES.FOREST,
    'water': LAND_TYPES.WATER,
    'urban': LAND_TYPES.URBAN,
    'settlement': LAND_TYPES.SETTLEMENT
};

// Soil types with thermal properties
const SOIL_TYPES = {
    LOAM: 0,
    SAND: 1,
    CLAY: 2,
    ROCK: 3
};

const SOIL_TYPE_MAP: { [key: string]: number } = {
    'loam': SOIL_TYPES.LOAM,
    'sand': SOIL_TYPES.SAND,
    'clay': SOIL_TYPES.CLAY,
    'rock': SOIL_TYPES.ROCK
};

// Unified Thermal Properties for all surface types
const WATER_PROPERTIES = {
    name: 'Water',
    color: '#4a9eff',
    heatCapacity: 15.0,      // Very high - massive thermal inertia (Reduced from 20.0)
    conductivity: 4.0,       // High - good heat transfer within water (Reduced from 5.0)
    waterRetention: 1.0,     // N/A
    albedo: 0.08,            // Low reflectivity - absorbs energy
    evaporation: 1.5         // High evaporation rate
};

const URBAN_PROPERTIES = {
    name: 'Urban',
    color: '#8b8b8b',
    heatCapacity: 1.6,       // High - stores a lot of heat (concrete/asphalt) (Reduced from 1.8)
    conductivity: 2.0,       // Very high - conducts heat well (Reduced from 2.2)
    waterRetention: 0.05,    // Almost zero
    albedo: 0.12,            // Low - absorbs sunlight
    evaporation: 0.1         // Very low evaporation
};

const SETTlement_PROPERTIES = {
    name: 'Settlement',
    color: '#a67c52',
    heatCapacity: 1.3,       // Higher than soil, less than urban (Reduced from 1.4)
    conductivity: 1.6,       // High (Reduced from 1.8)
    waterRetention: 0.2,     // Low
    albedo: 0.18,            // Moderate
    evaporation: 0.4         // Low
};


// Soil thermal properties
const SOIL_PROPERTIES = {
    [SOIL_TYPES.LOAM]: {
        name: 'Loam',
        color: '#8B7355',
        heatCapacity: 1.0,      // Baseline - moderate
        conductivity: 1.0,       // Baseline - moderate
        waterRetention: 0.7,     // Good water retention
        albedo: 0.2,            // Moderate reflectivity
        evaporation: 1.0        // Normal evaporation rate
    },
    [SOIL_TYPES.SAND]: {
        name: 'Sand',
        color: '#F4E4BC',
        heatCapacity: 0.8,      // Low - heats/cools quickly
        conductivity: 0.4,       // Low - poor heat transfer
        waterRetention: 0.2,     // Poor water retention
        albedo: 0.55,           // High reflectivity (light color)
        evaporation: 1.2        // Fast evaporation
    },
    [SOIL_TYPES.CLAY]: {
        name: 'Clay',
        color: '#A0522D',
        heatCapacity: 1.1,      // High - slow to heat/cool
        conductivity: 1.3,       // High - good heat transfer
        waterRetention: 0.9,     // Excellent water retention
        albedo: 0.15,           // Low reflectivity (dark when wet)
        evaporation: 0.6        // Slow evaporation
    },
    [SOIL_TYPES.ROCK]: {
        name: 'Rock/Bedrock',
        color: '#696969',
        heatCapacity: 1.2,      // Very high - thermal mass
        conductivity: 2.0,       // Very high - excellent conductor
        waterRetention: 0.1,     // Almost no water retention
        albedo: 0.25,           // Variable reflectivity
        evaporation: 0.1        // Minimal evaporation
    }
};

// Colors for land types
const LAND_COLORS = {
    [LAND_TYPES.GRASSLAND]: '#90b56a',
    [LAND_TYPES.FOREST]: '#2d5a2d',
    [LAND_TYPES.WATER]: '#4a9eff',
    [LAND_TYPES.URBAN]: '#8b8b8b',
    [LAND_TYPES.SETTLEMENT]: '#a67c52'
};

// ===== GLOBAL STATE =====
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip') as HTMLElement;

canvas.width = GRID_SIZE * CELL_SIZE;
canvas.height = GRID_SIZE * CELL_SIZE;

// Grid data structures - Initialize with empty 2D arrays
let elevation: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(BASE_ELEVATION));
let landCover: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let soilType: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let temperature: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(20));
let hillshade: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(1));

// Distance and area fields for dynamic effects
let waterDistance: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
let nearestWaterAreaId: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let forestDistance: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
let nearestForestAreaId: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let forestDepth: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let urbanDistance: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
let contiguousAreas: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let areasizes = new Map<number, number>();

// Atmospheric layers for inversions
let inversionHeight = 0;
let inversionStrength = 0;
let fogDensity: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

// Downslope wind fields
let downSlopeWinds: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let windVectorField: {x: number, y: number, speed: number}[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null).map(() => ({x: 0, y: 0, speed: 0})));
let foehnEffect: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let inversionAndDownslopeRate: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

// Soil moisture and temperature
let soilMoisture: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let soilTemperature: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(20));

// Cloud dynamics system
let cloudCoverage: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let cloudBase: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let cloudTop: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let cloudType: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let cloudOpticalDepth: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let precipitation: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let precipitationType: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let humidity: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0.5));
let dewPoint: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(10));
let convectiveEnergy: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let thermalStrength: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let cloudWater: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let iceContent: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
let latentHeatEffect: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

// Snow simulation system
let snowDepth: number[][] = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

// Cloud type constants
const CLOUD_TYPES = {
    NONE: 0,
    CUMULUS: 1,
    STRATUS: 2,
    CUMULONIMBUS: 3,
    OROGRAPHIC: 4,
    CIRRUS: 5,
    ALTOSTRATUS: 6
};

// Precipitation type constants
const PRECIP_TYPES = {
    NONE: 0,
    RAIN: 1,
    SNOW: 2,
    SLEET: 3,
    FREEZING_RAIN: 4,
    GRAUPEL: 5
};

// Brush settings
let currentBrush = 'terrain';
let currentBrushCategory = 'terrain';
let brushSize = 15;
let terrainStrength = 5;
let isDrawing = false;
let isRightClick = false;

// ===== SIMULATION STATE =====
let isSimulating = false;
let simulationTime = 6 * 60; // Start at 06:00, in minutes
let simulationSpeed = 10;
let lastFrameTime = performance.now();
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
    const land = landCover[y][x];
    if (land === LAND_TYPES.WATER) return WATER_PROPERTIES;
    if (land === LAND_TYPES.URBAN) return URBAN_PROPERTIES;
    if (land === LAND_TYPES.SETTLEMENT) return SETTlement_PROPERTIES;
    return SOIL_PROPERTIES[soilType[y][x]];
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
    if (humidity[y][x] > 0.7) {
        coverage = (humidity[y][x] - 0.7) / 0.3; // 0 to 1 scale
    }
    
    // Increase cloud coverage in afternoon (convective development)
    if (hour >= 12 && hour <= 17) {
        const afternoonFactor = Math.sin((hour - 12) / 5 * Math.PI);
        coverage += afternoonFactor * 0.3;
    }
    
    // Increase clouds over water bodies (evaporation)
    if (landCover[y][x] === LAND_TYPES.WATER) {
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
        const dzdx = (elevation[y][x + 1] - elevation[y][x - 1]) / (2 * CELL_SIZE);
        const dzdy = (elevation[y + 1][x] - elevation[y - 1][x]) / (2 * CELL_SIZE);
        
        // Dot product of wind and upslope direction
        const slopeDotWind = dzdx * windX + dzdy * windY;
        
        if (slopeDotWind > 0) {
            isWindward = true;
            liftAmount = slopeDotWind * windSpeed / 10;
        }
    }
    
    if (!isWindward) return 0;
    
    // Calculate lifting condensation level (LCL)
    const dewPointDeficit = temperature[y][x] - dewPoint[y][x];
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
    const localCloudWater = cloudWater[y][x];

    // No precipitation if there's very little cloud water
    if (localCloudWater < 0.2) return { rate: 0, type: PRECIP_TYPES.NONE };

    let precipEfficiency = 0;
    let precipProbability = 0;

    // Determine efficiency and probability based on cloud type
    switch(cloudType[y][x]) {
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
        if (temperature[y][x] > 2) {
            precipType = PRECIP_TYPES.RAIN;
        } else if (temperature[y][x] <= -5) {
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
        
        if (landCover[y][x] === LAND_TYPES.URBAN) {
            thermal = tempExcess * 1.3;
        } else if (soilType[y][x] === SOIL_TYPES.SAND) {
            thermal = tempExcess * 1.1;
        } else if (landCover[y][x] === LAND_TYPES.GRASSLAND) {
            thermal = tempExcess;
        } else if (landCover[y][x] === LAND_TYPES.WATER || landCover[y][x] === LAND_TYPES.FOREST) {
            thermal = tempExcess * 0.5;
        }
    }
    
    const CAPE = Math.max(0, thermal * humidity[y][x] * 100);
    
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
    
    if (temperature[y][x] < 0 && cloudWater[y][x] > 0) {
        const freezingRate = Math.exp(-temperature[y][x] / 10);
        iceContent = cloudWater[y][x] * freezingRate;
        cloudWater[y][x] *= (1 - freezingRate * 0.5);
    }
    
    if (temperature[y][x] > 0 && cloudWater[y][x] > 0.3) {
        dropletSize = 5 + updraftSpeed * 2;
        if (dropletSize > 20) {
            precipitationEfficiency = Math.min(1, dropletSize / 50);
        }
    }
    
    let graupelFormation = 0;
    if (temperature[y][x] > -10 && temperature[y][x] < 0 && updraftSpeed > 5) {
        graupelFormation = iceContent * 0.3;
    }
    
    return {
        ice: iceContent,
        dropletSize: dropletSize,
        precipEfficiency: precipitationEfficiency,
        graupel: graupelFormation
    };
}

function calculateCloudRadiation(x: number, y: number, cloudCoverage: number[][], cloudOpticalDepth: number[][], sunAltitude: number): {solarTransmission: number, longwaveWarming: number} {
    let solarTransmission = 1;
    if (cloudCoverage[y][x] > 0) {
        const opticalPath = cloudOpticalDepth[y][x] / Math.max(0.1, Math.sin(sunAltitude));
        solarTransmission = (1 - cloudCoverage[y][x]) + 
                           cloudCoverage[y][x] * Math.exp(-opticalPath);
    }
    
    let longwaveEffect = 0;
    if (cloudCoverage[y][x] > 0) {
        longwaveEffect = cloudCoverage[y][x] * 3;
    }
    
    return {
        solarTransmission: solarTransmission,
        longwaveWarming: longwaveEffect
    };
}

function updateHumidity(x: number, y: number, temperature: number[][], windSpeed: number, precipRate: number, precipType: number, timeFactor: number): void {
    let evaporationRate = 0; // rate in %/hr
    
    if (landCover[y][x] === LAND_TYPES.WATER) {
        evaporationRate = 2.0 * Math.max(0, temperature[y][x] / 30) * (1 + windSpeed / 20);
    } else if (landCover[y][x] === LAND_TYPES.FOREST) {
        evaporationRate = 1.0 * Math.max(0, temperature[y][x] / 30);
    } else if (soilMoisture[y][x] > 0) {
        const thermalProps = getThermalProperties(x, y);
        const soilEvap = soilMoisture[y][x] * thermalProps.evaporation;
        evaporationRate = soilEvap * 1.0 * Math.max(0, temperature[y][x] / 30);
    }
    
    let precipReductionRate = 0;
    if (precipRate > 0 && precipType !== PRECIP_TYPES.SNOW) {
        precipReductionRate = precipRate * 10; // 1mm/hr rain reduces humidity by 10%/hr
    }

    const humidityChange = (evaporationRate - precipReductionRate) * timeFactor / 100;
    humidity[y][x] = clamp(humidity[y][x] + humidityChange, 0.01, 1);
    
    const a = 17.27;
    const b = 237.7;
    const relHumidity = humidity[y][x];
    const gamma = Math.log(relHumidity) + (a * temperature[y][x]) / (b + temperature[y][x]);
    dewPoint[y][x] = (b * gamma) / (a - gamma);
}

function updateCloudDynamics(hour: number, windSpeed: number, windDir: number, timeFactor: number): void {
    if (timeFactor <= 0) return;

    const sunAltitude = Math.max(0, Math.sin((hour - 6) * Math.PI / 12));
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const orographicFormationRate = calculateOrographicClouds(x, y, windSpeed, windDir, humidity, temperature) * 2.0; // rate in water/hr
            
            const convective = calculateConvectiveClouds(x, y, hour, temperature[y][x], humidity);
            const convectiveFormationRate = convective.development * 2.0;
            
            convectiveEnergy[y][x] = convective.cape;
            thermalStrength[y][x] = convective.thermalStrength;
            
            let cloudFormationRate = 0;
            if (orographicFormationRate > 0.5) {
                cloudType[y][x] = CLOUD_TYPES.OROGRAPHIC;
                cloudFormationRate = orographicFormationRate;
                cloudBase[y][x] = elevation[y][x] + 100;
                cloudTop[y][x] = elevation[y][x] + 500 + orographicFormationRate * 1000;
            } else if (convectiveFormationRate > 0.3) {
                cloudType[y][x] = convective.type;
                cloudFormationRate = convectiveFormationRate;
                cloudBase[y][x] = elevation[y][x] + 500;
                cloudTop[y][x] = elevation[y][x] + 500 + convective.cape;
            } else if (fogDensity[y][x] > 0.5) {
                cloudType[y][x] = CLOUD_TYPES.STRATUS;
                cloudFormationRate = fogDensity[y][x] * 0.5;
                cloudBase[y][x] = elevation[y][x];
                cloudTop[y][x] = elevation[y][x] + 200;
            } else {
                cloudType[y][x] = CLOUD_TYPES.NONE;
            }
            
            const solarDissipationRate = sunAltitude > 0 ? cloudWater[y][x] * sunAltitude * 0.8 : 0;
            
            const precip = calculatePrecipitation(x, y, cloudWater, cloudType, temperature);
            const precipRate = precip.rate; // mm/hr
            precipitation[y][x] = precipRate;
            precipitationType[y][x] = precip.type;
            const precipWaterLossRate = precipRate * 0.1;

            const cloudWaterChange = (cloudFormationRate - solarDissipationRate - precipWaterLossRate) * timeFactor;
            cloudWater[y][x] = clamp(cloudWater[y][x] + cloudWaterChange, 0, 1.5);
            
            cloudCoverage[y][x] = Math.min(1, cloudWater[y][x]);
            cloudOpticalDepth[y][x] = cloudWater[y][x] * 10;
            
            updateHumidity(x, y, temperature, windSpeed, precipRate, precip.type, timeFactor);
            
            const updraft = thermalStrength[y][x] * 2;
            const microphysics = calculateCloudMicrophysics(x, y, cloudWater, temperature, updraft);
            iceContent[y][x] = microphysics.ice;
            
            if (precipRate > 0) {
                 if (precip.type === PRECIP_TYPES.SNOW) {
                    const snowAccumulation = precipRate * 10 * timeFactor;
                    snowDepth[y][x] += snowAccumulation;
                    latentHeatEffect[y][x] += precipRate * 0.8;
                } else {
                    const thermalProps = getThermalProperties(x, y);
                    const infiltration = Math.min(precipRate * timeFactor, 1 - soilMoisture[y][x]);
                    soilMoisture[y][x] += infiltration * thermalProps.waterRetention;
                }
            }
        }
    }
    
    smoothCloudFields();
}

function smoothCloudFields() {
    const smoothed = cloudCoverage.map(row => [...row]);
    
    for (let y = 1; y < GRID_SIZE - 1; y++) {
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            let sum = 0;
            let count = 0;
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    sum += cloudCoverage[y + dy][x + dx];
                    count++;
                }
            }
            
            smoothed[y][x] = sum / count;
        }
    }
    
    cloudCoverage = smoothed;
}


// ===== SNOW DYNAMICS =====
function updateSnowCover(temperatureGrid: number[][], sunAltitude: number, timeFactor: number) {
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (snowDepth[y][x] > 0) {
                if (temperatureGrid[y][x] > 0) {
                    const meltRate = (temperatureGrid[y][x] * 0.5 + sunAltitude * 2.0);
                    const latentCooling = -Math.min(temperatureGrid[y][x], meltRate * 0.15);
                    temperatureGrid[y][x] += latentCooling;
                    snowDepth[y][x] = Math.max(0, snowDepth[y][x] - meltRate * timeFactor);
                    const meltwater = Math.min(meltRate * timeFactor / 10, 1 - soilMoisture[y][x]);
                    soilMoisture[y][x] += meltwater;

                }
                if (sunAltitude > 0) {
                     snowDepth[y][x] = Math.max(0, snowDepth[y][x] - sunAltitude * 0.05 * timeFactor);
                }
            }
        }
    }
}

function calculateSnowEffects(x: number, y: number, sunAltitude: number): { albedoEffect: number, insulationEffect: number } {
    if (snowDepth[y][x] <= 0) {
        return { albedoEffect: 0, insulationEffect: 0 };
    }

    const snowAlbedo = 0.8;
    const effectiveAlbedo = snowAlbedo * Math.min(1, snowDepth[y][x] / 10);
    const albedoCooling = -effectiveAlbedo * sunAltitude * SOLAR_INTENSITY_FACTOR * 1.5;

    const insulationFactor = Math.min(1, snowDepth[y][x] / 20);

    return { albedoEffect: albedoCooling, insulationEffect: insulationFactor };
}


// ===== SOIL THERMAL DYNAMICS =====
function initializeSoilMoisture(): void {
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const thermalProps = getThermalProperties(x, y);
            let baseMoisture = thermalProps.waterRetention * 0.5;
            
            if (waterDistance[y][x] < 10) {
                baseMoisture += (10 - waterDistance[y][x]) / 10 * 0.3;
            }
            
            if (isInBounds(x-1, y-1) && isInBounds(x+1, y+1)) {
                const slope = Math.abs(elevation[y][x] - elevation[y-1][x]) + 
                             Math.abs(elevation[y][x] - elevation[y+1][x]);
                if (slope > 20) {
                    baseMoisture *= 0.7;
                }
            }
            
            soilMoisture[y][x] = Math.min(1, baseMoisture);
        }
    }
}

// ===== DOWNSLOPE WIND CALCULATIONS =====
function calculateDownslopeWinds(hour: number, baseWindSpeed: number, windDir: number, windGustiness: number): void {
    downSlopeWinds = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    windVectorField = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null).map(() => ({x: 0, y: 0, speed: 0})));
    foehnEffect = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    
    const isNightTime = hour <= 6 || hour >= 19;
    const windDirRad = windDir * Math.PI / 180;
    
    for (let y = 2; y < GRID_SIZE - 2; y++) {
        for (let x = 2; x < GRID_SIZE - 2; x++) {
            const dzdx = (elevation[y][x + 2] - elevation[y][x - 2]) / (4 * CELL_SIZE);
            const dzdy = (elevation[y + 2][x] - elevation[y - 2][x]) / (4 * CELL_SIZE);
            
            const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
            const slopeAngle = Math.atan(slope);
            
            if (isNightTime && slopeAngle > 0.1) {
                const katabaticStrength = Math.min(1, slopeAngle / 0.5) * (1 - baseWindSpeed / 30);
                
                let isSurfaceSlope = true;
                for (let d = 1; d <= 2; d++) {
                    const checkX = Math.round(x - dzdx * d);
                    const checkY = Math.round(y - dzdy * d);
                    if (isInBounds(checkX, checkY)) {
                        const elevDiff = Math.abs(elevation[checkY][checkX] - elevation[y][x]);
                        if (elevDiff > 30) {
                            isSurfaceSlope = false;
                            break;
                        }
                    }
                }
                
                if (isSurfaceSlope) {
                    const coldAirFlow = katabaticStrength * 0.8;
                    if (slope > EPSILON) {
                        windVectorField[y][x].x = -dzdx / slope * coldAirFlow * 5;
                        windVectorField[y][x].y = -dzdy / slope * coldAirFlow * 5;
                        windVectorField[y][x].speed = coldAirFlow * 5;
                        downSlopeWinds[y][x] = -coldAirFlow * 1.5;
                    }
                }
            }
            
            if (baseWindSpeed > 10 && slopeAngle > 0.15) {
                const windX = Math.sin(windDirRad);
                const windY = -Math.cos(windDirRad);
                
                let isLeeSide = false;
                let maxUpwindHeight = elevation[y][x];
                
                for (let d = 1; d <= 10; d++) {
                    const checkX = Math.round(x - windX * d);
                    const checkY = Math.round(y - windY * d);
                    
                    if (isInBounds(checkX, checkY)) {
                        if (elevation[checkY][checkX] > maxUpwindHeight + 20) {
                            isLeeSide = true;
                            maxUpwindHeight = elevation[checkY][checkX];
                        }
                    }
                }
                
                if (isLeeSide) {
                    const descentHeight = maxUpwindHeight - elevation[y][x];
                    const adiabaticWarming = descentHeight * 0.01;
                    const foehnStrength = Math.min(1, descentHeight / 100) * (baseWindSpeed / 30);
                    foehnEffect[y][x] = Math.min(12, adiabaticWarming * foehnStrength);
                    
                    windVectorField[y][x].x += windX * foehnStrength * 10;
                    windVectorField[y][x].y += windY * foehnStrength * 10;
                    windVectorField[y][x].speed = Math.sqrt(
                        windVectorField[y][x].x * windVectorField[y][x].x + 
                        windVectorField[y][x].y * windVectorField[y][x].y
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
                    if (isInBounds(nx, ny) && elevation[ny][nx] > elevation[y][x] + 25) {
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
                        exits.push({ elev: elevation[ny][nx], x: nx, y: ny });
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
                            if (!isInBounds(checkX, checkY) || elevation[checkY][checkX] > elevation[y][x] + 30) {
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
                    
                    windVectorField[y][x].x += blendedVecX * finalValleySpeed * 0.8;
                    windVectorField[y][x].y += blendedVecY * finalValleySpeed * 0.8;
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
                        const elev = elevation[y+dy][x+dx];
                        elevSum += elev;
                        elevSqSum += elev * elev;
                    }
                }
                const avgElev = elevSum / 9;
                const stdDev = Math.sqrt(elevSqSum / 9 - avgElev * avgElev);
                roughness = stdDev / 20;

                const thermalTurbulence = (thermalStrength[y][x] || 0) / 15;

                const gustFactor = (windGustiness / 100) * (1 + roughness + thermalTurbulence);
                const localWindSpeed = Math.sqrt(windVectorField[y][x].x**2 + windVectorField[y][x].y**2) + baseWindSpeed;
                const gustMagnitude = localWindSpeed * gustFactor * 0.5;

                windVectorField[y][x].x += (Math.random() - 0.5) * 2 * gustMagnitude;
                windVectorField[y][x].y += (Math.random() - 0.5) * 2 * gustMagnitude;
            }
        }
    }
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const vec = windVectorField[y][x];
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
                    sumX += windVectorField[y + dy][x + dx].x * weight;
                    sumY += windVectorField[y + dy][x + dx].y * weight;
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
            windVectorField[y][x] = smoothed[y][x];
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

            if (inversionStrength > 0 && elevation[y][x] < inversionHeight) {
                const depth = (inversionHeight - elevation[y][x]) / 100;
                formationRate += inversionStrength * depth * 0.5;
            }

            if (temperature[y][x] < dewPoint[y][x] + 2) {
                const saturation = (dewPoint[y][x] + 2 - temperature[y][x]) / 4;
                formationRate += saturation * humidity[y][x];
            }
            
            if (sunAltitude <= 0 && waterDistance[y][x] < 5) {
                formationRate += (5 - waterDistance[y][x]) / 5 * 0.3 * (1 - windVectorField[y][x].speed / 20);
            }

            if (sunAltitude > 0) {
                dissipationRate += sunAltitude * FOG_SUN_DISSIPATION;
            }

            dissipationRate += windVectorField[y][x].speed * FOG_WIND_DISSIPATION;
            
            if (temperature[y][x] > dewPoint[y][x]) {
                dissipationRate += (temperature[y][x] - dewPoint[y][x]) * FOG_TEMP_DISSIPATION;
            }

            fogChangeRate[y][x] = formationRate - dissipationRate;
        }
    }
    
    // Step 2: Apply changes and advection
    let newFogDensity = fogDensity.map(row => [...row]);
    for (let y = 1; y < GRID_SIZE - 1; y++) {
        for (let x = 1; x < GRID_SIZE - 1; x++) {
            // Apply local formation/dissipation
            newFogDensity[y][x] += fogChangeRate[y][x] * timeFactor;

            // Advection
            const wind = windVectorField[y][x];
            if (wind.speed > 0.5) {
                const upwindX = clamp(Math.round(x - wind.x * 0.2), 0, GRID_SIZE - 1);
                const upwindY = clamp(Math.round(y - wind.y * 0.2), 0, GRID_SIZE - 1);
                const advectionChange = (fogDensity[upwindY][upwindX] - fogDensity[y][x]) * FOG_ADVECTION_RATE * Math.min(1, wind.speed / 10);
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
                    const elevDiff = elevation[ny][nx] - elevation[y][x];
                    if (elevDiff > 0) {
                        highNeighborFog += fogDensity[ny][nx] * elevDiff;
                        elevDiffSum += elevDiff;
                    }
                }
            }
            if (elevDiffSum > 0) {
                const avgHighNeighborFog = highNeighborFog / elevDiffSum;
                const downslopeChange = (avgHighNeighborFog - fogDensity[y][x]) * FOG_DOWNSLOPE_RATE;
                newFogDensity[y][x] += downslopeChange * timeFactor;
            }

            // Diffusion
            const avgNeighborFog = (
                fogDensity[y - 1][x] + fogDensity[y + 1][x] +
                fogDensity[y][x - 1] + fogDensity[y][x + 1]
            ) / 4;
            const diffusionChange = (avgNeighborFog - fogDensity[y][x]) * FOG_DIFFUSION_RATE;
            newFogDensity[y][x] += diffusionChange * timeFactor;
        }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            fogDensity[y][x] = clamp(newFogDensity[y][x], 0, 1);
        }
    }
}


// ===== TEMPERATURE INVERSION CALCULATIONS =====
function calculateInversionLayer(hour: number, windSpeed: number, cloudCover = 0): void {
    const isNightTime = hour <= 6 || hour >= 19;
    
    if (!isNightTime || windSpeed > 15 || cloudCover > 0.5) {
        inversionHeight = 0;
        inversionStrength = 0;
        return;
    }
    
    let minElev = Infinity;
    let maxElev = -Infinity;
    let valleyElevSum = 0;
    let valleyCount = 0;
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const elev = elevation[y][x];
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
    
    inversionHeight = valleyAvgElev + 50 + (200 * windFactor * hourFactor);
    inversionStrength = windFactor * hourFactor * Math.min(1, terrainRelief / 100);
    
    inversionHeight = Math.min(inversionHeight, valleyAvgElev + 300);
    
    if (windSpeed > 10 || terrainRelief < 30) {
        inversionStrength *= 0.5;
    }
}

// ===== AREA AND DISTANCE CALCULATIONS =====
function calculateContiguousAreas(): void {
    contiguousAreas = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    areasizes = new Map();
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
            contiguousAreas[y][x] = areaId;
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    
                    if (isInBounds(nx, ny) && !visited[ny][nx] && landCover[ny][nx] === landType) {
                        visited[ny][nx] = true;
                        queue.push([nx, ny]);
                    }
                }
            }
        }
        
        areasizes.set(areaId, cells.length);
        return cells;
    }
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (!visited[y][x]) {
                floodFill(x, y, landCover[y][x]);
            }
        }
    }
}

function calculateDistanceFields(): void {
    waterDistance = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
    nearestWaterAreaId = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    forestDistance = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
    nearestForestAreaId = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    urbanDistance = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(Infinity));
    forestDepth = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

    const waterQueue: [number, number, number, number][] = [];
    const forestQueue: [number, number, number, number][] = [];
    const urbanQueue: [number, number, number][] = [];

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const areaId = contiguousAreas[y][x];
            if (landCover[y][x] === LAND_TYPES.WATER) {
                waterDistance[y][x] = 0;
                nearestWaterAreaId[y][x] = areaId;
                waterQueue.push([x, y, 0, areaId]);
            }
            if (landCover[y][x] === LAND_TYPES.FOREST) {
                forestDistance[y][x] = 0;
                nearestForestAreaId[y][x] = areaId;
                forestQueue.push([x, y, 0, areaId]);
            }
            if (landCover[y][x] === LAND_TYPES.URBAN || landCover[y][x] === LAND_TYPES.SETTLEMENT) {
                urbanDistance[y][x] = 0;
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
                if (isInBounds(nx, ny) && newDist < waterDistance[ny][nx]) {
                    waterDistance[ny][nx] = newDist;
                    nearestWaterAreaId[ny][nx] = areaId;
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
                if (isInBounds(nx, ny) && newDist < forestDistance[ny][nx]) {
                    forestDistance[ny][nx] = newDist;
                    nearestForestAreaId[ny][nx] = areaId;
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
                if (isInBounds(nx, ny) && newDist < urbanDistance[ny][nx]) {
                    urbanDistance[ny][nx] = newDist;
                    urbanQueue.push([nx, ny, newDist]);
                }
            }
        }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (landCover[y][x] === LAND_TYPES.FOREST) {
                let minDistToEdge = Infinity;
                for (let radius = 1; radius < 20; radius++) {
                    let foundEdge = false;
                    for (let dy = -radius; dy <= radius; dy++) {
                        for (let dx = -radius; dx <= radius; dx++) {
                            if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                                const nx = x + dx;
                                const ny = y + dy;
                                if (isInBounds(nx, ny) && landCover[ny][nx] !== LAND_TYPES.FOREST) {
                                    const d = Math.sqrt(dx * dx + dy * dy);
                                    minDistToEdge = Math.min(minDistToEdge, d);
                                    foundEdge = true;
                                }
                            }
                        }
                    }
                    if (foundEdge) break;
                }
                forestDepth[y][x] = minDistToEdge === Infinity ? 20 : minDistToEdge;
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
    elevation = generatePerlinNoise();
    
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            landCover[y][x] = LAND_TYPES.GRASSLAND;
            
            if (elevation[y][x] > 140) {
                soilType[y][x] = SOIL_TYPES.ROCK;
            } else if (elevation[y][x] < 80) {
                soilType[y][x] = Math.random() > 0.5 ? SOIL_TYPES.CLAY : SOIL_TYPES.LOAM;
            } else {
                const rand = Math.random();
                if (rand < 0.4) soilType[y][x] = SOIL_TYPES.LOAM;
                else if (rand < 0.7) soilType[y][x] = SOIL_TYPES.SAND;
                else soilType[y][x] = SOIL_TYPES.CLAY;
            }
            
            temperature[y][x] = 20;
            hillshade[y][x] = 1;
            waterDistance[y][x] = Infinity;
            nearestWaterAreaId[y][x] = 0;
            forestDistance[y][x] = Infinity;
            nearestForestAreaId[y][x] = 0;
            forestDepth[y][x] = 0;
            urbanDistance[y][x] = Infinity;
            contiguousAreas[y][x] = 0;
            fogDensity[y][x] = 0;
            downSlopeWinds[y][x] = 0;
            windVectorField[y][x] = {x: 0, y: 0, speed: 0};
            foehnEffect[y][x] = 0;
            soilMoisture[y][x] = 0;
            soilTemperature[y][x] = 20;
            snowDepth[y][x] = 0;
            cloudCoverage[y][x] = 0;
            cloudBase[y][x] = 0;
            cloudTop[y][x] = 0;
            cloudType[y][x] = CLOUD_TYPES.NONE;
            cloudOpticalDepth[y][x] = 0;
            precipitation[y][x] = 0;
            precipitationType[y][x] = PRECIP_TYPES.NONE;
            humidity[y][x] = 0.5 + Math.random() * 0.2;
            dewPoint[y][x] = 10;
            convectiveEnergy[y][x] = 0;
            thermalStrength[y][x] = 0;
            cloudWater[y][x] = 0;
            iceContent[y][x] = 0;
            latentHeatEffect[y][x] = 0;
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
            elevation[y][x] = ridgeHeight - distFromRidge * 80;
            if (elevation[y][x] > 800) {
                soilType[y][x] = SOIL_TYPES.ROCK;
            }
        }
    }
    
    for (let y = 10; y < 30; y++) {
        for (let x = 10; x < 90; x++) {
            const distFromCenter = Math.abs(y - 20);
            elevation[y][x] = Math.max(60, elevation[y][x] - (10 - distFromCenter) * 5);
            if (elevation[y][x] < 80) {
                soilType[y][x] = SOIL_TYPES.CLAY;
            }
        }
    }
    
    for (let y = 51; y < 70; y++) {
        for (let x = 10; x < 90; x++) {
            const ridgeHeight = 800 + Math.sin(x / 10) * 200;
            const mountainBaseHeight = ridgeHeight - 5 * 80;
            elevation[y][x] = Math.max(80, mountainBaseHeight - (y - 50) * 12);
        }
    }
    
    for (let y = 65; y < 80; y++) {
        for (let x = 30; x < 60; x++) {
            if (Math.random() > 0.3) {
                soilType[y][x] = SOIL_TYPES.SAND;
            }
        }
    }
    
    const lakeX = 27, lakeY = 20, lakeRadius = 6;
    for (let y = lakeY - lakeRadius; y <= lakeY + lakeRadius; y++) {
        for (let x = lakeX - lakeRadius; x <= lakeX + lakeRadius; x++) {
            if (isInBounds(x, y) && distance(x, y, lakeX, lakeY) < lakeRadius) {
                landCover[y][x] = LAND_TYPES.WATER;
                elevation[y][x] = 65;
            }
        }
    }
    
    for (let y = 30; y < 45; y++) {
        for (let x = 20; x < 80; x++) {
            if (isInBounds(x, y) && Math.random() > 0.3) {
                landCover[y][x] = LAND_TYPES.FOREST;
                soilType[y][x] = SOIL_TYPES.LOAM;
            }
        }
    }
    
    const urbanX = 50, urbanY = 55, urbanRadius = 40;
    for (let y = urbanY - urbanRadius; y <= urbanY + urbanRadius; y++) {
        for (let x = urbanX - urbanRadius; x <= urbanX + urbanRadius; x++) {
            if (isInBounds(x, y) && Math.abs(x - urbanX) + Math.abs(y - urbanY) < urbanRadius) {
                landCover[y][x] = LAND_TYPES.SETTLEMENT;
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
            const dzdx = (elevation[y][x + 1] - elevation[y][x - 1]) / (2 * CELL_SIZE);
            const dzdy = (elevation[y + 1][x] - elevation[y - 1][x]) / (2 * CELL_SIZE);
            
            const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
            const aspect = Math.atan2(dzdy, dzdx);
            
            const shade = Math.cos(sunAltitude) * Math.cos(slope) +
                         Math.sin(sunAltitude) * Math.sin(slope) * 
                         Math.cos(sunAzimuth - aspect);
            
            hillshade[y][x] = clamp(shade, 0, 1);
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
    
    const dzdx = (elevation[y][x + 1] - elevation[y][x - 1]) / (2 * CELL_SIZE);
    const dzdy = (elevation[y + 1][x] - elevation[y - 1][x]) / (2 * CELL_SIZE);
    
    const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    const aspect = Math.atan2(-dzdy, dzdx);
    
    const solarIntensity = Math.max(0, 
        Math.cos(slope) * sunAltitude + 
        Math.sin(slope) * sunAltitude * Math.cos(aspect - Math.PI)
    );
    
    let cloudReduction = 1;
    if (cloudCoverage && cloudCoverage[y] && cloudCoverage[y][x] > 0) {
        const cloudRadiation = calculateCloudRadiation(x, y, cloudCoverage, cloudOpticalDepth, sunAltitude);
        cloudReduction = cloudRadiation.solarTransmission;
    }
    
    return Math.min(3, solarIntensity * SOLAR_INTENSITY_FACTOR * cloudReduction);
}

function calculatePhysicsRates(month: number, hour: number, enableInversions: boolean, enableDownslope: boolean) {
    // Reset the rate grid
    inversionAndDownslopeRate = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));

    // Inversion effects
    if (enableInversions && inversionStrength > 0) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const elev = elevation[y][x];
                if (elev < inversionHeight) {
                    const depthBelowInversion = inversionHeight - elev;
                    const relativeDepth = depthBelowInversion / (inversionHeight - BASE_ELEVATION + 50);
                    const coolingEffectRate = -inversionStrength * relativeDepth * 4; // This is now a rate per hour
                    inversionAndDownslopeRate[y][x] += coolingEffectRate;

                } else if (elev < inversionHeight + 100) {
                    const heightAboveInversion = elev - inversionHeight;
                    const warmBeltEffectRate = inversionStrength * Math.exp(-heightAboveInversion / 40) * 3; // Rate per hour

                    if (isInBounds(x - 1, y - 1) && isInBounds(x + 1, y + 1)) {
                        const avgSurrounding = (
                            elevation[y - 1][x] + elevation[y + 1][x] +
                            elevation[y][x - 1] + elevation[y][x + 1]
                        ) / 4;
                        const isSlope = Math.abs(elev - avgSurrounding) < 20;
                        const notValleyFloor = elev > avgSurrounding - 5;
                        if (isSlope && notValleyFloor) {
                            inversionAndDownslopeRate[y][x] += warmBeltEffectRate;
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
                
                if (downSlopeWinds[y][x] < 0) {
                    totalEffectRate += downSlopeWinds[y][x];
                }
                
                if (foehnEffect[y][x] > 0) {
                    totalEffectRate += foehnEffect[y][x];
                }

                inversionAndDownslopeRate[y][x] += clamp(totalEffectRate, -5, 12);
                
                const localWindSpeed = windVectorField[y][x].speed;
                if (localWindSpeed > 5) {
                    const mixing = Math.min(0.3, localWindSpeed / 50);
                    const baseTemp = calculateBaseTemperature(month, hour);
                    // This is the rate of change towards the base temp
                    const mixingRate = (baseTemp - temperature[y][x]) * mixing;
                    inversionAndDownslopeRate[y][x] += mixingRate;
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
    if (simulationTime >= totalMinutesInDay) {
        simulationTime -= totalMinutesInDay;
    }
    const currentHour = Math.floor(simulationTime / 60);
    const currentMinute = Math.floor(simulationTime % 60);

    const day = Math.floor(simulationTime / totalMinutesInDay) + 1;
    (document.getElementById('simDay') as HTMLElement).textContent = `Day ${day}`;
    (document.getElementById('simTime') as HTMLElement).textContent = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

    const sunAltitude = Math.max(0, Math.sin((currentHour + currentMinute / 60 - 6) * Math.PI / 12));
    const timeFactor = simDeltaTimeMinutes / 60.0;

    latentHeatEffect = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    
    if (enableDownslope) {
        calculateDownslopeWinds(currentHour, windSpeed, windDir, windGustiness);
    } else {
        downSlopeWinds = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
        windVectorField = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null).map(() => ({x: 0, y: 0, speed: 0})));
        foehnEffect = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    }
    
    // --- ADVECTION STEP ---
    if (enableAdvection && timeFactor > 0) {
        temperature = advectGrid(temperature, windVectorField, timeFactor);
        humidity = advectGrid(humidity, windVectorField, timeFactor);
        cloudWater = advectGrid(cloudWater, windVectorField, timeFactor);
    }

    if (enableClouds) {
        updateCloudDynamics(currentHour, windSpeed, windDir, timeFactor);
    } else {
        cloudCoverage = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
        precipitation = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
        thermalStrength = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
    }

    if (enableInversions) {
        const totalCloudCover = cloudCoverage.flat().reduce((a, b) => a + b, 0) / (GRID_SIZE * GRID_SIZE);
        calculateInversionLayer(currentHour, windSpeed, totalCloudCover);
    } else {
        inversionHeight = 0;
        inversionStrength = 0;
    }
    
    updateFogSimulation(currentHour, sunAltitude, timeFactor);
    
    calculatePhysicsRates(month, currentHour, enableInversions, enableDownslope);

    let newTemperature: number[][] = temperature.map(row => [...row]);
    let newSoilTemperature: number[][] = soilTemperature.map(row => [...row]);
    
    if (timeFactor > 0) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const prevAirTemp = temperature[y][x];
                const prevSoilTemp = soilTemperature[y][x];
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
                    const cloudFactor = 1 - (cloudCoverage[y][x] || 0) * 0.75;
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
                if (soilMoisture[y][x] > 0 && prevAirTemp > 0 && sunAltitude > 0) {
                    const evapCoolingRate = soilMoisture[y][x] * thermalProps.evaporation * sunAltitude * 1.0; // Reduced from 1.2
                    airEnergyBalance -= evapCoolingRate;
                    soilEnergyBalance -= (evapCoolingRate * 0.5) / thermalProps.heatCapacity;
                    if (isSimulating) {
                        soilMoisture[y][x] = Math.max(0, soilMoisture[y][x] - thermalProps.evaporation * 0.005 * timeFactor);
                    }
                }

                // --- Forest Effects ---
                if (landCover[y][x] === LAND_TYPES.FOREST) {
                    const depthFactor = Math.min(1, forestDepth[y][x] / 12);
                    airEnergyBalance += (sunAltitude > 0) ? -1.0 * depthFactor : 0.3 * depthFactor; // Reduced from -1.5 / 0.5
                }

                // --- Inversion and Downslope Wind Effects (as rates) ---
                airEnergyBalance += inversionAndDownslopeRate[y][x];

                // --- Latent Heat from Precipitation ---
                if (latentHeatEffect[y][x] > 0) {
                    airEnergyBalance += latentHeatEffect[y][x] / timeFactor;
                }
                
                // --- Atmospheric Mixing ---
                const stdTempAtElev = 15 - (elevation[y][x] - BASE_ELEVATION) / 100 * LAPSE_RATE;
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

    temperature = newTemperature;
    soilTemperature = newSoilTemperature;

    let minT = Infinity, maxT = -Infinity, sumT = 0, totalPrecip = 0, maxCloudH = 0, totalSnow = 0;
    const flatTemp = temperature.flat();
    minT = Math.min(...flatTemp);
    maxT = Math.max(...flatTemp);
    sumT = flatTemp.reduce((a, b) => a + b, 0);
    totalPrecip = precipitation.flat().reduce((a, b) => a + b, 0);
    maxCloudH = Math.max(...cloudTop.flat());
    totalSnow = snowDepth.flat().reduce((a, b) => a + b, 0);

    
    (document.getElementById('minTemp') as HTMLElement).textContent = `${minT.toFixed(1)}°C`;
    (document.getElementById('maxTemp') as HTMLElement).textContent = `${maxT.toFixed(1)}°C`;
    (document.getElementById('avgTemp') as HTMLElement).textContent = `${(sumT / (GRID_SIZE * GRID_SIZE)).toFixed(1)}°C`;
    (document.getElementById('totalPrecip') as HTMLElement).textContent = `${totalPrecip.toFixed(2)}mm/hr`;
    (document.getElementById('maxCloudHeight') as HTMLElement).textContent = `${maxCloudH.toFixed(0)}m`;
     (document.getElementById('avgSnowDepth') as HTMLElement).textContent = `${(totalSnow / (GRID_SIZE * GRID_SIZE)).toFixed(1)}cm`;

    
    const inversionInfo = document.getElementById('inversionInfo') as HTMLElement;
    if (enableInversions && inversionStrength > 0) {
        inversionInfo.style.display = 'block';
        (document.getElementById('inversionHeight') as HTMLElement).textContent = `${inversionHeight.toFixed(0)}m`;
        (document.getElementById('inversionStrength') as HTMLElement).textContent = `${(inversionStrength * 100).toFixed(0)}%`;
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
            const color = showSoil ? getThermalProperties(x, y).color : LAND_COLORS[landCover[y][x]];
            ctx.fillStyle = color;
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }
    
    if (showHillshade) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const shade = hillshade[y][x];
                ctx.fillStyle = `rgba(0,0,0,${0.5 * (1 - shade)})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
    }
    
    if (showHeatmap) {
         for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const color = getTemperatureColor(temperature[y][x]);
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.globalAlpha = 1.0;
            }
        }
    }

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (showSnow && snowDepth[y][x] > 0.1) {
                const snowOpacity = Math.min(0.9, snowDepth[y][x] / 50);
                ctx.fillStyle = `rgba(255, 255, 255, ${snowOpacity})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            if (showClouds && cloudCoverage[y][x] > 0.1) {
                ctx.fillStyle = `rgba(255, 255, 255, ${clamp(cloudCoverage[y][x], 0, 0.8)})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            if (showFog && fogDensity[y][x] > 0.1) {
                ctx.fillStyle = `rgba(200, 200, 200, ${clamp(fogDensity[y][x], 0, 0.7)})`;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
            if (showPrecip && precipitation[y][x] > 0.05) {
                const pType = precipitationType[y][x];
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
                const wind = windVectorField[y][x];
                if (wind.speed > 1) {
                    const centerX = x * CELL_SIZE + CELL_SIZE * 2;
                    const centerY = y * CELL_SIZE + CELL_SIZE * 2;
                    
                    const angle = Math.atan2(wind.y, wind.x);
                    const length = Math.min(CELL_SIZE * 2, wind.speed);
                    
                    if (foehnEffect[y][x] > 0.5) ctx.strokeStyle = 'red';
                    else if (downSlopeWinds[y][x] < -0.2) ctx.strokeStyle = 'blue';
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
        
        const land = Object.keys(LAND_TYPES).find(key => LAND_TYPES[key as keyof typeof LAND_TYPES] === landCover[y][x]);
        const surface = getThermalProperties(x, y).name;
        tooltip.innerHTML = `
            <strong>Coords:</strong> ${x}, ${y}<br>
            <strong>Air Temp:</strong> ${temperature[y][x].toFixed(1)}°C<br>
            <strong>Surface Temp:</strong> ${soilTemperature[y][x].toFixed(1)}°C<br>
            <strong>Elevation:</strong> ${elevation[y][x].toFixed(0)}m<br>
            <strong>Land:</strong> ${land}<br>
            <strong>Surface:</strong> ${surface}<br>
            <strong>Humidity:</strong> ${(humidity[y][x] * 100).toFixed(0)}%<br>
            <strong>Cloud:</strong> ${(cloudCoverage[y][x] * 100).toFixed(0)}%<br>
            <strong>Wind:</strong> ${windVectorField[y][x].speed.toFixed(1)} km/h<br>
            <strong>Snow:</strong> ${snowDepth[y][x].toFixed(1)}cm
        `;
    } else {
        tooltip.style.display = 'none';
    }

    if (isDrawing) {
        drawOnCanvas(x, y);
    }
}

function drawOnCanvas(gridX: number, gridY: number): void {
    let needsRecalculation = false;
    for (let y = gridY - brushSize; y <= gridY + brushSize; y++) {
        for (let x = gridX - brushSize; x <= gridX + brushSize; x++) {
            if (isInBounds(x, y) && distance(x, y, gridX, gridY) <= brushSize) {
                const power = 1 - (distance(x, y, gridX, gridY) / brushSize);
                
                if (currentBrushCategory === 'terrain') {
                    const change = (isRightClick ? -terrainStrength : terrainStrength) * power;
                    elevation[y][x] = clamp(elevation[y][x] + change, 0, 1000);
                     needsRecalculation = true;
                } else if (currentBrushCategory === 'land') {
                    if (LAND_TYPE_MAP[currentBrush] !== undefined) {
                       landCover[y][x] = LAND_TYPE_MAP[currentBrush];
                       needsRecalculation = true;
                    }
                } else if (currentBrushCategory === 'soil') {
                    if (SOIL_TYPE_MAP[currentBrush] !== undefined) {
                        soilType[y][x] = SOIL_TYPE_MAP[currentBrush];
                        needsRecalculation = true;
                    }
                } else if (currentBrushCategory === 'action') {
                    if (currentBrush === 'manualPrecipitation') {
                        const currentTemp = temperature[y][x];
                        const effectAmount = 0.8 * power;

                        if (currentTemp > -5) {
                            const liquidPrecipAmount = effectAmount * 0.5;
                            const coolingAmount = 1.5 * power;
                            soilMoisture[y][x] = Math.min(1, soilMoisture[y][x] + liquidPrecipAmount);
                            temperature[y][x] -= coolingAmount;
                        } else {
                            const snowAmount = effectAmount * 5;
                            const warmingAmount = 0.5 * power;
                            snowDepth[y][x] += snowAmount;
                            temperature[y][x] += warmingAmount;
                        }
                    }
                }
            }
        }
    }
    
    if (needsRecalculation) {
        if (currentBrushCategory === 'terrain') {
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
            currentBrush = btn.getAttribute('data-brush')!;
            currentBrushCategory = btn.getAttribute('data-category')!;
            
            const terrainStrengthGroup = document.getElementById('terrainStrengthGroup') as HTMLElement;
            terrainStrengthGroup.style.display = currentBrushCategory === 'terrain' ? 'block' : 'none';
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
        brushSize = parseInt((e.target as HTMLInputElement).value);
        (document.getElementById('brushSizeValue') as HTMLElement).textContent = brushSize.toString();
    });
    document.getElementById('terrainStrength')?.addEventListener('input', e => {
        terrainStrength = parseInt((e.target as HTMLInputElement).value);
        (document.getElementById('terrainStrengthValue') as HTMLElement).textContent = terrainStrength.toString();
    });

    const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
    playPauseBtn.addEventListener('click', () => {
        isSimulating = !isSimulating;
        playPauseBtn.innerHTML = isSimulating ? '⏸️ Pause' : '▶️ Play';
        if (isSimulating) {
            lastFrameTime = performance.now();
        }
    });

    document.getElementById('createScenarioBtn')?.addEventListener('click', () => {
        isSimulating = false;
        playPauseBtn.innerHTML = '▶️ Play';
        simulationTime = 6 * 60; // Reset time to the start of the day
        runSimulation(0); // Run a single frame to apply all current settings at the start time
    });

    document.getElementById('resetBtn')?.addEventListener('click', () => {
        isSimulating = false;
        (document.getElementById('playPauseBtn') as HTMLButtonElement).innerHTML = '▶️ Play';
        simulationTime = 6 * 60;
        initializeGrids();
    });
    document.getElementById('simSpeed')?.addEventListener('input', e => {
        simulationSpeed = parseInt((e.target as HTMLInputElement).value);
        (document.getElementById('speedValue') as HTMLElement).textContent = `${simulationSpeed}x`;
    });


    canvas.addEventListener('mousedown', e => {
        isDrawing = true;
        isRightClick = e.button === 2;
        handleMouseMove(e as MouseEvent);
        e.preventDefault();
    });
    canvas.addEventListener('mouseup', () => {
        if(isDrawing){
            isDrawing = false;
        }
    });
    canvas.addEventListener('mouseleave', () => {
        isDrawing = false;
        tooltip.style.display = 'none';
    });
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ===== SIMULATION LOOP =====
function simulationLoop(currentTime: number) {
    const deltaTime = (currentTime - lastFrameTime) / 1000;
    lastFrameTime = currentTime;

    if (isSimulating) {
        const simDeltaTimeMinutes = deltaTime * SIM_MINUTES_PER_REAL_SECOND * simulationSpeed;
        simulationTime += simDeltaTimeMinutes;
        runSimulation(simDeltaTimeMinutes);
    }

    requestAnimationFrame(simulationLoop);
}


// ===== INITIALIZATION =====
setupEventListeners();
initializeGrids();
requestAnimationFrame(simulationLoop); // Start the main loop