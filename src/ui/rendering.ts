import { CELL_SIZE, GRID_SIZE } from '../shared/constants';
import { PRECIP_TYPES } from '../simulation/weatherTypes';
import { clamp, getLandColor } from '../simulation/utils';
import type { SimulationState } from '../simulation/state';
import type { HeatmapPalette, VisualizationToggles } from './controls';

type ColorStop = {
    value: number;
    color: [number, number, number];
};

const HEATMAP_PALETTES: Record<HeatmapPalette, ColorStop[]> = {
    'blue-red': [
        { value: 0, color: [59, 76, 192] },
        { value: 0.5, color: [221, 221, 221] },
        { value: 1, color: [180, 4, 38] },
    ],
    'green-yellow': [
        { value: 0, color: [0, 68, 27] },
        { value: 0.5, color: [102, 189, 99] },
        { value: 1, color: [255, 237, 160] },
    ],
    'purple-orange': [
        { value: 0, color: [63, 0, 125] },
        { value: 0.5, color: [197, 27, 138] },
        { value: 1, color: [253, 141, 60] },
    ],
    'teal-magenta': [
        { value: 0, color: [0, 150, 170] },
        { value: 0.5, color: [102, 102, 204] },
        { value: 1, color: [204, 51, 153] },
    ],
};

const HUMIDITY_PALETTE: ColorStop[] = [
    { value: 0, color: [254, 243, 199] },
    { value: 0.5, color: [96, 165, 250] },
    { value: 1, color: [15, 118, 110] },
];

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

function getTemperatureColor(temp: number, palette: HeatmapPalette): string {
    const minTemp = -10;
    const maxTemp = 40;
    const normalized = clamp((temp - minTemp) / (maxTemp - minTemp), 0, 1);
    const [r, g, b] = interpolateColor(HEATMAP_PALETTES[palette], normalized);
    return `rgba(${r}, ${g}, ${b}, 1)`;
}

function getHumidityColor(relativeHumidity: number): string {
    const normalized = clamp(relativeHumidity, 0, 1);
    const [r, g, b] = interpolateColor(HUMIDITY_PALETTE, normalized);
    return `rgba(${r}, ${g}, ${b}, 1)`;
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
    } = toggles;

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

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
                const color = getTemperatureColor(state.temperature[y][x], heatmapPalette);
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
