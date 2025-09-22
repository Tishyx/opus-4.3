import { BASE_ELEVATION, GRID_SIZE, LAPSE_RATE } from './src/shared/constants';
import {
    getDaylightHoursFromMonthValue,
    toMonthValue,
} from './src/shared/seasonal';
import {
    createSimulationState,
    resetGrid,
    resizeCanvas,
    type SimulationState,
} from './src/simulation/state';
import { initializeEnvironment } from './src/simulation/environment';
import { updateCloudDynamics } from './src/simulation/clouds';
import {
    advectGrid,
    applyBaseWindField,
    calculateDownslopeWinds,
    createVegetationDragGetter,
} from './src/simulation/wind';
import { updateFogSimulation } from './src/simulation/fog';
import { initializeSoilMoisture } from './src/simulation/soil';
import {
    calculateInversionLayer,
    calculateSimulationMetrics,
    updateThermodynamics,
} from './src/simulation/physics';
import { calculateBaseTemperature } from './src/simulation/temperature';
import {
    readSimulationControls,
    readVisualizationToggles,
    updateInversionDisplay,
    updateMetricsDisplay,
    updateSimulationClock,
    updateTimeOfDayControl,
} from './src/ui/controls';
import { drawSimulation } from './src/ui/rendering';
import { setupEventListeners, type SimulationEventCallbacks } from './src/ui/events';
import { CLOUD_TYPES, PRECIP_TYPES } from './src/simulation/weatherTypes';

// ===== GLOBAL STATE =====
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip') as HTMLElement;

const state: SimulationState = createSimulationState();
resizeCanvas(canvas, ctx);
const SIM_MINUTES_PER_REAL_SECOND = 15; // At 1x speed, 1 real second = 15 sim minutes

// ===== INITIALIZATION =====
function initializeGrids(): void {
    initializeEnvironment(state);
    initializeSoilMoisture(state);
    runSimulation(0);
}

