import { CELL_SIZE, GRID_SIZE } from '../shared/constants';
import { PRECIP_TYPES } from '../simulation/weatherTypes';
import { clamp, getLandColor } from '../simulation/utils';
import type { SimulationState } from '../simulation/state';
import type { HeatmapPalette, HeatmapVariable, VisualizationToggles } from './controls';

type ColorStop = {
    value: number;
    color: [number, number, number];
};

const HEATMAP_PALETTES: Record<HeatmapPalette, ColorStop[]> = {
    'blue-red': [
        { value: 0, color: [49, 54, 149] },
        { value: 0.25, color: [69, 117, 180] },
        { value: 0.5, color: [224, 243, 248] },
        { value: 0.75, color: [244, 109, 67] },
        { value: 1, color: [165, 0, 38] },
    ],
    'green-yellow': [
        { value: 0, color: [0, 69, 41] },
        { value: 0.25, color: [35, 132, 67] },
        { value: 0.5, color: [120, 198, 121] },
        { value: 0.75, color: [173, 221, 142] },
        { value: 1, color: [255, 255, 204] },
    ],
    'purple-orange': [
        { value: 0, color: [63, 0, 125] },
        { value: 0.25, color: [106, 81, 163] },
        { value: 0.5, color: [208, 209, 230] },
        { value: 0.75, color: [253, 174, 97] },
        { value: 1, color: [230, 85, 13] },
    ],
    'teal-magenta': [
        { value: 0, color: [0, 121, 140] },
        { value: 0.25, color: [44, 162, 180] },
        { value: 0.5, color: [171, 217, 233] },
        { value: 0.75, color: [244, 109, 190] },
        { value: 1, color: [197, 27, 138] },
    ],
};

const HUMIDITY_PALETTE: ColorStop[] = [
    { value: 0, color: [252, 245, 235] },
    { value: 0.25, color: [221, 214, 168] },
    { value: 0.5, color: [165, 219, 247] },
    { value: 0.75, color: [56, 189, 248] },
    { value: 1, color: [2, 132, 199] },
];

type HeatmapPaletteType = 'temperature' | 'humidity';

type HeatmapConfiguration = {
    grid: number[][];
    fallbackMin: number;
    fallbackMax: number;
    palette: HeatmapPaletteType;
    clampMin?: number;
    clampMax?: number;
    minSpan?: number;
    fixedRange?: { min: number; max: number };
};

function interpolateColor(stops: ColorStop[], value: number): [number, number, number] {
    if (value <= stops[0].value) return stops[0].color;
    if (value >= stops[stops.length - 1].value) return stops[stops.length - 1].color;

    for (let i = 0; i < stops.length - 1; i++) {
        const current = stops[i];
        const next = stops[i + 1];
        if (value >= current.value && value <= next.value) {
            const range = next.value - current.value;
            const t = range === 0 ? 0 : (value - current.value) / range;
            const r = Math.round(current.color[0] + (next.color[0] - current.color[0]) * t);
            const g = Math.round(current.color[1] + (next.color[1] - current.color[1]) * t);
            const b = Math.round(current.color[2] + (next.color[2] - current.color[2]) * t);
            return [r, g, b];
        }
    }

    return stops[stops.length - 1].color;
}

function getColorFromStops(
    stops: ColorStop[],
    value: number,
    minValue: number,
    maxValue: number,
    fallbackMin: number,
    fallbackMax: number
): string {
    const safeMin = Number.isFinite(minValue) ? minValue : fallbackMin;
    const safeMax = Number.isFinite(maxValue) ? maxValue : fallbackMax;
    const span = safeMax - safeMin;
    const normalized = span > 1e-6 ? clamp((value - safeMin) / span, 0, 1) : 0.5;
    const [r, g, b] = interpolateColor(stops, normalized);
    return `rgba(${r}, ${g}, ${b}, 1)`;
}

function getTemperatureColor(
    temp: number,
    palette: HeatmapPalette,
    minTemp: number,
    maxTemp: number
): string {
    return getColorFromStops(HEATMAP_PALETTES[palette], temp, minTemp, maxTemp, -10, 40);
}

function getHumidityColor(relativeHumidity: number): string {
    return getColorFromStops(HUMIDITY_PALETTE, relativeHumidity, 0, 1, 0, 1);
}

function getHeatmapConfiguration(
    state: SimulationState,
    variable: HeatmapVariable
): HeatmapConfiguration {
    switch (variable) {
        case 'soilTemperature':
            return {
                grid: state.soilTemperature,
                fallbackMin: -10,
                fallbackMax: 45,
                palette: 'temperature',
            };
        case 'dewPoint':
            return {
                grid: state.dewPoint,
                fallbackMin: -20,
                fallbackMax: 25,
                palette: 'temperature',
            };
        case 'humidity':
            return {
                grid: state.humidity,
                fallbackMin: 0,
                fallbackMax: 1,
                palette: 'humidity',
                fixedRange: { min: 0, max: 1 },
            };
        case 'soilMoisture':
            return {
                grid: state.soilMoisture,
                fallbackMin: 0,
                fallbackMax: 1,
                palette: 'humidity',
                fixedRange: { min: 0, max: 1 },
            };
        case 'snowDepth':
            return {
                grid: state.snowDepth,
                fallbackMin: 0,
                fallbackMax: 50,
                palette: 'temperature',
                clampMin: 0,
                minSpan: 5,
            };
        case 'airTemperature':
        default:
            return {
                grid: state.temperature,
                fallbackMin: -10,
                fallbackMax: 40,
                palette: 'temperature',
            };
    }
}

