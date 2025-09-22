import { BASE_ELEVATION, CELL_SIZE, GRID_SIZE } from '../shared/constants';
import { CLOUD_TYPES, type CloudType, PRECIP_TYPES } from '../simulation/weatherTypes';
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

type CloudAppearance = {
    color: [number, number, number];
    softness: number;
    verticalStretch: number;
    maxOpacity: number;
    lobeScale: number;
};

type RgbColor = readonly [number, number, number];

type WindArrowAppearance = {
    strokeStyle: string;
    lineWidth: number;
    lengthScale: number;
};

const WIND_ARROW_BASE_COLORS: {
    default: RgbColor;
    foehn: RgbColor;
    katabatic: RgbColor;
} = {
    default: [224, 234, 248],
    foehn: [255, 132, 120],
    katabatic: [128, 176, 255],
};

const DEFAULT_CLOUD_APPEARANCE: CloudAppearance = {
    color: [255, 255, 255],
    softness: 0.75,
    verticalStretch: 0.7,
    maxOpacity: 0.82,
    lobeScale: 1,
};

const CLOUD_APPEARANCE: Partial<Record<CloudType, CloudAppearance>> = {
    [CLOUD_TYPES.CUMULUS]: {
        color: [255, 255, 255],
        softness: 0.7,
        verticalStretch: 0.8,
        maxOpacity: 0.88,
        lobeScale: 1.1,
    },
    [CLOUD_TYPES.CUMULONIMBUS]: {
        color: [232, 235, 245],
        softness: 0.55,
        verticalStretch: 1.15,
        maxOpacity: 0.92,
        lobeScale: 1.35,
    },
    [CLOUD_TYPES.STRATUS]: {
        color: [240, 240, 242],
        softness: 0.85,
        verticalStretch: 0.55,
        maxOpacity: 0.75,
        lobeScale: 0.9,
    },
    [CLOUD_TYPES.STRATOCUMULUS]: {
        color: [245, 246, 248],
        softness: 0.78,
        verticalStretch: 0.65,
        maxOpacity: 0.82,
        lobeScale: 1.05,
    },
    [CLOUD_TYPES.NIMBOSTRATUS]: {
        color: [220, 223, 233],
        softness: 0.65,
        verticalStretch: 0.8,
        maxOpacity: 0.9,
        lobeScale: 1.25,
    },
    [CLOUD_TYPES.CIRRUS]: {
        color: [248, 250, 255],
        softness: 0.92,
        verticalStretch: 0.45,
        maxOpacity: 0.6,
        lobeScale: 0.75,
    },
    [CLOUD_TYPES.CIRROSTRATUS]: {
        color: [246, 248, 255],
        softness: 0.9,
        verticalStretch: 0.5,
        maxOpacity: 0.65,
        lobeScale: 0.8,
    },
    [CLOUD_TYPES.ALTOSTRATUS]: {
        color: [238, 240, 246],
        softness: 0.8,
        verticalStretch: 0.65,
        maxOpacity: 0.78,
        lobeScale: 1,
    },
    [CLOUD_TYPES.ALTOCUMULUS]: {
        color: [244, 246, 250],
        softness: 0.82,
        verticalStretch: 0.6,
        maxOpacity: 0.7,
        lobeScale: 0.95,
    },
    [CLOUD_TYPES.OROGRAPHIC]: {
        color: [236, 239, 247],
        softness: 0.72,
        verticalStretch: 0.9,
        maxOpacity: 0.86,
        lobeScale: 1.2,
    },
};

function getTerrainFactors(state: SimulationState, x: number, y: number): {
    altitudeFactor: number;
    slopeFactor: number;
} {
    const elevation = state.elevation[y][x];
    const leftElevation = x > 0 ? state.elevation[y][x - 1] : elevation;
    const rightElevation = x < GRID_SIZE - 1 ? state.elevation[y][x + 1] : elevation;
    const topElevation = y > 0 ? state.elevation[y - 1][x] : elevation;
    const bottomElevation = y < GRID_SIZE - 1 ? state.elevation[y + 1][x] : elevation;

    const gradientX = (rightElevation - leftElevation) / 2;
    const gradientY = (bottomElevation - topElevation) / 2;
    const slope = Math.sqrt(gradientX * gradientX + gradientY * gradientY);

    const altitudeFactor = clamp((elevation - BASE_ELEVATION) / 600, 0, 1);
    const slopeFactor = clamp(slope / 120, 0, 1);

    return { altitudeFactor, slopeFactor };
}

function getWindBaseColor(state: SimulationState, x: number, y: number): RgbColor {
    if (state.foehnEffect[y][x] > 0.5) return WIND_ARROW_BASE_COLORS.foehn;
    if (state.downSlopeWinds[y][x] < -0.2) return WIND_ARROW_BASE_COLORS.katabatic;
    return WIND_ARROW_BASE_COLORS.default;
}

function getWindArrowAppearance(
    state: SimulationState,
    x: number,
    y: number,
    baseColor: RgbColor
): WindArrowAppearance {
    const { altitudeFactor, slopeFactor } = getTerrainFactors(state, x, y);
    const terrainFactor = Math.max(altitudeFactor, slopeFactor);

    const brightness = 0.7 + (1 - terrainFactor) * 0.3;
    const slopeHighlight = slopeFactor * 40;

    const red = Math.round(clamp(baseColor[0] * brightness + slopeHighlight, 0, 255));
    const green = Math.round(clamp(baseColor[1] * brightness + slopeHighlight, 0, 255));
    const blue = Math.round(clamp(baseColor[2] * brightness + slopeHighlight, 0, 255));

    return {
        strokeStyle: `rgba(${red}, ${green}, ${blue}, ${0.8 + terrainFactor * 0.2})`,
        lineWidth: 0.9 + terrainFactor * 1.4,
        lengthScale: 0.85 + (1 - slopeFactor) * 0.15,
    };
}

