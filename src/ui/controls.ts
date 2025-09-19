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

export type HeatmapPalette = 'blue-red' | 'green-yellow' | 'purple-orange' | 'teal-magenta';

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

export function readSimulationControls(): SimulationControls {
    return {
        month: Number.parseInt(getElement<HTMLSelectElement>('month').value, 10),
        windSpeed: Number.parseInt(getElement<HTMLInputElement>('windSpeed').value, 10),
        windDir: Number.parseInt(getElement<HTMLSelectElement>('windDirection').value, 10),
        windGustiness: Number.parseInt(getElement<HTMLInputElement>('windGustiness').value, 10),
        enableAdvection: getElement<HTMLInputElement>('enableAdvection').checked,
        enableDiffusion: getElement<HTMLInputElement>('enableDiffusion').checked,
        enableInversions: getElement<HTMLInputElement>('enableInversions').checked,
        enableDownslope: getElement<HTMLInputElement>('enableDownslope').checked,
        enableClouds: getElement<HTMLInputElement>('enableClouds').checked,
    };
}

export function readVisualizationToggles(): VisualizationToggles {
    return {
        showSoil: getElement<HTMLInputElement>('showSoilTypes').checked,
        showHillshade: getElement<HTMLInputElement>('showHillshade').checked,
        showHeatmap: getElement<HTMLInputElement>('showHeatmap').checked,
        showClouds: getElement<HTMLInputElement>('showClouds').checked,
        showFog: getElement<HTMLInputElement>('showFog').checked,
        showPrecipitation: getElement<HTMLInputElement>('showPrecipitation').checked,
        showWind: getElement<HTMLInputElement>('showWindFlow').checked,
        showSnow: getElement<HTMLInputElement>('showSnowCover').checked,
        showHumidity: getElement<HTMLInputElement>('showHumidity').checked,
        heatmapPalette: getElement<HTMLSelectElement>('heatmapPalette').value as HeatmapPalette,
    };
}

export function updateMetricsDisplay(metrics: SimulationMetrics): void {
    getElement<HTMLElement>('minTemp').textContent = `${metrics.minTemperature.toFixed(1)}°C`;
    getElement<HTMLElement>('maxTemp').textContent = `${metrics.maxTemperature.toFixed(1)}°C`;
    getElement<HTMLElement>('avgTemp').textContent = `${metrics.avgTemperature.toFixed(1)}°C`;
    getElement<HTMLElement>('totalPrecip').textContent = `${metrics.totalPrecipitation.toFixed(2)}mm/hr`;
    getElement<HTMLElement>('maxCloudHeight').textContent = `${metrics.maxCloudHeight.toFixed(0)}m`;
    getElement<HTMLElement>('avgSnowDepth').textContent = `${metrics.avgSnowDepth.toFixed(1)}cm`;
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
    const totalMinutesInDay = 24 * 60;
    const normalizedTime = simulationMinutes % totalMinutesInDay;
    const currentHour = Math.floor(normalizedTime / 60);
    const currentMinute = Math.floor(normalizedTime % 60);
    const day = Math.floor(simulationMinutes / totalMinutesInDay) + 1;

    getElement<HTMLElement>('simDay').textContent = `Day ${day}`;
    getElement<HTMLElement>('simTime').textContent = `${String(currentHour).padStart(2, '0')}:${String(
        currentMinute
    ).padStart(2, '0')}`;
}

export function initializeControlReadouts(): void {
    getElement<HTMLElement>('windSpeedValue').textContent = getElement<HTMLInputElement>('windSpeed').value;
    getElement<HTMLElement>('windGustinessValue').textContent = getElement<HTMLInputElement>('windGustiness').value;
    getElement<HTMLElement>('brushSizeValue').textContent = getElement<HTMLInputElement>('brushSize').value;
    getElement<HTMLElement>('terrainStrengthValue').textContent = getElement<HTMLInputElement>('terrainStrength').value;
    getElement<HTMLElement>('speedValue').textContent = `${getElement<HTMLInputElement>('simSpeed').value}x`;
}

export function updatePlayButton(isSimulating: boolean): void {
    getElement<HTMLButtonElement>('playPauseBtn').innerHTML = isSimulating ? '⏸️ Pause' : '▶️ Play';
}

export function resetPlayButton(): void {
    updatePlayButton(false);
}
