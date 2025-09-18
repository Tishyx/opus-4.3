import { GRID_SIZE } from '../shared/constants';
import type { SimulationState } from './state';
import { getThermalProperties, isInBounds } from './utils';

export function initializeSoilMoisture(state: SimulationState): void {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const thermalProps = getThermalProperties(state, x, y);
      let baseMoisture = thermalProps.waterRetention * 0.5;

      if (state.waterDistance[y][x] < 10) {
        baseMoisture += ((10 - state.waterDistance[y][x]) / 10) * 0.3;
      }

      if (isInBounds(x - 1, y - 1) && isInBounds(x + 1, y + 1)) {
        const slope =
          Math.abs(state.elevation[y][x] - state.elevation[y - 1][x]) +
          Math.abs(state.elevation[y][x] - state.elevation[y + 1][x]);
        if (slope > 20) {
          baseMoisture *= 0.7;
        }
      }

      state.soilMoisture[y][x] = Math.min(1, baseMoisture);
    }
  }
}