function getCloudAppearance(type: CloudType | undefined): CloudAppearance {
    if (type === undefined) return DEFAULT_CLOUD_APPEARANCE;
    return CLOUD_APPEARANCE[type] ?? DEFAULT_CLOUD_APPEARANCE;
}

function hashCoords(x: number, y: number, seed: number): number {
    let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

function drawCloudLobe(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    color: [number, number, number],
    opacity: number,
    softness: number
): void {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(radiusX, radiusY);

    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const innerStop = clamp(0.35 + softness * 0.35, 0.35, 0.85);
    gradient.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity})`);
    gradient.addColorStop(innerStop, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity * 0.65})`);
    gradient.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawCloudCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    coverage: number,
    cloudType: CloudType,
    opticalDepth: number
): void {
    const appearance = getCloudAppearance(cloudType);
    const density = clamp(coverage * 0.85 + clamp(opticalDepth / 8, 0, 0.4), 0.15, appearance.maxOpacity);

    const centerX = x * CELL_SIZE + CELL_SIZE / 2;
    const centerY = y * CELL_SIZE + CELL_SIZE / 2;
    const lobeCount = Math.max(2, Math.round(2 + coverage * 3));

    for (let i = 0; i < lobeCount; i++) {
        const offsetSeed = i * 53;
        const angle = hashCoords(x, y, offsetSeed) * Math.PI * 2;
        const distanceFactor = 0.15 + hashCoords(x, y, offsetSeed + 13) * 0.55;
        const sizeJitter = 0.65 + hashCoords(x, y, offsetSeed + 29) * 0.5;
        const aspectJitter = 0.75 + hashCoords(x, y, offsetSeed + 41) * 0.35;

        const radiusBase = (CELL_SIZE / 2) * (0.8 + coverage * appearance.lobeScale) * sizeJitter;
        const radiusX = clamp(radiusBase, CELL_SIZE * 0.25, CELL_SIZE * 1.5);
        const radiusY = clamp(radiusBase * appearance.verticalStretch * aspectJitter, CELL_SIZE * 0.18, CELL_SIZE * 1.2);

        const offsetMagnitude = CELL_SIZE * distanceFactor * (0.4 + coverage * 0.6);
        const offsetX = Math.cos(angle) * offsetMagnitude;
        const offsetY = Math.sin(angle) * offsetMagnitude * (0.5 + appearance.verticalStretch * 0.5);

        const lobeOpacity = clamp(density * (0.85 + hashCoords(x, y, offsetSeed + 7) * 0.3), 0.08, appearance.maxOpacity);
        drawCloudLobe(ctx, centerX + offsetX, centerY + offsetY, radiusX, radiusY, appearance.color, lobeOpacity, appearance.softness);
    }

    if (coverage > 0.65 && appearance.maxOpacity > 0.8) {
        const shadowOpacity = clamp(density * 0.4, 0.05, 0.4);
        const shadowRadius = CELL_SIZE * (0.45 + coverage * 0.6);
        drawCloudLobe(
            ctx,
            centerX,
            centerY + CELL_SIZE * 0.1,
            shadowRadius,
            shadowRadius * appearance.verticalStretch * 0.9,
            [210, 214, 223],
            shadowOpacity,
            clamp(appearance.softness * 0.6, 0.3, 0.8)
        );
    }
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

    ctx.clearRect(0, 0, GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE);

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
                drawCloudCell(
                    ctx,
                    x,
                    y,
                    state.cloudCoverage[y][x],
                    state.cloudType[y][x] ?? CLOUD_TYPES.NONE,
                    state.cloudOpticalDepth[y][x]
                );
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
        for (let y = 0; y < GRID_SIZE; y += 4) {
            for (let x = 0; x < GRID_SIZE; x += 4) {
                const wind = state.windVectorField[y][x];
                if (wind.speed > 1) {
                    const centerX = x * CELL_SIZE + CELL_SIZE * 2;
                    const centerY = y * CELL_SIZE + CELL_SIZE * 2;

                    const angle = Math.atan2(wind.y, wind.x);
                    const baseLength = Math.min(CELL_SIZE * 2, wind.speed);

                    const baseColor = getWindBaseColor(state, x, y);
                    const { strokeStyle, lineWidth, lengthScale } = getWindArrowAppearance(
                        state,
                        x,
                        y,
                        baseColor
                    );

                    const length = Math.max(6, baseLength * lengthScale);
                    const headLength = Math.max(5, length * 0.35);
                    const headAngle = 0.5;

                    const tipX = centerX + Math.cos(angle) * length;
                    const tipY = centerY + Math.sin(angle) * length;

                    ctx.strokeStyle = strokeStyle;
                    ctx.lineWidth = lineWidth;

                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.lineTo(tipX, tipY);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(tipX, tipY);
                    ctx.lineTo(
                        tipX - Math.cos(angle - headAngle) * headLength,
                        tipY - Math.sin(angle - headAngle) * headLength
                    );
                    ctx.moveTo(tipX, tipY);
                    ctx.lineTo(
                        tipX - Math.cos(angle + headAngle) * headLength,
                        tipY - Math.sin(angle + headAngle) * headLength
                    );
                    ctx.stroke();
                }
            }
        }
    }
}
