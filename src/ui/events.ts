import { CELL_SIZE, GRID_SIZE } from '../shared/constants';
import { LAND_TYPES, SOIL_TYPES } from '../shared/types';
import { calculateContiguousAreas, calculateDistanceFields, calculateHillshade } from '../simulation/environment';
import { initializeSoilMoisture } from '../simulation/soil';
import type { SimulationState } from '../simulation/state';
import { clamp, describeSurface, distance, isInBounds, resolveLandType, resolveSoilType } from '../simulation/utils';
import {
    initializeControlReadouts,
    readVisualizationToggles,
    resetPlayButton,
    updatePlayButton,
    updateTimeOfDayControl,
} from './controls';
import type { HeatmapVariable } from './controls';
import { CLOUD_TYPES, PRECIP_TYPES } from '../simulation/weatherTypes';

export type SimulationEventCallbacks = {
    runSimulationFrame: () => void;
    redraw: () => void;
    initializeGrids: () => void;
    seekToTimeOfDay: (targetMinutes: number) => void;
};

type GridCoordinates = { x: number; y: number };

function getGridCoordinatesFromMouseEvent(
    canvas: HTMLCanvasElement,
    event: MouseEvent
): GridCoordinates | null {
    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
        return null;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    if (!Number.isFinite(canvasX) || !Number.isFinite(canvasY)) {
        return null;
    }

    return {
        x: clamp(Math.floor(canvasX / CELL_SIZE), 0, GRID_SIZE - 1),
        y: clamp(Math.floor(canvasY / CELL_SIZE), 0, GRID_SIZE - 1),
    };
}

function toTitleCase(identifier: string): string {
    return identifier
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ');
}