export function drawSimulation(
    ctx: CanvasRenderingContext2D | null,
    state: SimulationState,
    toggles: VisualizationToggles
): void {
    if (!ctx) return;

    const {
        showSoil,
        showHillshade,
        showHeatmap,
        showClouds,
        showFog,
        showPrecipitation,
        showWind,
        showSnow,
        showHumidity,
        heatmapPalette,
        heatmapVariable,
    } = toggles;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const heatmapConfig = getHeatmapConfiguration(state, heatmapVariable);
    const heatmapGrid = heatmapConfig.grid;
    let minHeatmapValue = Number.POSITIVE_INFINITY;
    let maxHeatmapValue = Number.NEGATIVE_INFINITY;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const heatmapValue = heatmapGrid[y]?.[x];
            if (Number.isFinite(heatmapValue)) {
                if (heatmapValue < minHeatmapValue) minHeatmapValue = heatmapValue;
                if (heatmapValue > maxHeatmapValue) maxHeatmapValue = heatmapValue;
            }

            ctx.fillStyle = getLandColor(state, x, y, showSoil);
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
    }

    if (heatmapConfig.fixedRange) {
        minHeatmapValue = heatmapConfig.fixedRange.min;
        maxHeatmapValue = heatmapConfig.fixedRange.max;
    } else {
        if (!Number.isFinite(minHeatmapValue) || !Number.isFinite(maxHeatmapValue)) {
            minHeatmapValue = heatmapConfig.fallbackMin;
            maxHeatmapValue = heatmapConfig.fallbackMax;
        }

        if (heatmapConfig.clampMin !== undefined) {
            minHeatmapValue = Math.max(minHeatmapValue, heatmapConfig.clampMin);
        }
        if (heatmapConfig.clampMax !== undefined) {
            maxHeatmapValue = Math.min(maxHeatmapValue, heatmapConfig.clampMax);
        }

        if (minHeatmapValue === maxHeatmapValue) {
            const span =
                heatmapConfig.minSpan ?? Math.max(0.5, Math.abs(minHeatmapValue) * 0.05);
            const halfSpan = span / 2;
            minHeatmapValue -= halfSpan;
            maxHeatmapValue += halfSpan;
        }

        if (
            heatmapConfig.minSpan !== undefined &&
            maxHeatmapValue - minHeatmapValue < heatmapConfig.minSpan
        ) {
            maxHeatmapValue = minHeatmapValue + heatmapConfig.minSpan;
        }

        if (heatmapConfig.clampMin !== undefined && minHeatmapValue < heatmapConfig.clampMin) {
            minHeatmapValue = heatmapConfig.clampMin;
        }
        if (heatmapConfig.clampMax !== undefined && maxHeatmapValue > heatmapConfig.clampMax) {
            maxHeatmapValue = heatmapConfig.clampMax;
        }

        if (minHeatmapValue >= maxHeatmapValue) {
            maxHeatmapValue = minHeatmapValue + 1;
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
        const paletteStops =
            heatmapConfig.palette === 'humidity'
                ? HUMIDITY_PALETTE
                : HEATMAP_PALETTES[heatmapPalette];
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const rawValue = heatmapGrid[y]?.[x];
                const safeValue = Number.isFinite(rawValue)
                    ? (rawValue as number)
                    : (minHeatmapValue + maxHeatmapValue) / 2;
                const color = getColorFromStops(
                    paletteStops,
                    safeValue,
                    minHeatmapValue,
                    maxHeatmapValue,
                    heatmapConfig.fallbackMin,
                    heatmapConfig.fallbackMax
                );
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
        ctx.globalAlpha = 1.0;
    }

    if (showHumidity) {
        ctx.globalAlpha = 0.45;
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const color = getHumidityColor(state.humidity[y][x]);
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
        }
        ctx.globalAlpha = 1.0;
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
            if (showPrecipitation && state.precipitation[y][x] > 0.05) {
                const pType = state.precipitationType[y][x];
                let precipColor = 'rgba(100, 150, 255, 0.7)';
                if (pType === PRECIP_TYPES.SNOW) precipColor = 'rgba(220, 220, 255, 0.7)';
                else if (pType === PRECIP_TYPES.SLEET) precipColor = 'rgba(180, 200, 255, 0.7)';
                else if (pType === PRECIP_TYPES.DRIZZLE) precipColor = 'rgba(140, 190, 255, 0.6)';
                else if (pType === PRECIP_TYPES.FREEZING_RAIN) precipColor = 'rgba(160, 210, 255, 0.75)';
                else if (pType === PRECIP_TYPES.GRAUPEL) precipColor = 'rgba(200, 215, 255, 0.75)';
                else if (pType === PRECIP_TYPES.HAIL) precipColor = 'rgba(240, 240, 255, 0.85)';
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
                    ctx.lineTo(
                        centerX + Math.cos(angle - 0.5) * (length - 4),
                        centerY + Math.sin(angle - 0.5) * (length - 4)
                    );
                    ctx.moveTo(centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length);
                    ctx.lineTo(
                        centerX + Math.cos(angle + 0.5) * (length - 4),
                        centerY + Math.sin(angle + 0.5) * (length - 4)
                    );
                    ctx.stroke();
                }
            }
        }
    }
}
