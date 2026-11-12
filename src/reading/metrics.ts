import { COMPASS, MPS_TO_MPH, STALE_AFTER_S } from '../constants';
import type { FieldInfo } from '../types';
import { clock, nf } from '../util';
import type { BuiltInIcon, ReadingConfig } from './types';

export interface UnitOpt {
	unit: string;
	/** Multiply the base-unit value by this to get the displayed value. */
	factor: number;
	/** Decimal places used when the block's "decimals" is automatic. */
	decimals: number;
}

export interface MetricSpec {
	key: string;
	label: string;
	family: string;
	field: string;
	units: UnitOpt[];
	/** Icon used when the block's icon is "automatic". */
	icon: BuiltInIcon;
}

/** Wind speed that fills the gauge / drives the animation to its maximum, m/s. */
export const FULL_WIND_MS = 25;
/** Rotor speed that fills the gauge, rpm. */
export const FULL_ROTOR_RPM = 20;

export const METRICS: Readonly<Record<string, MetricSpec>> = {
	power: {
		key: 'power', label: 'Power output', family: 'site_instantaneous', field: 'aggregate_active_power', icon: 'bolt',
		units: [{ unit: 'kW', factor: 1, decimals: 0 }, { unit: 'MW', factor: 0.001, decimals: 2 }]
	},
	power_pct: {
		key: 'power_pct', label: 'Share of rated output', family: 'site_instantaneous', field: 'aggregate_active_power', icon: 'gauge',
		units: [{ unit: '%', factor: 1, decimals: 0 }]
	},
	wind_speed: {
		key: 'wind_speed', label: 'Wind speed', family: 'site_instantaneous', field: 'aggregate_wind_speed', icon: 'wind',
		units: [
			{ unit: 'm/s', factor: 1, decimals: 1 }, { unit: 'mph', factor: MPS_TO_MPH, decimals: 1 },
			{ unit: 'km/h', factor: 3.6, decimals: 0 }, { unit: 'knots', factor: 1.94384, decimals: 1 }
		]
	},
	wind_direction: {
		key: 'wind_direction', label: 'Wind direction', family: 'site_instantaneous', field: 'aggregate_wind_direction', icon: 'compass',
		units: [{ unit: '°', factor: 1, decimals: 0 }]
	},
	rotor_speed: {
		key: 'rotor_speed', label: 'Rotor speed', family: 'wec_instantaneous', field: 'wec_rotor_speed', icon: 'turbine',
		units: [{ unit: 'rpm', factor: 1, decimals: 1 }]
	}
};

export const PRESET_KEYS: readonly string[] = Object.keys(METRICS);
export const CUSTOM = 'custom';

/** A spec for "any other measurement", built from the catalogue entry for that field. */
export function customSpec(family: string, field: FieldInfo): MetricSpec {
	return {
		key: CUSTOM, label: field.label, family, field: field.name, icon: 'gauge',
		units: [{ unit: field.unit, factor: 1, decimals: 1 }]
	};
}

export interface Display {
	label: string;
	/** Main text, e.g. "1,234" or "NNE". */
	value: string;
	/** Small text after the value, e.g. "kW" or "22°". */
	unit: string;
	detail: string;
	/** "Updated 12:00:02", or '' when there is no reading. */
	updated: string;
	/** 0-1: how full the gauge is. */
	fraction: number;
	/** Needle rotation for the compass icon, degrees. */
	deg: number;
	/** Seconds per turn of the turbine icon; null = stopped. */
	spin: number | null;
	/** Seconds per cycle of the wind-line animation; null = still. */
	flow: number | null;
	pulse: number;
	glow: number;
	stale: boolean;
	empty: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Turn a raw reading into everything the tile shows and every animation input.
 * @param raw   latest value in the data set's own unit (kW, m/s, degrees, rpm...) or null if none
 * @param t     Unix seconds of that reading, or null
 * @param nowS  current Unix seconds (a parameter so it can be tested)
 */
export function computeDisplay(cfg: ReadingConfig, spec: MetricSpec, raw: number | null, t: number | null, nowS: number): Display {
	const opt = spec.units.find((u) => u.unit === cfg.unit) || spec.units[0];
	const dp = cfg.decimals >= 0 ? cfg.decimals : opt.decimals;
	const rated = Math.max(1, cfg.ratedKw);

	const d: Display = {
		label: cfg.label || spec.label, value: '–', unit: opt.unit, detail: '',
		updated: t != null ? clock(t, cfg.tz, true) : '',
		fraction: 0, deg: 0, spin: null, flow: null, pulse: 3, glow: 2,
		stale: t != null && nowS - t > STALE_AFTER_S,
		empty: raw == null
	};
	if (raw == null) return d;

	// Fraction for the gauge, and the 0-1 "intensity" that drives the other animations.
	let intensity: number | null = null;   // null = no natural scale: use a gentle constant

	switch (spec.key) {
		case 'power': {
			d.value = nf(raw * opt.factor, dp);
			d.detail = nf(raw / rated * 100, 0) + '% of ' + nf(rated / 1000, 1) + ' MW rated output';
			d.fraction = intensity = clamp(raw / rated, 0, 1);
			break;
		}
		case 'power_pct': {
			d.value = nf(raw / rated * 100, dp);
			d.detail = nf(raw, 0) + ' kW';
			d.fraction = intensity = clamp(raw / rated, 0, 1);
			break;
		}
		case 'wind_speed': {
			d.value = nf(raw * opt.factor, dp);
			d.detail = opt.unit === 'm/s' ? nf(raw * MPS_TO_MPH, 1) + ' mph' : nf(raw, 1) + ' m/s';
			d.fraction = intensity = clamp(raw / FULL_WIND_MS, 0, 1);
			break;
		}
		case 'wind_direction': {
			const deg = ((raw % 360) + 360) % 360;
			const point = COMPASS[Math.round(deg / 22.5) % 16];
			if (cfg.directionFormat === 'degrees') { d.value = nf(deg, dp); d.unit = '°'; }
			else if (cfg.directionFormat === 'compass') { d.value = point; d.unit = ''; }
			else { d.value = point; d.unit = nf(deg, dp) + '°'; }
			d.detail = 'Wind blowing from the ' + point;
			// The reading is where the wind comes FROM; the needle points the way it is blowing TO.
			d.deg = deg + 180;
			d.fraction = deg / 360;
			break;
		}
		case 'rotor_speed': {
			d.value = nf(raw * opt.factor, dp);
			d.detail = raw > 0.5 ? 'Rotor turning' : 'Rotor stationary';
			d.fraction = intensity = clamp(raw / FULL_ROTOR_RPM, 0, 1);
			break;
		}
		default: {
			d.value = nf(raw * opt.factor, dp);
			d.fraction = 0.5;
		}
	}

	const mf = intensity == null ? 0.5 : intensity;
	if (spec.key === 'rotor_speed') {
		// Real speed: seconds per revolution = 60 / rpm.
		d.spin = raw > 0.3 ? clamp(60 / raw, 0.6, 40) : null;
	} else {
		d.spin = mf > 0.02 ? 16 - 14 * mf : null;
	}
	d.flow = mf > 0.02 ? 4 - 3.2 * mf : null;
	d.pulse = 3 - 2.2 * mf;
	d.glow = 2 + 10 * mf;
	return d;
}