function annotateHeatmapLabel(label: string, variable: HeatmapVariable, target: HeatmapVariable): string {
    return variable === target ? `${label} (Heatmap)` : label;
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

type CellDetail = { label: string; value: string };

const INSPECTOR_PLACEHOLDER_HTML = `
    <h3 class="inspector-title">Selected Cell</h3>
    <p class="inspector-placeholder">Click or focus a cell to see detailed terrain and weather information.</p>
`.trim();

const INSPECTOR_INVALIDATING_CHECKBOXES = new Set([
    'enableAdvection',
    'enableDiffusion',
    'enableInversions',
    'enableDownslope',
    'enableClouds',
    'showHeatmap',
    'showSoilTypes',
    'showHillshade',
    'showFog',
    'showWindFlow',
    'showClouds',
    'showPrecipitation',
    'showHumidity',
    'showSnowCover',
]);

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

function collectCellDetails(state: SimulationState, x: number, y: number): CellDetail[] {
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
    const { heatmapVariable } = readVisualizationToggles();

    const details: CellDetail[] = [];
    details.push({ label: 'Coords', value: `${x}, ${y}` });
    details.push({ label: 'Land', value: land });
    details.push({ label: 'Surface', value: surface });
    details.push({ label: 'Soil', value: soil });
    details.push({ label: 'Elevation', value: `${state.elevation[y][x].toFixed(0)} m` });
    details.push({
        label: annotateHeatmapLabel('Air Temp', heatmapVariable, 'airTemperature'),
        value: `${state.temperature[y][x].toFixed(1)}°C`,
    });
    details.push({
        label: annotateHeatmapLabel('Surface Temp', heatmapVariable, 'soilTemperature'),
        value: `${state.soilTemperature[y][x].toFixed(1)}°C`,
    });
    if (dewPoint !== undefined) {
        details.push({
            label: annotateHeatmapLabel('Dew Point', heatmapVariable, 'dewPoint'),
            value: `${dewPoint.toFixed(1)}°C`,
        });
    }
    details.push({
        label: annotateHeatmapLabel('Humidity', heatmapVariable, 'humidity'),
        value: formatPercentage(state.humidity[y][x]),
    });
    if (soilMoisture !== undefined) {
        details.push({
            label: annotateHeatmapLabel('Soil Moisture', heatmapVariable, 'soilMoisture'),
            value: formatPercentage(soilMoisture),
        });
    }
    if (fogDensity !== undefined && fogDensity > 0) {
        details.push({ label: 'Fog Density', value: formatPercentage(fogDensity, 1) });
    }
    if (wind) {
        const directionSuffix = windDirection ? ` (${windDirection})` : '';
        details.push({ label: 'Wind', value: `${wind.speed.toFixed(1)} km/h${directionSuffix}` });
    }
    if (cloudCoverage !== undefined) {
        details.push({ label: 'Cloud Cover', value: formatPercentage(cloudCoverage) });
    }
    if (cloudBase !== undefined && cloudTop !== undefined) {
        details.push({ label: 'Cloud Height', value: formatCloudHeights(cloudBase, cloudTop) });
    }
    details.push({ label: 'Cloud Type', value: cloudType });
    if (state.cloudOpticalDepth[y]?.[x] !== undefined) {
        details.push({
            label: 'Cloud Optical Depth',
            value: `${state.cloudOpticalDepth[y][x].toFixed(1)}`,
        });
    }
    if (precipitation !== undefined) {
        details.push({
            label: 'Precipitation',
            value: `${precipitation.toFixed(2)} mm/hr (${precipitationType})`,
        });
    }
    details.push({
        label: annotateHeatmapLabel('Snow', heatmapVariable, 'snowDepth'),
        value: `${state.snowDepth[y][x].toFixed(1)} cm`,
    });

    return details;
}

function renderTooltipContent(details: CellDetail[]): string {
    return details
        .map(detail => `<strong>${detail.label}:</strong> ${detail.value}`)
        .join('<br>');
}

function renderInspectorContent(details: CellDetail[]): string {
    const rows = details
        .map(
            detail =>
                `<div class="inspector-row"><dt>${detail.label}</dt><dd>${detail.value}</dd></div>`
        )
        .join('');

    return `
        <h3 class="inspector-title">Selected Cell</h3>
        <dl class="inspector-list">${rows}</dl>
    `;
}

function applyInspectorContent(
    inspector: HTMLElement | null,
    details: CellDetail[] | null
): void {
    if (!inspector) return;

    if (!details || details.length === 0) {
        inspector.innerHTML = INSPECTOR_PLACEHOLDER_HTML;
        inspector.classList.remove('has-selection');
        return;
    }

    inspector.innerHTML = renderInspectorContent(details);
    inspector.classList.add('has-selection');
}

function updateSelectedCell(
    state: SimulationState,
    x: number,
    y: number,
    inspector: HTMLElement | null
): void {
    const details = collectCellDetails(state, x, y);
    const tooltipContent = renderTooltipContent(details);

    state.selectedCellX = x;
    state.selectedCellY = y;
    state.selectedCellTooltipHtml = tooltipContent;

    applyInspectorContent(inspector, details);
}

function clearSelectedCell(state: SimulationState, inspector: HTMLElement | null): void {
    state.selectedCellX = null;
    state.selectedCellY = null;
    state.selectedCellTooltipHtml = null;
    applyInspectorContent(inspector, null);
}

function showTooltip(
    canvas: HTMLCanvasElement,
    tooltip: HTMLElement,
    event: MouseEvent,
    state: SimulationState,
    x: number,
    y: number
): void {
    const details = collectCellDetails(state, x, y);
    const content = renderTooltipContent(details);

    tooltip.style.display = 'block';
    const offsetParent = (tooltip.offsetParent as HTMLElement | null) ?? canvas.parentElement;
    const parentRect = offsetParent?.getBoundingClientRect();
    const left = parentRect ? event.clientX - parentRect.left : event.clientX;
    const top = parentRect ? event.clientY - parentRect.top : event.clientY;
    tooltip.style.left = `${left + 15}px`;
    tooltip.style.top = `${top}px`;
    tooltip.innerHTML = content;

    if (state.selectedCellX === x && state.selectedCellY === y) {
        state.selectedCellTooltipHtml = content;
    }
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

function handleBrush(
    state: SimulationState,
    x: number,
    y: number,
    callbacks: SimulationEventCallbacks,
    onStateUpdated: () => void
): void {
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
    onStateUpdated();
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

function bindControlSynchronizers(
    state: SimulationState,
    callbacks: SimulationEventCallbacks,
    onDataLayerChanged: () => void,
    onStateUpdated: () => void
): void {
    document.getElementById('month')?.addEventListener('change', () => {
        callbacks.runSimulationFrame();
        onStateUpdated();
    });
    document.getElementById('seasonalIntensity')?.addEventListener('input', event => {
        const value = Number.parseFloat((event.target as HTMLInputElement).value);
        const label = document.getElementById('seasonalIntensityValue');
        if (label) {
            label.textContent = Number.isFinite(value) ? value.toFixed(0) : '100';
        }
        callbacks.runSimulationFrame();
        onStateUpdated();
    });
    document.getElementById('seasonalShift')?.addEventListener('input', event => {
        const value = Number.parseFloat((event.target as HTMLInputElement).value);
        const label = document.getElementById('seasonalShiftValue');
        if (label) {
            const formatted = Number.isFinite(value) ? value.toFixed(2) : '0.00';
            const trimmed = formatted.replace(/\.00$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
            label.textContent = value > 0 ? `+${trimmed}` : trimmed;
        }
        callbacks.runSimulationFrame();
        onStateUpdated();
    });
    document.getElementById('baseTemperatureOffset')?.addEventListener('input', event => {
        const value = Number.parseFloat((event.target as HTMLInputElement).value);
        const label = document.getElementById('baseTemperatureOffsetValue');
        if (label) {
            label.textContent = Number.isFinite(value) ? value.toFixed(1) : '0.0';
        }
        callbacks.runSimulationFrame();
        onStateUpdated();
    });
    document.getElementById('humidityTarget')?.addEventListener('input', event => {
        const value = Number.parseFloat((event.target as HTMLInputElement).value);
        const label = document.getElementById('humidityTargetValue');
        if (label) {
            label.textContent = Number.isFinite(value) ? value.toFixed(0) : '60';
        }
        callbacks.runSimulationFrame();
        onStateUpdated();
    });
    document.getElementById('windDirection')?.addEventListener('change', () => {
        callbacks.runSimulationFrame();
        onStateUpdated();
    });

    const heatmapPaletteSelect = document.getElementById('heatmapPalette') as HTMLSelectElement | null;
    const heatmapVariableSelect = document.getElementById('heatmapVariable') as HTMLSelectElement | null;
    const showHeatmapCheckbox = document.getElementById('showHeatmap') as HTMLInputElement | null;
    const syncHeatmapControlsState = () => {
        if (!showHeatmapCheckbox) return;
        const disabled = !showHeatmapCheckbox.checked;
        if (heatmapPaletteSelect) heatmapPaletteSelect.disabled = disabled;
        if (heatmapVariableSelect) heatmapVariableSelect.disabled = disabled;
    };
    syncHeatmapControlsState();

    document.getElementById('windSpeed')?.addEventListener('input', event => {
        const value = (event.target as HTMLInputElement).value;
        const label = document.getElementById('windSpeedValue');
        if (label) label.textContent = value;
        callbacks.runSimulationFrame();
        onStateUpdated();
    });

    document.getElementById('windGustiness')?.addEventListener('input', event => {
        const value = (event.target as HTMLInputElement).value;
        const label = document.getElementById('windGustinessValue');
        if (label) label.textContent = value;
        callbacks.runSimulationFrame();
        onStateUpdated();
    });

    document.querySelectorAll('.controls input[type="checkbox"]').forEach(element => {
        element.addEventListener('change', () => {
            const checkbox = element as HTMLInputElement;
            if (checkbox.id === 'showHeatmap') {
                syncHeatmapControlsState();
            }
            const invalidates = INSPECTOR_INVALIDATING_CHECKBOXES.has(checkbox.id);

            if (checkbox.id.startsWith('show')) {
                callbacks.redraw();
            } else {
                callbacks.runSimulationFrame();
            }
            if (invalidates) {
                onDataLayerChanged();
            } else {
                onStateUpdated();
            }
        });
    });

    document.getElementById('heatmapPalette')?.addEventListener('change', callbacks.redraw);
    heatmapVariableSelect?.addEventListener('change', () => {
        callbacks.redraw();
        onStateUpdated();
    });

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

function bindSimulationControls(
    state: SimulationState,
    callbacks: SimulationEventCallbacks,
    onEnvironmentReset: () => void,
    onStateUpdated: () => void
): void {
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
        onEnvironmentReset();
        callbacks.initializeGrids();
    });

    document.getElementById('resetBtn')?.addEventListener('click', () => {
        state.isSimulating = false;
        resetPlayButton();
        state.simulationTime = 6 * 60;
        onEnvironmentReset();
        callbacks.initializeGrids();
    });

    document.getElementById('simSpeed')?.addEventListener('input', event => {
        const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
        const label = document.getElementById('speedValue');
        if (label) label.textContent = `${value}x`;
        state.simulationSpeed = value;
    });

    const timeSlider = document.getElementById('timeOfDay') as HTMLInputElement | null;
    timeSlider?.addEventListener('input', event => {
        const sliderMinutes = Number.parseInt((event.target as HTMLInputElement).value, 10);
        if (!Number.isFinite(sliderMinutes)) return;
        updateTimeOfDayControl(sliderMinutes);
    });

    timeSlider?.addEventListener('change', event => {
        const sliderMinutes = Number.parseInt((event.target as HTMLInputElement).value, 10);
        if (!Number.isFinite(sliderMinutes)) return;

        state.isSimulating = false;
        updatePlayButton(false);

        callbacks.seekToTimeOfDay(sliderMinutes);
        onStateUpdated();
    });
}

export function setupEventListeners(
    state: SimulationState,
    canvas: HTMLCanvasElement,
    tooltip: HTMLElement,
    callbacks: SimulationEventCallbacks
): void {
    const inspector = document.getElementById('cellInspector');
    const resetSelectedCell = () => clearSelectedCell(state, inspector);
    const refreshSelectedCell = () => {
        if (state.selectedCellX === null || state.selectedCellY === null) {
            return;
        }

        const x = state.selectedCellX;
        const y = state.selectedCellY;
        if (isInBounds(x, y)) {
            updateSelectedCell(state, x, y, inspector);
        } else {
            resetSelectedCell();
        }
    };

    applyInspectorContent(inspector, null);

    initializeControlReadouts();
    bindBrushButtons(state);
    bindBrushCategorySwitch(state);
    bindControlSynchronizers(state, callbacks, resetSelectedCell, refreshSelectedCell);
    bindSimulationControls(state, callbacks, resetSelectedCell, refreshSelectedCell);

    canvas.addEventListener('mousedown', event => {
        state.isDrawing = true;
        state.isRightClick = event.button === 2;
        const coordinates = getGridCoordinatesFromMouseEvent(canvas, event);
        if (coordinates && isInBounds(coordinates.x, coordinates.y)) {
            updateSelectedCell(state, coordinates.x, coordinates.y, inspector);
            handleBrush(state, coordinates.x, coordinates.y, callbacks, refreshSelectedCell);
        }
        canvas.focus();
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
        const coordinates = getGridCoordinatesFromMouseEvent(canvas, event);

        if (coordinates && isInBounds(coordinates.x, coordinates.y)) {
            showTooltip(canvas, tooltip, event, state, coordinates.x, coordinates.y);
            if (state.isDrawing) {
                handleBrush(state, coordinates.x, coordinates.y, callbacks, refreshSelectedCell);
            }
        } else {
            hideTooltip(tooltip);
        }
    });

    canvas.addEventListener('keydown', event => {
        let deltaX = 0;
        let deltaY = 0;
        switch (event.key) {
            case 'ArrowUp':
                deltaY = -1;
                break;
            case 'ArrowDown':
                deltaY = 1;
                break;
            case 'ArrowLeft':
                deltaX = -1;
                break;
            case 'ArrowRight':
                deltaX = 1;
                break;
            case 'Enter':
            case ' ':
                break;
            default:
                return;
        }

        event.preventDefault();

        const currentX = state.selectedCellX ?? Math.floor(GRID_SIZE / 2);
        const currentY = state.selectedCellY ?? Math.floor(GRID_SIZE / 2);
        const nextX = clamp(currentX + deltaX, 0, GRID_SIZE - 1);
        const nextY = clamp(currentY + deltaY, 0, GRID_SIZE - 1);

        updateSelectedCell(state, nextX, nextY, inspector);
    });

    canvas.addEventListener('contextmenu', event => event.preventDefault());

    callbacks.redraw();
}
