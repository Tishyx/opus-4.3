import { CELL_SIZE } from '../shared/constants';
import { LAND_TYPES, SOIL_TYPES } from '../shared/types';
import { calculateContiguousAreas, calculateDistanceFields, calculateHillshade } from '../simulation/environment';
import { initializeSoilMoisture } from '../simulation/soil';
import type { SimulationState } from '../simulation/state';
import { clamp, describeSurface, distance, isInBounds, resolveLandType, resolveSoilType } from '../simulation/utils';
import { initializeControlReadouts, resetPlayButton, updatePlayButton } from './controls';
import { CLOUD_TYPES, PRECIP_TYPES } from '../simulation/weatherTypes';

export type SimulationEventCallbacks = {
    runSimulationFrame: () => void;
    redraw: () => void;
    initializeGrids: () => void;
};

function toTitleCase(identifier: string): string {
    return identifier
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ');
}

function createTypeLabels<T extends Record<string, number>>(types: T): Record<number, string> {
    return Object.fromEntries(
        Object.entries(types).map(([key, value]) => [value, toTitleCase(key)])
    );
}

const LAND_TYPE_LABELS = createTypeLabels(LAND_TYPES);
const SOIL_TYPE_LABELS = createTypeLabels(SOIL_TYPES);
const CLOUD_TYPE_LABELS = createTypeLabels(CLOUD_TYPES);
const PRECIP_TYPE_LABELS = createTypeLabels(PRECIP_TYPES);

function getLabel(map: Record<number, string>, value: number | undefined, fallback: string): string {
    if (value === undefined) return fallback;
    return map[value] ?? fallback;
}

function sanitizeFractionDigits(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.floor(value));
}

function formatPercentage(value: number, fractionDigits = 0): string {
    const safeValue = Number.isFinite(value) ? value : 0;
    const safeDigits = sanitizeFractionDigits(fractionDigits);
    const clamped = clamp(safeValue, 0, 1);
    return `${(clamped * 100).toFixed(safeDigits)}%`;
}

function formatWindDirection(xComponent: number, yComponent: number): string | null {
    if (!Number.isFinite(xComponent) || !Number.isFinite(yComponent)) {
        return null;
    }

    const magnitude = Math.hypot(xComponent, yComponent);
    if (!Number.isFinite(magnitude) || magnitude < 0.01) {
        return null;
    }

    const angle = (Math.atan2(-yComponent, xComponent) * 180) / Math.PI;
    const normalized = (angle + 360) % 360;
    const directions = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    const index = Math.round(normalized / 45) % directions.length;
    return `${directions[index]} (${normalized.toFixed(0)}°)`;
}

function formatCloudHeights(base: number, top: number): string {
    const safeBase = Number.isFinite(base) ? base : 0;
    const safeTop = Number.isFinite(top) ? top : 0;

    if (safeBase <= 0 && safeTop <= 0) {
        return 'None';
    }
    if (safeTop <= safeBase) {
        return `${safeBase.toFixed(0)} m`;
    }
    return `${safeBase.toFixed(0)} - ${safeTop.toFixed(0)} m`;
}

function showTooltip(
    tooltip: HTMLElement,
    event: MouseEvent,
    state: SimulationState,
    x: number,
    y: number
): void {
    const land = getLabel(LAND_TYPE_LABELS, state.landCover[y]?.[x], 'Unknown');
    const soil = getLabel(SOIL_TYPE_LABELS, state.soilType[y]?.[x], 'Unknown');
    const surface = describeSurface(state, x, y);
    const dewPoint = state.dewPoint[y]?.[x];
    const soilMoisture = state.soilMoisture[y]?.[x];
    const fogDensity = state.fogDensity[y]?.[x];
    const cloudCoverage = state.cloudCoverage[y]?.[x];
    const cloudBase = state.cloudBase[y]?.[x];
    const cloudTop = state.cloudTop[y]?.[x];
    const cloudType = getLabel(CLOUD_TYPE_LABELS, state.cloudType[y]?.[x], 'None');
    const precipitationType = getLabel(
        PRECIP_TYPE_LABELS,
        state.precipitationType[y]?.[x],
        'None'
    );
    const precipitation = state.precipitation[y]?.[x];
    const wind = state.windVectorField[y]?.[x];
    const windDirection = wind ? formatWindDirection(wind.x, wind.y) : null;

    const lines: string[] = [];
    lines.push(`<strong>Coords:</strong> ${x}, ${y}`);
    lines.push(`<strong>Land:</strong> ${land}`);
    lines.push(`<strong>Surface:</strong> ${surface}`);
    lines.push(`<strong>Soil:</strong> ${soil}`);
    lines.push(`<strong>Elevation:</strong> ${state.elevation[y][x].toFixed(0)} m`);
    lines.push(`<strong>Air Temp:</strong> ${state.temperature[y][x].toFixed(1)}°C`);
    lines.push(`<strong>Surface Temp:</strong> ${state.soilTemperature[y][x].toFixed(1)}°C`);
    if (dewPoint !== undefined) {
        lines.push(`<strong>Dew Point:</strong> ${dewPoint.toFixed(1)}°C`);
    }
    lines.push(`<strong>Humidity:</strong> ${formatPercentage(state.humidity[y][x])}`);
    if (soilMoisture !== undefined) {
        lines.push(`<strong>Soil Moisture:</strong> ${formatPercentage(soilMoisture)}`);
    }
    if (fogDensity !== undefined && fogDensity > 0) {
        lines.push(`<strong>Fog Density:</strong> ${formatPercentage(fogDensity, 1)}`);
    }
    if (wind) {
        const directionSuffix = windDirection ? ` (${windDirection})` : '';
        lines.push(`<strong>Wind:</strong> ${wind.speed.toFixed(1)} km/h${directionSuffix}`);
    }
    if (cloudCoverage !== undefined) {
        lines.push(`<strong>Cloud Cover:</strong> ${formatPercentage(cloudCoverage)}`);
    }
    if (cloudBase !== undefined && cloudTop !== undefined) {
        lines.push(`<strong>Cloud Height:</strong> ${formatCloudHeights(cloudBase, cloudTop)}`);
    }
    lines.push(`<strong>Cloud Type:</strong> ${cloudType}`);
    if (state.cloudOpticalDepth[y]?.[x] !== undefined) {
        lines.push(
            `<strong>Cloud Optical Depth:</strong> ${state.cloudOpticalDepth[y][x].toFixed(1)}`
        );
    }
    if (precipitation !== undefined) {
        lines.push(
            `<strong>Precipitation:</strong> ${precipitation.toFixed(2)} mm/hr (${precipitationType})`
        );
    }
    lines.push(`<strong>Snow:</strong> ${state.snowDepth[y][x].toFixed(1)} cm`);

    tooltip.style.display = 'block';
    tooltip.style.left = `${event.clientX + 15}px`;
    tooltip.style.top = `${event.clientY}px`;
    tooltip.innerHTML = lines.join('<br>');
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
