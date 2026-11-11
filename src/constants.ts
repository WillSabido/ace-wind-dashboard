import type { ChartStyle } from "./types";

export const RANGES: ReadonlyArray<readonly [number, string]> = [
  [300, "Last 5 minutes"],
  [1800, "Last 30 minutes"],
  [3600, "Last hour"],
  [21600, "Last 6 hours"],
  [86400, "Last 24 hours"],
  [604800, "Last 7 days"],
  [2592000, "Last 30 days"],
  [7776000, "Last 90 days"],
  [31536000, "Last year"],
];

export const STYLES: ReadonlyArray<readonly [ChartStyle, string]> = [
  ["line", "Line"],
  ["area", "Area"],
  ["step", "Steps"],
];

export const RES_NAMES: Readonly<Record<string, string>> = {
  "1s": "1-second",
  "60s": "1-minute",
  "10m": "10-minute",
  daily: "daily",
};

/** Line colours: measurement, then comparison. */
export const COLORS: readonly [string, string] = ["#1f8a4c", "#e07b00"];

export const COMPASS: readonly string[] = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export const DOI = "https://doi.org/10.5281/zenodo.22662372";

export const ARROW =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 18-6-4-6 4z"/></svg>';

/** Resolution-picking limits (points per chart request). */
export const LIMITS = {
  /** Fits the API's single "latest" call. */
  latest: 2000,
  /** Below this many points the coarse choice looks too sparse... */
  sparse: 60,
  /** ...so step down to a finer resolution as long as it stays within this many. */
  stepDown: 5000,
  /** Absolute ceiling; matches the server's MAX_POINTS. */
  hard: 12000,
  /** A chart needs at least this many points. */
  min: 2,
} as const;

/** Data older than this many seconds is flagged as delayed. */
export const STALE_AFTER_S = 180;
/** Above this power (kW) the turbine counts as generating. */
export const GENERATING_KW = 5;
export const MPS_TO_MPH = 2.23694;
