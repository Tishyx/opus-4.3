import { CELL_SIZE } from '../shared/constants';
import { LAND_TYPES } from '../shared/types';
import { calculateContiguousAreas, calculateDistanceFields, calculateHillshade } from '../simulation/environment';
import { initializeSoilMoisture } from '../simulation/soil';
import type { SimulationState } from '../simulation/state';
import { clamp, describeSurface, distance, isInBounds, resolveLandType, resolveSoilType } from '../simulation/utils';
import { initializeControlReadouts, resetPlayButton, updatePlayButton } from './controls';

export type SimulationEventCallbacks = {
    runSimulationFrame: () => void;
    redraw: () => void;
    initializeGrids: () => void;
};

function showTooltip(
    tooltip: HTMLElement,
    event: MouseEvent,
    state: SimulationState,
    x: number,
    y: number
): void {
    const land = Object.keys(LAND_TYPES).find(
        key => LAND_TYPES[key as keyof typeof LAND_TYPES] === state.landCover[y][x]
    );
    const surface = describeSurface(state, x, y);
    tooltip.style.display = 'block';
    tooltip.style.left = `${event.clientX + 15}px`;
    tooltip.style.top = `${event.clientY}px`;
    tooltip.innerHTML = `
        <strong>Coords:</strong> ${x}, ${y}<br>
        <strong>Air Temp:</strong> ${state.temperature[y][x].toFixed(1)}°C<br>
        <strong>Surface Temp:</strong> ${state.soilTemperature[y][x].toFixed(1)}°C<br>
        <strong>Elevation:</strong> ${state.elevation[y][x].toFixed(0)}m<br>
        <strong>Land:</strong> ${land ?? 'Unknown'}<br>
        <strong>Surface:</strong> ${surface}<br>
        <strong>Humidity:</strong> ${(state.humidity[y][x] * 100).toFixed(0)}%<br>
        <strong>Cloud:</strong> ${(state.cloudCoverage[y][x] * 100).toFixed(0)}%<br>
        <strong>Wind:</strong> ${state.windVectorField[y][x].speed.toFixed(1)} km/h<br>
        <strong>Snow:</strong> ${state.snowDepth[y][x].toFixed(1)}cm
    `;
}

function hideTooltip(tooltip: HTMLElement): void {
    tooltip.style.display = 'none';
}

function applyBrushEffects(state: SimulationState, x: number, y: number): boolean {
    let requiresRecalculation = false;

    for (let iy = y - state.brushSize; iy <= y + state.brushSize; iy++) {
        for (let ix = x - state.brushSize; ix <= x + state.brushSize; ix++) {
            if (!isInBounds(ix, iy) || distance(ix, iy, x, y) > state.brushSize) continue;

            const power = 1 - distance(ix, iy, x, y) / state.brushSize;

            if (state.currentBrushCategory === 'terrain') {
                const delta = (state.isRightClick ? -state.terrainStrength : state.terrainStrength) * power;
                state.elevation[iy][ix] = clamp(state.elevation[iy][ix] + delta, 0, 1000);
                requiresRecalculation = true;
            } else if (state.currentBrushCategory === 'land') {
                const landType = resolveLandType(state.currentBrush);
                if (landType !== undefined) {
                    state.landCover[iy][ix] = landType;
                    requiresRecalculation = true;
                }
            } else if (state.currentBrushCategory === 'soil') {
                const soilType = resolveSoilType(state.currentBrush);
                if (soilType !== undefined) {
                    state.soilType[iy][ix] = soilType;
                    requiresRecalculation = true;
                }
            } else if (state.currentBrushCategory === 'action' && state.currentBrush === 'manualPrecipitation') {
                const effectAmount = 0.8 * power;
                const currentTemp = state.temperature[iy][ix];
                if (currentTemp > -5) {
                    const liquid = effectAmount * 0.5;
                    const cooling = 1.5 * power;
                    state.soilMoisture[iy][ix] = Math.min(1, state.soilMoisture[iy][ix] + liquid);
                    state.temperature[iy][ix] -= cooling;
                } else {
                    const snow = effectAmount * 5;
                    const warming = 0.5 * power;
                    state.snowDepth[iy][ix] += snow;
                    state.temperature[iy][ix] += warming;
                }
            }
        }
    }

    return requiresRecalculation;
}

function handleBrush(state: SimulationState, x: number, y: number, callbacks: SimulationEventCallbacks): void {
    const requiresRecalculation = applyBrushEffects(state, x, y);

    if (requiresRecalculation) {
        if (state.currentBrushCategory === 'terrain') {
            calculateHillshade(state);
        } else {
            calculateContiguousAreas(state);
            calculateDistanceFields(state);
            initializeSoilMoisture(state);
        }
    }

    callbacks.runSimulationFrame();
}

function bindBrushButtons(state: SimulationState): void {
    document.querySelectorAll('.brush-btn').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelector('.brush-btn.active')?.classList.remove('active');
            button.classList.add('active');
            state.currentBrush = button.getAttribute('data-brush') ?? state.currentBrush;
            state.currentBrushCategory = button.getAttribute('data-category') ?? state.currentBrushCategory;

            const terrainStrengthGroup = document.getElementById('terrainStrengthGroup');
            if (terrainStrengthGroup) {
                terrainStrengthGroup.style.display = state.currentBrushCategory === 'terrain' ? 'block' : 'none';
            }
        });
    });
}

