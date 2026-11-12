/** Formatting and animation inputs for every measurement. */
const { METRICS, PRESET_KEYS, customSpec, computeDisplay } = require('../../src/reading/metrics');
const { DEFAULT_ATTRS } = require('../../src/reading/block-model');
const { NOW_S } = require('./helpers');

const env = { rest: '/r/', ratedKw: 4200, liveRefresh: 2, tz: 'UTC' };
const cfg = (over) => Object.assign({}, DEFAULT_ATTRS, env, over || {});
const show = (key, raw, over, t) => computeDisplay(cfg(Object.assign({ metric: key }, over)), METRICS[key], raw, t === undefined ? NOW_S : t, NOW_S);

describe('presets', () => {
	test('every preset reads a real field and has at least one unit and a built-in icon', () => {
		expect(PRESET_KEYS).toEqual(['power', 'power_pct', 'wind_speed', 'wind_direction', 'rotor_speed']);
		PRESET_KEYS.forEach((k) => {
			expect(METRICS[k].key).toBe(k);
			expect(METRICS[k].units.length).toBeGreaterThan(0);
			expect(['turbine', 'wind', 'compass', 'bolt', 'gauge']).toContain(METRICS[k].icon);
		});
		expect(METRICS.power).toMatchObject({ family: 'site_instantaneous', field: 'aggregate_active_power' });
		expect(METRICS.rotor_speed).toMatchObject({ family: 'wec_instantaneous', field: 'wec_rotor_speed' });
	});
});

describe('power output', () => {
	test('kW with separators, share of rated output in the detail line', () => {
		const d = show('power', 1234.4);
		expect([d.value, d.unit]).toEqual(['1,234', 'kW']);
		expect(d.detail).toBe('29% of 4.2 MW rated output');
		expect(d.label).toBe('Power output');
	});
	test('MW unit converts and uses two decimals by default', () => {
		const d = show('power', 1234.4, { unit: 'MW' });
		expect([d.value, d.unit]).toEqual(['1.23', 'MW']);
	});
	test('the rated power setting drives the percentage and gauge', () => {
		const d = show('power', 1000, { ratedKw: 2000 });
		expect(d.detail).toBe('50% of 2 MW rated output');
		expect(d.fraction).toBe(0.5);
	});
	test('the gauge fraction is clamped to 0-1', () => {
		expect(show('power', 9000).fraction).toBe(1);
		expect(show('power', -50).fraction).toBe(0);
	});
	test('an unknown unit falls back to the first one', () => {
		expect(show('power', 100, { unit: 'furlongs' }).unit).toBe('kW');
	});
});

describe('share of rated output', () => {
	test('percentage with the kW in the detail line', () => {
		const d = show('power_pct', 2100);
		expect([d.value, d.unit, d.detail]).toEqual(['50', '%', '2,100 kW']);
		expect(d.fraction).toBe(0.5);
	});
});

describe('wind speed', () => {
	test.each([
		['m/s', '5', '11.2 mph'],
		['mph', '11.2', '5 m/s'],
		['km/h', '18', '5 m/s'],
		['knots', '9.7', '5 m/s']
	])('5 m/s shown in %s', (unit, value, detail) => {
		const d = show('wind_speed', 5, { unit });
		expect([d.value, d.unit, d.detail]).toEqual([value, unit, detail]);
	});
	test('gauge and animation scale to 25 m/s', () => {
		expect(show('wind_speed', 12.5).fraction).toBeCloseTo(0.5);
		expect(show('wind_speed', 40).fraction).toBe(1);
	});
});

