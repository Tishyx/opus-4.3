import { GRID_SIZE } from './src/shared/constants';
import {
    createSimulationState,
    resetGrid,
    resetVectorField,
    resizeCanvas,
    type SimulationState,
} from './src/simulation/state';
import { initializeEnvironment } from './src/simulation/environment';
import { updateCloudDynamics } from './src/simulation/clouds';
import { advectGrid, calculateDownslopeWinds } from './src/simulation/wind';
import { updateFogSimulation } from './src/simulation/fog';
import { initializeSoilMoisture } from './src/simulation/soil';
import {
    calculateInversionLayer,
    calculateSimulationMetrics,
    updateThermodynamics,
} from './src/simulation/physics';
import {
    readSimulationControls,
    readVisualizationToggles,
    updateInversionDisplay,
    updateMetricsDisplay,
    updateSimulationClock,
} from './src/ui/controls';
import { drawSimulation } from './src/ui/rendering';
import { setupEventListeners, type SimulationEventCallbacks } from './src/ui/events';

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

    const {
        month,
        windSpeed,
        windDir,
        windGustiness,
        enableAdvection,
        enableDiffusion,
        enableInversions,
        enableDownslope,
        enableClouds,
    } = readSimulationControls();

    const totalMinutesInDay = 24 * 60;
    const normalizedTime = state.simulationTime % totalMinutesInDay;
    const currentHour = Math.floor(normalizedTime / 60);
    const currentMinute = Math.floor(normalizedTime % 60);

    updateSimulationClock(state.simulationTime);

    const sunAltitude = Math.max(0, Math.sin(((currentHour + currentMinute / 60) - 6) * Math.PI / 12));
    const timeFactor = simDeltaTimeMinutes / 60;

    resetGrid(state.latentHeatEffect, 0);

    if (enableDownslope) {
        calculateDownslopeWinds(state, currentHour, windSpeed, windDir, windGustiness);
    } else {
        resetGrid(state.downSlopeWinds, 0);
        resetVectorField(state.windVectorField);
        resetGrid(state.foehnEffect, 0);
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
        resetGrid(state.cloudCoverage, 0);
        resetGrid(state.cloudWater, 0);
        resetGrid(state.cloudOpticalDepth, 0);
        resetGrid(state.cloudBase, 0);
        resetGrid(state.cloudTop, 0);
        resetGrid(state.cloudType, 0);
        resetGrid(state.precipitation, 0);
        resetGrid(state.precipitationType, 0);
        resetGrid(state.thermalStrength, 0);
        resetGrid(state.convectiveEnergy, 0);
        resetGrid(state.iceContent, 0);
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
    updateMetricsDisplay(metrics);
    updateInversionDisplay(state, enableInversions);

    drawSimulation(ctx, state, readVisualizationToggles());
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
const eventCallbacks: SimulationEventCallbacks = {
    runSimulationFrame: () => runSimulation(0),
    redraw: () => drawSimulation(ctx, state, readVisualizationToggles()),
    initializeGrids,
};

setupEventListeners(state, canvas, tooltip, eventCallbacks);
initializeGrids();
requestAnimationFrame(simulationLoop); // Start the main loop