function bindBrushCategorySwitch(state: SimulationState): void {
    document.getElementById('brushCategory')?.addEventListener('change', event => {
        const category = (event.target as HTMLSelectElement).value;
        const terrainBrushes = document.getElementById('terrainBrushes');
        const soilBrushes = document.getElementById('soilBrushes');
        const terrainStrengthGroup = document.getElementById('terrainStrengthGroup');

        if (category === 'terrain') {
            if (terrainBrushes) terrainBrushes.style.display = 'block';
            if (soilBrushes) soilBrushes.style.display = 'none';
            const firstBrush = document.querySelector('#terrainBrushes .brush-btn') as HTMLElement | null;
            firstBrush?.click();
        } else {
            if (terrainBrushes) terrainBrushes.style.display = 'none';
            if (soilBrushes) soilBrushes.style.display = 'block';
            if (terrainStrengthGroup) terrainStrengthGroup.style.display = 'none';
            const firstBrush = document.querySelector('#soilBrushes .brush-btn') as HTMLElement | null;
            firstBrush?.click();
        }
    });
}

function bindControlSynchronizers(state: SimulationState, callbacks: SimulationEventCallbacks): void {
    document.getElementById('month')?.addEventListener('change', callbacks.runSimulationFrame);
    document.getElementById('windDirection')?.addEventListener('change', callbacks.runSimulationFrame);

    const heatmapPaletteSelect = document.getElementById('heatmapPalette') as HTMLSelectElement | null;
    const showHeatmapCheckbox = document.getElementById('showHeatmap') as HTMLInputElement | null;
    const syncHeatmapPaletteState = () => {
        if (!heatmapPaletteSelect || !showHeatmapCheckbox) return;
        heatmapPaletteSelect.disabled = !showHeatmapCheckbox.checked;
    };
    syncHeatmapPaletteState();

    document.getElementById('windSpeed')?.addEventListener('input', event => {
        const value = (event.target as HTMLInputElement).value;
        const label = document.getElementById('windSpeedValue');
        if (label) label.textContent = value;
        callbacks.runSimulationFrame();
    });

    document.getElementById('windGustiness')?.addEventListener('input', event => {
        const value = (event.target as HTMLInputElement).value;
        const label = document.getElementById('windGustinessValue');
        if (label) label.textContent = value;
        callbacks.runSimulationFrame();
    });

    document.querySelectorAll('.controls input[type="checkbox"]').forEach(element => {
        element.addEventListener('change', () => {
            const checkbox = element as HTMLInputElement;
            if (checkbox.id === 'showHeatmap') {
                syncHeatmapPaletteState();
            }
            if (checkbox.id.startsWith('show')) {
                callbacks.redraw();
            } else {
                callbacks.runSimulationFrame();
            }
        });
    });

    document.getElementById('heatmapPalette')?.addEventListener('change', callbacks.redraw);

    document.getElementById('brushSize')?.addEventListener('input', event => {
        const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
        const label = document.getElementById('brushSizeValue');
        if (label) label.textContent = value.toString();
        state.brushSize = value;
    });

    document.getElementById('terrainStrength')?.addEventListener('input', event => {
        const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
        const label = document.getElementById('terrainStrengthValue');
        if (label) label.textContent = value.toString();
        state.terrainStrength = value;
    });
}

function bindSimulationControls(state: SimulationState, callbacks: SimulationEventCallbacks): void {
    const playPauseButton = document.getElementById('playPauseBtn') as HTMLButtonElement | null;
    playPauseButton?.addEventListener('click', () => {
        state.isSimulating = !state.isSimulating;
        updatePlayButton(state.isSimulating);
        if (state.isSimulating) {
            state.lastFrameTime = performance.now();
        }
    });

    document.getElementById('createScenarioBtn')?.addEventListener('click', () => {
        state.isSimulating = false;
        resetPlayButton();
        state.simulationTime = 6 * 60;
        callbacks.runSimulationFrame();
    });

    document.getElementById('resetBtn')?.addEventListener('click', () => {
        state.isSimulating = false;
        resetPlayButton();
        state.simulationTime = 6 * 60;
        callbacks.initializeGrids();
    });

    document.getElementById('simSpeed')?.addEventListener('input', event => {
        const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
        const label = document.getElementById('speedValue');
        if (label) label.textContent = `${value}x`;
        state.simulationSpeed = value;
    });
}

export function setupEventListeners(
    state: SimulationState,
    canvas: HTMLCanvasElement,
    tooltip: HTMLElement,
    callbacks: SimulationEventCallbacks
): void {
    initializeControlReadouts();
    bindBrushButtons(state);
    bindBrushCategorySwitch(state);
    bindControlSynchronizers(state, callbacks);
    bindSimulationControls(state, callbacks);

    canvas.addEventListener('mousedown', event => {
        state.isDrawing = true;
        state.isRightClick = event.button === 2;
        const rect = canvas.getBoundingClientRect();
        const gridX = Math.floor((event.clientX - rect.left) / CELL_SIZE);
        const gridY = Math.floor((event.clientY - rect.top) / CELL_SIZE);
        if (isInBounds(gridX, gridY)) {
            handleBrush(state, gridX, gridY, callbacks);
        }
        event.preventDefault();
    });

    canvas.addEventListener('mouseup', () => {
        state.isDrawing = false;
    });

    canvas.addEventListener('mouseleave', () => {
        state.isDrawing = false;
        hideTooltip(tooltip);
    });

    canvas.addEventListener('mousemove', event => {
        const rect = canvas.getBoundingClientRect();
        const gridX = Math.floor((event.clientX - rect.left) / CELL_SIZE);
        const gridY = Math.floor((event.clientY - rect.top) / CELL_SIZE);

        if (isInBounds(gridX, gridY)) {
            showTooltip(tooltip, event, state, gridX, gridY);
            if (state.isDrawing) {
                handleBrush(state, gridX, gridY, callbacks);
            }
        } else {
            hideTooltip(tooltip);
        }
    });

    canvas.addEventListener('contextmenu', event => event.preventDefault());

    callbacks.redraw();
}
