const fs = require('fs');
const path = require('path');
const M = require('../../src/reading/block-model');
const { PRESET_KEYS } = require('../../src/reading/metrics');
const H = require('./helpers');

const blockJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../blocks/live-reading/block.json'), 'utf8'));
const cat = H.catalogue();

describe('block.json and the TypeScript model agree', () => {
	test('name', () => expect(blockJson.name).toBe(M.BLOCK_NAME));

	test('every attribute has the same default in both places', () => {
		const defaults = Object.fromEntries(Object.entries(blockJson.attributes).map(([k, v]) => [k, v.default]));
		expect(defaults).toEqual(M.DEFAULT_ATTRS);
	});

	test('attribute types match their defaults', () => {
		const typeOf = { string: 'string', number: 'number', boolean: 'boolean' };
		Object.entries(blockJson.attributes).forEach(([k, a]) => expect(typeof a.default).toBe(typeOf[a.type]));
	});

	test('the editor offers exactly the icons, layouts and formats the PHP side whitelists', () => {
		const php = fs.readFileSync(path.join(__dirname, '../../includes/class-ace-wind-live-reading.php'), 'utf8');
		const list = (name) => php.match(new RegExp('const ' + name + '\\s*=\\s*array\\(([^)]*)\\)'))[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
		expect(M.ICON_OPTIONS.map((o) => o.value).sort()).toEqual(list('ICONS').sort());
		expect(M.LAYOUT_OPTIONS.map((o) => o.value).sort()).toEqual(list('LAYOUTS').sort());
		expect(M.DIRECTION_OPTIONS.map((o) => o.value).sort()).toEqual(list('FORMATS').sort());
		expect(M.METRIC_OPTIONS.map((o) => o.value).sort()).toEqual(list('METRICS').sort());
	});

	test('supports colour, spacing, typography, border and alignment through the standard controls', () => {
		const s = blockJson.supports;
		expect(s.color).toMatchObject({ background: true, text: true });
		expect(s.spacing).toMatchObject({ padding: true, margin: true });
		expect(s.typography.fontSize).toBe(true);
		expect(s.align).toEqual(expect.arrayContaining(['left', 'center', 'right', 'wide']));
		expect(s.html).toBe(false);
	});
});

describe('options', () => {
	test('measurement menu: the five presets in order, then "Other measurement…"', () => {
		expect(M.METRIC_OPTIONS.map((o) => o.value)).toEqual([...PRESET_KEYS, 'custom']);
		expect(M.METRIC_OPTIONS[0]).toEqual({ value: 'power', label: 'Power output' });
		expect(M.METRIC_OPTIONS.slice(-1)[0].label).toBe('Other measurement…');
	});

	test('unit menu appears only for measurements with a choice of units', () => {
		expect(M.unitOptions({ metric: 'wind_speed' }).map((o) => o.value)).toEqual(['m/s', 'mph', 'km/h', 'knots']);
		expect(M.unitOptions({ metric: 'power' }).map((o) => o.value)).toEqual(['kW', 'MW']);
		['wind_direction', 'rotor_speed', 'power_pct', 'custom', 'bogus'].forEach((m) => expect(M.unitOptions({ metric: m })).toEqual([]));
	});

	test('data set and field menus come from the catalogue', () => {
		expect(M.familyOptions(cat).map((o) => o.value)).toEqual(cat.families.map((f) => f.family));
		expect(M.familyOptions(null)).toEqual([]);
		expect(M.fieldOptions(cat, 'wecstd')).toEqual([
			{ value: 'aggregate_active_power', label: 'Mean active power (kW)' }, { value: 'wind_speed_mean', label: 'Mean wind speed (m/s)' }
		]);
		expect(M.fieldOptions(cat, 'site_instantaneous').slice(-1)[0].label).toBe('Power factor');   // no unit, no brackets
		expect(M.fieldOptions(cat, 'nope')).toEqual([]);
		expect(M.fieldOptions(null, 'wecstd')).toEqual([]);
	});
});

describe('attribute changes', () => {
	test('changing measurement clears the unit and any custom data set/field', () => {
		expect(M.metricChange('wind_speed')).toEqual({ metric: 'wind_speed', unit: '', family: '', field: '' });
	});
	test('choosing a data set picks its first field', () => {
		expect(M.familyChange(cat, 'wecstd')).toEqual({ family: 'wecstd', field: 'aggregate_active_power' });
		expect(M.familyChange(cat, 'nope')).toEqual({ family: 'nope', field: '' });
		expect(M.familyChange(null, 'wecstd')).toEqual({ family: 'wecstd', field: '' });
	});
});

describe('buildConfig', () => {
	const env = { rest: '/r/', ratedKw: 3000, liveRefresh: 5, tz: 'UTC' };
	test('fills in defaults for missing attributes and adds the site settings', () => {
		expect(M.buildConfig({ metric: 'wind_speed' }, env)).toEqual({ ...M.DEFAULT_ATTRS, metric: 'wind_speed', ...env });
	});
	test('site settings cannot be overridden by attributes', () => {
		expect(M.buildConfig({ ratedKw: 1, rest: 'x' }, env)).toMatchObject(env);
	});
});