function runSimulation(simDeltaTimeMinutes: number): void {
    if (!ctx) return;

    const {
        month,
        windSpeed,
        windDir,
        windGustiness,
        baseTemperatureOffset,
        humidityTarget,
        seasonalIntensity,
        seasonalShift,
        enableAdvection,
        enableDiffusion,
        enableInversions,
        enableDownslope,
        enableClouds,
    } = readSimulationControls();

    const climateOverrides = {
        baseTemperatureOffset,
        humidityTarget,
        seasonalIntensity,
        seasonalShift,
    };

    const totalMinutesInDay = 24 * 60;
    const normalizedTime = ((state.simulationTime % totalMinutesInDay) + totalMinutesInDay) % totalMinutesInDay;
    const currentHour = Math.floor(normalizedTime / 60);
    const currentMinute = Math.floor(normalizedTime % 60);

    updateSimulationClock(state.simulationTime);
    updateTimeOfDayControl(state.simulationTime);

    const timeOfDay = currentHour + currentMinute / 60;
    const monthValue = toMonthValue(month) + seasonalShift;
    const daylightHours = getDaylightHoursFromMonthValue(monthValue);
    const sunriseHour = 12 - daylightHours / 2;
    const sunsetHour = sunriseHour + daylightHours;
    let sunAltitude = 0;

    if (daylightHours > 0 && timeOfDay >= sunriseHour && timeOfDay <= sunsetHour) {
        const dayProgress = (timeOfDay - sunriseHour) / daylightHours;
        sunAltitude = Math.sin(dayProgress * Math.PI);
    }

    sunAltitude = Math.max(0, sunAltitude);
    const timeFactor = simDeltaTimeMinutes / 60;

    resetGrid(state.latentHeatEffect, 0);

    if (enableDownslope) {
        calculateDownslopeWinds(state, currentHour, windSpeed, windDir, windGustiness);
    } else {
        resetGrid(state.downSlopeWinds, 0);
        resetGrid(state.foehnEffect, 0);
        const getVegetationDrag = createVegetationDragGetter(state);
        applyBaseWindField(state, windSpeed, windDir, getVegetationDrag);
    }

    if (enableAdvection && timeFactor > 0) {
        const diurnalHour = Number.isFinite(timeOfDay) ? timeOfDay : currentHour;
        const baseTemperature = calculateBaseTemperature(month, diurnalHour, climateOverrides);
        const temperatureBaseline = state.elevation.map((row, y) =>
            row.map(elev => {
                const elevationDelta = (elev - BASE_ELEVATION) / 100;
                return baseTemperature - elevationDelta * LAPSE_RATE;
            })
        );
        const temperatureAnomaly = state.temperature.map((row, y) =>
            row.map((value, x) => value - temperatureBaseline[y][x])
        );
        const advectedAnomaly = advectGrid(temperatureAnomaly, state.windVectorField, timeFactor);
        state.temperature = temperatureBaseline.map((row, y) =>
            row.map((baseline, x) => advectedAnomaly[y][x] + baseline)
        );
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
            climate: climateOverrides,
        });
    } else {
        resetGrid(state.cloudCoverage, 0);
        resetGrid(state.cloudWater, 0);
        resetGrid(state.cloudOpticalDepth, 0);
        resetGrid(state.cloudBase, 0);
        resetGrid(state.cloudTop, 0);
        resetGrid(state.cloudType, CLOUD_TYPES.NONE);
        resetGrid(state.precipitation, 0);
        resetGrid(state.precipitationType, PRECIP_TYPES.NONE);
        resetGrid(state.thermalStrength, 0);
        resetGrid(state.convectiveEnergy, 0);
        resetGrid(state.iceContent, 0);
    }

    if (enableInversions) {
        const totalCloudCover =
            state.cloudCoverage.flat().reduce((a, b) => a + b, 0) / (GRID_SIZE * GRID_SIZE);
        calculateInversionLayer(state, currentHour, windSpeed, totalCloudCover);
    } else {
        state.inversionHeight = 0;
        state.inversionStrength = 0;
    }

    updateFogSimulation(state, currentHour, sunAltitude, timeFactor);

    updateThermodynamics(state, {
        month,
        hour: currentHour,
        timeOfDay,
        sunAltitude,
        timeFactor,
        enableDiffusion,
        enableInversions,
        enableDownslope,
        climate: climateOverrides,
    });

    const metrics = calculateSimulationMetrics(state);
    updateMetricsDisplay(metrics);
    updateInversionDisplay(state, enableInversions);

    drawSimulation(ctx, state, readVisualizationToggles());
}

// ===== SIMULATION LOOP =====
function simulationLoop(currentTime: number) {
    const deltaTime = (currentTime - state.lastFrameTime) / 1000;
    state.lastFrameTime = currentTime;

    if (state.isSimulating) {
        const simDeltaTimeMinutes =
            deltaTime * SIM_MINUTES_PER_REAL_SECOND * state.simulationSpeed;
        state.simulationTime += simDeltaTimeMinutes;
        runSimulation(simDeltaTimeMinutes);
    }

    requestAnimationFrame(simulationLoop);
}

// ===== INITIALIZATION =====
const eventCallbacks: SimulationEventCallbacks = {
    runSimulationFrame: () => runSimulation(0),
    redraw: () => drawSimulation(ctx, state, readVisualizationToggles()),
    initializeGrids,
    seekToTimeOfDay: targetMinutes => {
        const totalMinutesInDay = 24 * 60;
        const normalizedTarget = ((targetMinutes % totalMinutesInDay) + totalMinutesInDay) % totalMinutesInDay;
        const currentNormalized = ((state.simulationTime % totalMinutesInDay) + totalMinutesInDay) % totalMinutesInDay;
        let deltaMinutes = normalizedTarget - currentNormalized;
        if (deltaMinutes < 0) {
            deltaMinutes += totalMinutesInDay;
        }

        state.simulationTime += deltaMinutes;
        runSimulation(deltaMinutes);
    },
};

setupEventListeners(state, canvas, tooltip, eventCallbacks);

const handleResize = () => {
    resizeCanvas(canvas, ctx);
    drawSimulation(ctx, state, readVisualizationToggles());
};

window.addEventListener('resize', handleResize);
initializeGrids();
requestAnimationFrame(simulationLoop); // Start the main loop
