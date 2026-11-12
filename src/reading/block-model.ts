import type { Catalogue } from '../types';
import { BUILT_IN } from './icons';
import { CUSTOM, METRICS, PRESET_KEYS } from './metrics';
import type { DirFormat, IconName, Layout, ReadingAttrs, ReadingConfig, ReadingEnv } from './types';

export const BLOCK_NAME = 'ace-wind/live-reading';

/** Must match the defaults in blocks/live-reading/block.json (a test checks this). */
export const DEFAULT_ATTRS: Readonly<ReadingAttrs> = {
	metric: 'power', family: '', field: '', unit: '', decimals: -1,
	showLabel: true, label: '', showDetail: true, showUpdated: false, directionFormat: 'both',
	icon: 'auto', iconUrl: '', iconColor: '', layout: 'left', iconSize: 56, animate: true
};

export interface Option<T extends string = string> {
	value: T;
	label: string;
}

export const METRIC_OPTIONS: Option[] = [
	...PRESET_KEYS.map((k) => ({ value: k, label: METRICS[k].label })),
	{ value: CUSTOM, label: 'Other measurement…' }
];

export const ICON_OPTIONS: Option<IconName>[] = [
	{ value: 'auto', label: 'Automatic (matches the measurement)' },
	{ value: 'turbine', label: 'Wind turbine (spins at the real rotor speed)' },
	{ value: 'wind', label: 'Wind (lines flow faster in stronger wind)' },
	{ value: 'compass', label: 'Compass (points the way the wind blows)' },
	{ value: 'bolt', label: 'Lightning bolt (glows with power)' },
	{ value: 'gauge', label: 'Gauge (needle follows the value)' },
	{ value: 'image', label: 'My own image or SVG' },
	{ value: 'none', label: 'No icon' }
];

export const LAYOUT_OPTIONS: Option<Layout>[] = [
	{ value: 'left', label: 'Icon on the left' },
	{ value: 'right', label: 'Icon on the right' },
	{ value: 'top', label: 'Icon above' },
	{ value: 'background', label: 'Icon as a faint background' }
];

export const DIRECTION_OPTIONS: Option<DirFormat>[] = [
	{ value: 'both', label: 'Compass point and degrees (NNE 22°)' },
	{ value: 'compass', label: 'Compass point only (NNE)' },
	{ value: 'degrees', label: 'Degrees only (22°)' }
];

export const DECIMAL_LABELS = ['Automatic', '0', '1', '2', '3'];

/** Unit choices for the selected measurement (empty when there is nothing to choose). */
export function unitOptions(attrs: Pick<ReadingAttrs, 'metric'>): Option[] {
	const spec = METRICS[attrs.metric];
	if (!spec || spec.units.length < 2) return [];
	return spec.units.map((u) => ({ value: u.unit, label: u.unit }));
}

/** Data sets that can be read, for the "Other measurement" menu. */
export function familyOptions(cat: Catalogue | null): Option[] {
	if (!cat) return [];
	return cat.families.map((f) => ({ value: f.family, label: f.label }));
}

export function fieldOptions(cat: Catalogue | null, family: string): Option[] {
	const fam = cat && cat.families.find((f) => f.family === family);
	return fam ? fam.fields.map((f) => ({ value: f.name, label: f.label + (f.unit ? ' (' + f.unit + ')' : '') })) : [];
}

/** Attribute changes to apply when the measurement changes (units and custom fields don't carry over). */
export function metricChange(metric: string): Partial<ReadingAttrs> {
	return { metric, unit: '', family: '', field: '' };
}

/** Attribute changes when the data set changes in "Other measurement" mode: pick its first field. */
export function familyChange(cat: Catalogue | null, family: string): Partial<ReadingAttrs> {
	const first = fieldOptions(cat, family)[0];
	return { family, field: first ? first.value : '' };
}

/** Everything the tile renderer needs: saved attributes (with defaults) plus site-wide values. */
export function buildConfig(attrs: Partial<ReadingAttrs>, env: ReadingEnv): ReadingConfig {
	return { ...DEFAULT_ATTRS, ...attrs, ...env };
}

export const ENV_FALLBACK: ReadingEnv = { rest: '/wp-json/ace-wind/v1/', ratedKw: 4200, liveRefresh: 2, tz: 'Europe/London' };

export const BUILT_IN_ICONS: readonly string[] = BUILT_IN;