describe('wind direction', () => {
	test.each([
		[22, 'NNE'], [0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [359, 'N'], [-90, 'W'], [725, 'N']
	])('%p° is %s', (deg, point) => {
		const d = show('wind_direction', deg);
		expect(d.value).toBe(point);
		expect(d.detail).toBe('Wind blowing from the ' + point);
	});
	test('"both" shows the point large and the degrees small', () => {
		const d = show('wind_direction', 22);
		expect([d.value, d.unit]).toEqual(['NNE', '22°']);
	});
	test('"compass" shows only the point, "degrees" only the number', () => {
		expect(show('wind_direction', 22, { directionFormat: 'compass' })).toMatchObject({ value: 'NNE', unit: '' });
		expect(show('wind_direction', 22, { directionFormat: 'degrees' })).toMatchObject({ value: '22', unit: '°' });
	});
	test('the needle points downwind (reading + 180°) and degrees are normalised', () => {
		expect(show('wind_direction', 22).deg).toBe(202);
		expect(show('wind_direction', -90).deg).toBe(450);
		expect(show('wind_direction', 22).fraction).toBeCloseTo(22 / 360);
	});
});

describe('rotor speed', () => {
	test('rpm with turning/stationary detail', () => {
		expect(show('rotor_speed', 12.34)).toMatchObject({ value: '12.3', unit: 'rpm', detail: 'Rotor turning' });
		expect(show('rotor_speed', 0.2).detail).toBe('Rotor stationary');
	});
	test('the turbine icon turns at the real speed: seconds per revolution = 60 / rpm', () => {
		expect(show('rotor_speed', 15).spin).toBe(4);
		expect(show('rotor_speed', 12).spin).toBe(5);
	});
	test('very slow and very fast speeds are clamped; a stopped rotor stops the animation', () => {
		expect(show('rotor_speed', 0.31).spin).toBe(40);
		expect(show('rotor_speed', 500).spin).toBe(0.6);
		expect(show('rotor_speed', 0.2).spin).toBeNull();
		expect(show('rotor_speed', 0).spin).toBeNull();
	});
});

describe('animation inputs for the other measurements', () => {
	test('stronger wind/power means faster spin and flow, brighter glow, quicker pulse', () => {
		const calm = show('wind_speed', 2), gale = show('wind_speed', 20);
		expect(gale.spin).toBeLessThan(calm.spin);
		expect(gale.flow).toBeLessThan(calm.flow);
		expect(gale.pulse).toBeLessThan(calm.pulse);
		expect(gale.glow).toBeGreaterThan(calm.glow);
	});
	test('no wind or no power stops the movement', () => {
		expect(show('wind_speed', 0)).toMatchObject({ spin: null, flow: null });
		expect(show('power', 0)).toMatchObject({ spin: null, flow: null });
	});
	test('measurements without a natural scale (direction, custom) animate at a gentle constant', () => {
		expect(show('wind_direction', 10).spin).toBe(show('wind_direction', 300).spin);
		expect(show('wind_direction', 10).spin).not.toBeNull();
	});
});

describe('decimals', () => {
	test('automatic uses the unit default; an explicit number overrides it', () => {
		expect(show('wind_speed', 5.678).value).toBe('5.7');
		expect(show('wind_speed', 5.678, { decimals: 0 }).value).toBe('6');
		expect(show('wind_speed', 5.678, { decimals: 3 }).value).toBe('5.678');
		expect(show('power', 1234.56, { decimals: 1 }).value).toBe('1,234.6');
	});
});

describe('labels', () => {
	test('a custom label replaces the default', () => {
		expect(show('power', 1, { label: 'Right now' }).label).toBe('Right now');
	});
});

describe('missing and stale readings', () => {
	test('no reading shows an en dash and stops all animation', () => {
		const d = show('power', null, {}, null);
		expect(d).toMatchObject({ value: '–', detail: '', updated: '', empty: true, spin: null, flow: null, stale: false });
	});
	test('"updated" is the reading time in the site time zone', () => {
		expect(show('power', 5, { tz: 'UTC' }).updated).toBe('12:00:00');
		expect(show('power', 5, { tz: 'Asia/Tokyo' }).updated).toBe('21:00:00');
	});
	test('older than 3 minutes is stale; exactly 3 minutes is not', () => {
		expect(show('power', 5, {}, NOW_S - 180).stale).toBe(false);
		expect(show('power', 5, {}, NOW_S - 181).stale).toBe(true);
	});
});

describe('"other measurement"', () => {
	const spec = customSpec('wecstd', { name: 'wind_speed_mean', label: 'Mean wind speed', unit: 'm/s' });
	test('takes its label and unit from the catalogue field', () => {
		const d = computeDisplay(cfg({ metric: 'custom' }), spec, 6.789, NOW_S, NOW_S);
		expect([d.label, d.value, d.unit, d.detail]).toEqual(['Mean wind speed', '6.8', 'm/s', '']);
	});
	test('a field with no unit shows no unit text', () => {
		const s = customSpec('x', { name: 'pf', label: 'Power factor', unit: '' });
		expect(computeDisplay(cfg({ metric: 'custom' }), s, 0.98, NOW_S, NOW_S).unit).toBe('');
	});
	test('decimals can still be overridden', () => {
		expect(computeDisplay(cfg({ metric: 'custom', decimals: 3 }), spec, 6.78912, NOW_S, NOW_S).value).toBe('6.789');
	});
});
