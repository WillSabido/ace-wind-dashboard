import type uPlot from "uplot";

/** uPlot is loaded as a separate script by WordPress (handle "uplot") and exposed as a global. */
declare global {
  interface Window {
    uPlot: typeof uPlot;
  }
}

/** Config the PHP shortcode writes into the container's `data-config` attribute. */
export interface Config {
  rest: string;
  title: string;
  family: string;
  field: string;
  compare: string;
  range: number;
  height: number;
  tiles: boolean;
  controls: boolean;
  ratedKw: number;
  liveRefresh: number;
  tz: string;
}

/* ---- /catalogue ---- */

export interface Resolution {
  resolution: string;
  seconds: number;
  refresh: number;
  max_page: number;
  max_latest: number;
}

export interface FieldInfo {
  name: string;
  label: string;
  unit: string;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
}

export type Scope = "site" | "asset";

export interface Family {
  family: string;
  label: string;
  scope: Scope;
  assets: string[];
  resolutions: Resolution[];
  fields: FieldInfo[];
}

export interface Catalogue {
  site: string;
  assets: Asset[];
  families: Family[];
}

/* ---- /data ---- */

export type Reading = number | null;

export interface DataResponse {
  family: string;
  resolution: string;
  seconds: number;
  fields: Record<string, FieldInfo>;
  timestamps: number[];
  series: Record<string, Reading[]>;
  truncated: boolean;
}

/** A single newest non-null value and the time it was recorded. */
export interface Latest {
  v: number;
  t: number;
}

/* ---- UI state ---- */

export type ChartStyle = "line" | "area" | "step";
export type RangeKey = number | "custom";

export interface State {
  family: string;
  asset: string | null;
  f1: string;
  f2: string;
  range: RangeKey;
  style: ChartStyle;
  live: boolean;
  cStart: number | null;
  cEnd: number | null;
}

/** What the chart is currently showing; used by the CSV export. */
export interface ChartData {
  ts: number[];
  cols: Reading[][];
  fields: string[];
  meta: Record<string, FieldInfo>;
  family: string;
}
