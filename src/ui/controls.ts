import type { SimulationState } from '../simulation/state';
import type { SimulationMetrics } from '../simulation/physics';

export type SimulationControls = {
    month: number;
    windSpeed: number;
    windDir: number;
    windGustiness: number;
    enableAdvection: boolean;
    enableDiffusion: boolean;
    enableInversions: boolean;
    enableDownslope: boolean;
    enableClouds: boolean;
};

const HEATMAP_PALETTE_OPTIONS = ['blue-red', 'green-yellow', 'purple-orange', 'teal-magenta'] as const;

export type HeatmapPalette = (typeof HEATMAP_PALETTE_OPTIONS)[number];

export type VisualizationToggles = {
    showSoil: boolean;
    showHillshade: boolean;
    showHeatmap: boolean;
    showClouds: boolean;
    showFog: boolean;
    showPrecipitation: boolean;
    showWind: boolean;
    showSnow: boolean;
    showHumidity: boolean;
    heatmapPalette: HeatmapPalette;
};

function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required DOM element: ${id}`);
    }
    return element as T;
}

function readNumericSelectValue(id: string): number {
    const select = getElement<HTMLSelectElement>(id);
    const parsed = Number.parseInt(select.value, 10);
    if (!Number.isNaN(parsed)) {
        return parsed;
    }

    for (const option of Array.from(select.options)) {
        const fallback = Number.parseInt(option.value, 10);
        if (!Number.isNaN(fallback)) {
            select.value = option.value;
            return fallback;
        }
    }

    select.value = select.options.length > 0 ? select.options[0].value : '';
    return 0;
}

function readNumericInputValue(id: string): number {
    const input = getElement<HTMLInputElement>(id);
    const clampToRange = (value: number): number => {
        const min = input.min !== '' ? Number.parseFloat(input.min) : undefined;
        const max = input.max !== '' ? Number.parseFloat(input.max) : undefined;
        let result = value;
        if (min !== undefined && Number.isFinite(min)) {
            result = Math.max(result, min);
        }
        if (max !== undefined && Number.isFinite(max)) {
            result = Math.min(result, max);
        }
        return result;
    };

    const parsed = Number.parseFloat(input.value);
    if (!Number.isNaN(parsed)) {
        const clamped = clampToRange(parsed);
        if (clamped !== parsed) {
            input.value = clamped.toString();
        }
        return clamped;
    }

    const fallbacks = [input.defaultValue, input.min, input.max];
    for (const fallback of fallbacks) {
        if (!fallback) continue;
        const fallbackValue = Number.parseFloat(fallback);
        if (!Number.isNaN(fallbackValue)) {
            const clamped = clampToRange(fallbackValue);
            input.value = clamped.toString();
            return clamped;
        }
    }

    input.value = '0';
    return 0;
}

function readCheckboxValue(id: string): boolean {
    return getElement<HTMLInputElement>(id).checked;
}

function readHeatmapPaletteValue(): HeatmapPalette {
    const select = getElement<HTMLSelectElement>('heatmapPalette');
    const { value } = select;
    if ((HEATMAP_PALETTE_OPTIONS as readonly string[]).includes(value)) {
        return value as HeatmapPalette;
    }

    const fallback = HEATMAP_PALETTE_OPTIONS[0];
    select.value = fallback;
    return fallback;
}

function formatMetricValue(value: number, fractionDigits: number): string {
    if (!Number.isFinite(value)) {
        return '—';
    }
    return value.toFixed(Math.max(0, fractionDigits));
}

export function readSimulationControls(): SimulationControls {
    return {
        month: readNumericSelectValue('month'),
        windSpeed: readNumericInputValue('windSpeed'),
        windDir: readNumericSelectValue('windDirection'),
        windGustiness: readNumericInputValue('windGustiness'),
        enableAdvection: readCheckboxValue('enableAdvection'),
        enableDiffusion: readCheckboxValue('enableDiffusion'),
        enableInversions: readCheckboxValue('enableInversions'),
        enableDownslope: readCheckboxValue('enableDownslope'),
        enableClouds: readCheckboxValue('enableClouds'),
    };
}

export function readVisualizationToggles(): VisualizationToggles {
    return {
        showSoil: readCheckboxValue('showSoilTypes'),
        showHillshade: readCheckboxValue('showHillshade'),
        showHeatmap: readCheckboxValue('showHeatmap'),
        showClouds: readCheckboxValue('showClouds'),
        showFog: readCheckboxValue('showFog'),
        showPrecipitation: readCheckboxValue('showPrecipitation'),
        showWind: readCheckboxValue('showWindFlow'),
        showSnow: readCheckboxValue('showSnowCover'),
        showHumidity: readCheckboxValue('showHumidity'),
        heatmapPalette: readHeatmapPaletteValue(),
    };
}

export function updateMetricsDisplay(metrics: SimulationMetrics): void {
    getElement<HTMLElement>('minTemp').textContent = `${formatMetricValue(metrics.minTemperature, 1)}°C`;
    getElement<HTMLElement>('maxTemp').textContent = `${formatMetricValue(metrics.maxTemperature, 1)}°C`;
    getElement<HTMLElement>('avgTemp').textContent = `${formatMetricValue(metrics.avgTemperature, 1)}°C`;
    getElement<HTMLElement>('totalPrecip').textContent = `${formatMetricValue(metrics.totalPrecipitation, 2)}mm/hr`;
    getElement<HTMLElement>('maxCloudHeight').textContent = `${formatMetricValue(metrics.maxCloudHeight, 0)}m`;
    getElement<HTMLElement>('avgSnowDepth').textContent = `${formatMetricValue(metrics.avgSnowDepth, 1)}cm`;
}

export function updateInversionDisplay(state: SimulationState, enabled: boolean): void {
    const inversionInfo = getElement<HTMLElement>('inversionInfo');
    if (enabled && state.inversionStrength > 0) {
        inversionInfo.style.display = 'block';
        getElement<HTMLElement>('inversionHeight').textContent = `${state.inversionHeight.toFixed(0)}m`;
        getElement<HTMLElement>('inversionStrength').textContent = `${(state.inversionStrength * 100).toFixed(0)}%`;
    } else {
        inversionInfo.style.display = 'none';
    }
}

export function updateSimulationClock(simulationMinutes: number): void {
    const safeMinutes = Number.isFinite(simulationMinutes) ? simulationMinutes : 0;
    const totalMinutesInDay = 24 * 60;
    const normalizedTime = safeMinutes % totalMinutesInDay;
    const currentHour = Math.floor(normalizedTime / 60);
    const currentMinute = Math.floor(normalizedTime % 60);
    const day = Math.floor(safeMinutes / totalMinutesInDay) + 1;

    getElement<HTMLElement>('simDay').textContent = `Day ${day}`;
    getElement<HTMLElement>('simTime').textContent = `${String(currentHour).padStart(2, '0')}:${String(
        currentMinute
    ).padStart(2, '0')}`;
}

export function initializeControlReadouts(): void {
    getElement<HTMLElement>('windSpeedValue').textContent = readNumericInputValue('windSpeed').toString();
    getElement<HTMLElement>('windGustinessValue').textContent = readNumericInputValue('windGustiness').toString();
    getElement<HTMLElement>('brushSizeValue').textContent = readNumericInputValue('brushSize').toString();
    getElement<HTMLElement>('terrainStrengthValue').textContent = readNumericInputValue('terrainStrength').toString();
    getElement<HTMLElement>('speedValue').textContent = `${readNumericInputValue('simSpeed')}x`;
}

function buildPlayButtonMarkup(isSimulating: boolean): string {
    const icon = isSimulating
        ? `<span class="icon icon-pause" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation" focusable="false"><path fill="currentColor" d="M9 7h2.5v10H9V7Zm5.5 0H17v10h-2.5V7Z"></path></svg></span>`
        : `<span class="icon icon-play" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation" focusable="false"><path fill="currentColor" d="M9 7v10l8-5-8-5Z"></path></svg></span>`;
    const label = isSimulating ? 'Pause' : 'Play';
    return `${icon}<span class="btn-label">${label}</span>`;
}

export function updatePlayButton(isSimulating: boolean): void {
    getElement<HTMLButtonElement>('playPauseBtn').innerHTML = buildPlayButtonMarkup(isSimulating);
}

export function resetPlayButton(): void {
    updatePlayButton(false);
}
