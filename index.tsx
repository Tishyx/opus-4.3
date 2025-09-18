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
    URBAN_HEAT_RADIUS,
    URBAN_PROPERTIES,
    WATER_PROPERTIES,
} from './src/shared/constants';
import { LAND_TYPES, SOIL_TYPES } from './src/shared/types';
import {
    createSimulationState,
    resizeCanvas,
    type SimulationState,
} from './src/simulation/state';
import {
    calculateContiguousAreas,
    calculateDistanceFields,
    calculateHillshade,
    initializeEnvironment,
} from './src/simulation/environment';
import { CLOUD_TYPES, PRECIP_TYPES } from './src/simulation/weatherTypes';
import { updateCloudDynamics } from './src/simulation/clouds';
import { advectGrid, calculateDownslopeWinds } from './src/simulation/wind';
import { updateFogSimulation } from './src/simulation/fog';
import { initializeSoilMoisture } from './src/simulation/soil';
import {
    clamp,
    describeSurface,
    distance,
    getLandColor,
    isInBounds,
    resolveLandType,
    resolveSoilType,
} from './src/simulation/utils';
import {
    calculateInversionLayer,
    calculateSimulationMetrics,
    updateThermodynamics,
} from './src/simulation/physics';

// ===== GLOBAL STATE =====
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip') as HTMLElement;

const state: SimulationState = createSimulationState();
resizeCanvas(canvas);
const SIM_MINUTES_PER_REAL_SECOND = 15; // At 1x speed, 1 real second = 15 sim minutes

// ===== INITIALIZATION =====
function initializeGrids(): void {
    initializeEnvironment(state);
    initializeSoilMoisture(state);
    runSimulation(0);
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

    const sunAltitude = Math.max(0, Math.sin(((currentHour + currentMinute / 60) - 6) * Math.PI / 12));
    const timeFactor = simDeltaTimeMinutes / 60.0;

    state.latentHeatEffect = Array(GRID_SIZE)
        .fill(null)
        .map(() => Array(GRID_SIZE).fill(0));

    if (enableDownslope) {
        calculateDownslopeWinds(state, currentHour, windSpeed, windDir, windGustiness);
    } else {
        state.downSlopeWinds = Array(GRID_SIZE)
            .fill(null)
            .map(() => Array(GRID_SIZE).fill(0));
        state.windVectorField = Array(GRID_SIZE)
            .fill(null)
            .map(() =>
                Array(GRID_SIZE)
                    .fill(null)
                    .map(() => ({ x: 0, y: 0, speed: 0 }))
            );
        state.foehnEffect = Array(GRID_SIZE)
            .fill(null)
            .map(() => Array(GRID_SIZE).fill(0));
    }

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
        state.cloudCoverage = Array(GRID_SIZE)
            .fill(null)
            .map(() => Array(GRID_SIZE).fill(0));
        state.precipitation = Array(GRID_SIZE)
            .fill(null)
            .map(() => Array(GRID_SIZE).fill(0));
        state.thermalStrength = Array(GRID_SIZE)
            .fill(null)
            .map(() => Array(GRID_SIZE).fill(0));
    }

    if (enableInversions) {
        const totalCloudCover = state.cloudCoverage.flat().reduce((a, b) => a + b, 0) / (GRID_SIZE * GRID_SIZE);
        calculateInversionLayer(state, currentHour, windSpeed, totalCloudCover);
    } else {
        state.inversionHeight = 0;
        state.inversionStrength = 0;
    }

    updateFogSimulation(state, currentHour, sunAltitude, timeFactor);

    updateThermodynamics(state, {
        month,
        hour: currentHour,
        sunAltitude,
        timeFactor,
        enableDiffusion,
        enableInversions,
        enableDownslope,
    });

    const metrics = calculateSimulationMetrics(state);

    (document.getElementById('minTemp') as HTMLElement).textContent = `${metrics.minTemperature.toFixed(1)}°C`;
    (document.getElementById('maxTemp') as HTMLElement).textContent = `${metrics.maxTemperature.toFixed(1)}°C`;
    (document.getElementById('avgTemp') as HTMLElement).textContent = `${metrics.avgTemperature.toFixed(1)}°C`;
    (document.getElementById('totalPrecip') as HTMLElement).textContent = `${metrics.totalPrecipitation.toFixed(2)}mm/hr`;
    (document.getElementById('maxCloudHeight') as HTMLElement).textContent = `${metrics.maxCloudHeight.toFixed(0)}m`;
    (document.getElementById('avgSnowDepth') as HTMLElement).textContent = `${metrics.avgSnowDepth.toFixed(1)}cm`;

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
            calculateHillshade(state);
        } else {
            calculateContiguousAreas(state);
            calculateDistanceFields(state);
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