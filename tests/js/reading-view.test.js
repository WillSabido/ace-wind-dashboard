/** The live-reading tile: markup, layouts, icons, live updates, and failure states. */
const H = require('./helpers');
const { settle, tick, jsonResponse, NOW_S } = H;
const R = require('./reading-helpers');
const { mountTile, readings, config, text, valueText, unitText, iconVar } = R;

const POWER = { aggregate_active_power: 1234.4 };

describe('markup', () => {
	test('builds label, value and detail, with a placeholder dash until the first reading', async () => {
		const t = mountTile({}, readings(POWER));
		expect(t.root().className).toBe('acewd-r acewd-r--left');
		expect(text(t.host, 'label')).toBe('Power output');
		expect(valueText(t.host)).toBe('–');
		await settle();
		expect(valueText(t.host)).toBe('1,234');
		expect(unitText(t.host)).toBe('kW');
		expect(text(t.host, 'detail')).toBe('29% of 4.2 MW rated output');
	});

	test('the value is not announced to screen readers on every update', () => {
		const t = mountTile({}, readings(POWER));
		expect(t.host.querySelector('.acewd-r__value').getAttribute('aria-live')).toBe('off');
	});

	test.each(['left', 'right', 'top', 'background'])('layout %s sets the layout class and puts the icon first', (layout) => {
		const t = mountTile({ layout }, readings(POWER));
		expect(t.root().classList.contains('acewd-r--' + layout)).toBe(true);
		expect(t.root().firstChild.className).toBe('acewd-r__icon');
	});

	test('showLabel, showDetail and showUpdated switch their lines on and off', async () => {
		let t = mountTile({ showLabel: false, showDetail: false, showUpdated: false }, readings(POWER));
		await settle();
		['label', 'detail', 'updated'].forEach((c) => expect(t.host.querySelector('.acewd-r__' + c)).toBeNull());
		expect(valueText(t.host)).toBe('1,234');

		t = mountTile({ showUpdated: true }, readings(POWER));
		await settle();
		expect(text(t.host, 'updated')).toBe('Updated 12:00:00');
	});

	test('the unit element is hidden when there is no unit text', async () => {
		const t = mountTile({ metric: 'wind_direction', directionFormat: 'compass' }, readings({ aggregate_wind_direction: 22 }));
		await settle();
		expect(t.host.querySelector('.acewd-r__unit').style.display).toBe('none');
	});

	test('a custom label replaces the default', () => {
		expect(text(mountTile({ label: 'Right now' }, readings(POWER)).host, 'label')).toBe('Right now');
	});

	test('the host carries the icon size, colour and animation flag', () => {
		const t = mountTile({ iconSize: 80, iconColor: '#e07b00', animate: false }, readings(POWER));
		expect(t.host.style.getPropertyValue('--acewd-icon-size')).toBe('80px');
		expect(t.host.style.getPropertyValue('--acewd-icon-color')).toBe('#e07b00');
		expect(t.host.getAttribute('data-animate')).toBe('0');
		expect(mountTile({}, readings(POWER)).host.getAttribute('data-animate')).toBe('1');
		expect(mountTile({}, readings(POWER)).host.style.getPropertyValue('--acewd-icon-color')).toBe('');
	});
});

describe('icons', () => {
	const iconOf = (t) => { const i = t.host.querySelector('.acewd-r__icon svg'); return i && Array.from(i.classList).find((c) => c.startsWith('acewd-ico--')); };

	test.each([
		['power', 'bolt'], ['power_pct', 'gauge'], ['wind_speed', 'wind'], ['wind_direction', 'compass'], ['rotor_speed', 'turbine']
	])('automatic icon for %s is %s', (metric, icon) => {
		expect(iconOf(mountTile({ metric }, readings({})))).toBe('acewd-ico--' + icon);
	});

	test('an explicit built-in icon overrides automatic', () => {
		expect(iconOf(mountTile({ icon: 'turbine' }, readings({})))).toBe('acewd-ico--turbine');
	});

	test('an unrecognised icon name draws no icon rather than failing', () => {
		const t = mountTile({ icon: 'bogus' }, readings({}));
		expect(t.host.querySelector('.acewd-r__icon')).toBeNull();
		expect(text(t.host, 'label')).toBe('Power output');
	});

	test('"none" draws no icon', () => {
		const t = mountTile({ icon: 'none' }, readings({}));
		expect(t.host.querySelector('.acewd-r__icon')).toBeNull();
	});

	test('a custom image is an <img> with the given URL, no alt text (decorative)', () => {
		const t = mountTile({ icon: 'image', iconUrl: 'https://example.org/wp-content/uploads/turbine.svg' }, readings({}));
		const img = t.host.querySelector('.acewd-r__icon img');
		expect(img.getAttribute('src')).toBe('https://example.org/wp-content/uploads/turbine.svg');
		expect(img.getAttribute('alt')).toBe('');
		expect(t.host.querySelector('.acewd-r__icon svg')).toBeNull();
	});

	test.each([['javascript:alert(1)'], ['data:image/svg+xml;base64,AAAA'], [''], ['//evil.example/x.svg']])(
		'a custom image with an unsafe or empty URL (%p) shows no icon at all', (iconUrl) => {
			const t = mountTile({ icon: 'image', iconUrl }, readings({}));
			expect(t.host.querySelector('.acewd-r__icon')).toBeNull();
			expect(t.host.querySelector('img')).toBeNull();
		});
});

describe('icon animation variables follow the live data', () => {
	test('turbine: seconds per revolution equals 60 / rpm', async () => {
		const t = mountTile({ metric: 'rotor_speed' }, readings({ wec_rotor_speed: 15 }));
		await settle();
		expect(iconVar(t.host, '--acewd-spin')).toBe('4s');
		expect(iconVar(t.host, '--acewd-spin-play')).toBe('running');
	});

	test('a stopped rotor pauses the animation', async () => {
		const t = mountTile({ metric: 'rotor_speed' }, readings({ wec_rotor_speed: 0 }));
		await settle();
		expect(iconVar(t.host, '--acewd-spin-play')).toBe('paused');
	});

	test('compass: needle points downwind and updates when the wind changes', async () => {
		let deg = 22;
		const t = mountTile({ metric: 'wind_direction' }, (c) => readings({ aggregate_wind_direction: deg })(c));
		await settle();
		expect(iconVar(t.host, '--acewd-deg')).toBe('202deg');
		deg = 90;
		await tick(2000);
		expect(iconVar(t.host, '--acewd-deg')).toBe('270deg');
		expect(valueText(t.host)).toBe('E');
	});

	test('gauge: fraction follows the value', async () => {
		const t = mountTile({ metric: 'power', icon: 'gauge' }, readings({ aggregate_active_power: 2100 }));
		await settle();
		expect(iconVar(t.host, '--acewd-frac')).toBe('0.5');
	});

	/** Mount a tile, wait for its first reading, and return an icon variable (one tile at a time: each mount installs its own fetch). */
	async function varFor(cfg, values, name) {
		const t = mountTile(cfg, readings(values));
		await settle();
		const v = parseFloat(iconVar(t.host, name));
		t.mounted.destroy();
		return v;
	}

	test('bolt: glow and pulse follow power', async () => {
		const low = { metric: 'power' };
		expect(await varFor(low, { aggregate_active_power: 4000 }, '--acewd-glow')).toBeGreaterThan(await varFor(low, { aggregate_active_power: 100 }, '--acewd-glow'));
		expect(await varFor(low, { aggregate_active_power: 4000 }, '--acewd-pulse')).toBeLessThan(await varFor(low, { aggregate_active_power: 100 }, '--acewd-pulse'));
	});

	test('wind lines flow faster in stronger wind', async () => {
		const cfg = { metric: 'wind_speed' };
		expect(await varFor(cfg, { aggregate_wind_speed: 20 }, '--acewd-flow')).toBeLessThan(await varFor(cfg, { aggregate_wind_speed: 2 }, '--acewd-flow'));
	});

	test('stale data pauses the animations', async () => {
		const t = mountTile({ metric: 'rotor_speed' }, readings({ wec_rotor_speed: 15 }, { age: 400 }));
		await settle();
		expect(iconVar(t.host, '--acewd-spin-play')).toBe('paused');
	});
});

describe('measurements', () => {
	test('wind speed in the chosen unit', async () => {
		const t = mountTile({ metric: 'wind_speed', unit: 'mph' }, readings({ aggregate_wind_speed: 5 }));
		await settle();
		expect([valueText(t.host), unitText(t.host), text(t.host, 'detail')]).toEqual(['11.2', 'mph', '5 m/s']);
	});

	test('wind direction: compass point large, degrees small', async () => {
		const t = mountTile({ metric: 'wind_direction' }, readings({ aggregate_wind_direction: 22 }));
		await settle();
		expect([valueText(t.host), unitText(t.host), text(t.host, 'detail')]).toEqual(['NNE', '22°', 'Wind blowing from the NNE']);
	});

	test('rotor speed', async () => {
		const t = mountTile({ metric: 'rotor_speed' }, readings({ wec_rotor_speed: 12.34 }));
		await settle();
		expect([valueText(t.host), unitText(t.host), text(t.host, 'detail')]).toEqual(['12.3', 'rpm', 'Rotor turning']);
		expect(t.fetch.tiles()[0].params).toMatchObject({ family: 'wec_instantaneous', asset: 'wec1' });
	});

	test('share of rated output', async () => {
		const t = mountTile({ metric: 'power_pct' }, readings({ aggregate_active_power: 2100 }));
		await settle();
		expect([valueText(t.host), unitText(t.host), text(t.host, 'detail')]).toEqual(['50', '%', '2,100 kW']);
	});

	test('updates live every refresh interval', async () => {
		let kw = 100;
		const t = mountTile({}, (c) => readings({ aggregate_active_power: kw })(c));
		await settle();
		expect(valueText(t.host)).toBe('100');
		kw = 250;
		await tick(2000);
		expect(valueText(t.host)).toBe('250');
	});

	test('no reading leaves the dash and an empty detail', async () => {
		const t = mountTile({}, readings({ aggregate_active_power: null }));
		await settle();
		expect(valueText(t.host)).toBe('–');
		expect(text(t.host, 'detail')).toBe('');
	});
});

describe('other measurement (custom)', () => {
	test('takes its label and unit from the catalogue and reads that field', async () => {
		const t = mountTile({ metric: 'custom', family: 'wecstd', field: 'wind_speed_mean' }, readings({ wind_speed_mean: 6.789 }));
		await settle();
		expect(text(t.host, 'label')).toBe('Mean wind speed');
		expect([valueText(t.host), unitText(t.host)]).toEqual(['6.8', 'm/s']);
		expect(t.fetch.tiles()[0].params).toMatchObject({ family: 'wecstd', fields: 'wind_speed_mean', asset: 'wec1' });
	});

	test('a custom label overrides the catalogue label', async () => {
		const t = mountTile({ metric: 'custom', family: 'wecstd', field: 'wind_speed_mean', label: 'Average wind' }, readings({ wind_speed_mean: 5 }));
		await settle();
		expect(text(t.host, 'label')).toBe('Average wind');
	});

	test('an unknown field or data set shows "Measurement unavailable" and makes no data request', async () => {
		for (const over of [{ field: 'nope' }, { family: 'nope' }]) {
			const t = mountTile(Object.assign({ metric: 'custom', family: 'wecstd', field: 'wind_speed_mean' }, over), readings({}));
			await settle();
			expect(text(t.host, 'label')).toBe('Measurement unavailable');
			expect(t.root().classList.contains('is-error')).toBe(true);
			expect(t.fetch.tiles()).toHaveLength(0);
		}
	});

	test('an unfinished custom measurement prompts for a choice (shown in the editor preview)', async () => {
		const t = mountTile({ metric: 'custom', family: '', field: '' }, readings({}));
		await settle();
		expect(text(t.host, 'label')).toBe('Choose a measurement');
		expect(t.root().classList.contains('is-error')).toBe(true);
		expect(t.fetch.calls).toHaveLength(0);
	});

	test('an unknown preset key behaves like an unfinished one', async () => {
		const t = mountTile({ metric: 'bogus' }, readings({}));
		await settle();
		expect(text(t.host, 'label')).toBe('Choose a measurement');
	});
});

describe('stale and failed data', () => {
	test('data older than 3 minutes is dimmed and says when the last reading was', async () => {
		const t = mountTile({}, readings(POWER, { age: 200 }));
		await settle();
		expect(t.root().classList.contains('is-stale')).toBe(true);
		expect(text(t.host, 'detail')).toBe('Data delayed – last reading 11:56:40');
		expect(valueText(t.host)).toBe('1,234');   // the last known value is still shown
	});

	test('fresh data clears the stale state again', async () => {
		let age = 400;
		const t = mountTile({}, (c) => readings(POWER, { age })(c));
		await settle();
		expect(t.root().classList.contains('is-stale')).toBe(true);
		age = 0;
		await tick(2000);
		expect(t.root().classList.contains('is-stale')).toBe(false);
	});

	test('a failed request shows the error state and "Data unavailable", then recovers', async () => {
		let fail = true;
		const t = mountTile({}, (c) => (R.isTile(c) && fail ? jsonResponse({ error: 'down' }, 502) : readings(POWER)(c)));
		await settle();
		expect(t.root().classList.contains('is-error')).toBe(true);
		expect(text(t.host, 'detail')).toBe('Data unavailable');
		fail = false;
		await tick(4000);
		expect(t.root().classList.contains('is-error')).toBe(false);
		expect(valueText(t.host)).toBe('1,234');
	});
});

describe('lifecycle', () => {
	test('destroy empties the host and stops all requests and updates', async () => {
		const t = mountTile({}, readings(POWER));
		await settle();
		const n = t.fetch.tiles().length;
		t.mounted.destroy();
		expect(t.host.innerHTML).toBe('');
		await tick(20000);
		expect(t.fetch.tiles()).toHaveLength(n);
	});

	test('destroying before the catalogue arrives (custom) does not start polling', async () => {
		const t = mountTile({ metric: 'custom', family: 'wecstd', field: 'wind_speed_mean' }, readings({ wind_speed_mean: 5 }));
		t.mounted.destroy();
		await settle();
		expect(t.fetch.tiles()).toHaveLength(0);
	});

	test('remounting with new settings replaces the old tile cleanly', async () => {
		const t = mountTile({}, readings({ aggregate_active_power: 1, aggregate_wind_speed: 8 }));
		await settle();
		t.mounted.destroy();
		const again = t.api.mountReading(t.host, config({ metric: 'wind_speed' }));
		await settle();
		expect(t.host.querySelectorAll('.acewd-r')).toHaveLength(1);
		expect(valueText(t.host)).toBe('8');
		again.destroy();
	});

	test('works inside another document, such as the block editor iframe', async () => {
		const frame = document.implementation.createHTMLDocument('editor');
		const t = mountTile({}, readings(POWER), frame);
		await settle();
		expect(t.root().ownerDocument).toBe(frame);
		expect(t.host.querySelector('.acewd-r__value').ownerDocument).toBe(frame);
		expect(valueText(t.host)).toBe('1,234');
	});
});

describe('several tiles on one page', () => {
	function page(configs, handler) {
		document.body.innerHTML = '';
		const hosts = configs.map((c) => {
			const el = document.createElement('div');
			el.className = 'acewd-reading';
			el.setAttribute('data-config', JSON.stringify(config(c)));
			document.body.appendChild(el);
			return el;
		});
		const fetch = H.installFetch(handler);
		let api;
		jest.isolateModules(() => { api = require('../../src/reading/reading-view'); });
		const mounted = api.initReadings();
		return { hosts, fetch, mounted, api };
	}

	test('initReadings mounts every container once and marks it', async () => {
		const p = page([{}, { metric: 'wind_speed' }], readings({ aggregate_active_power: 5, aggregate_wind_speed: 6 }));
		await settle();
		expect(p.mounted).toHaveLength(2);
		p.hosts.forEach((h) => expect(h.getAttribute('data-mounted')).toBe('1'));
		expect(p.api.initReadings()).toHaveLength(0);          // second call finds nothing new
		expect(p.hosts.map((h) => valueText(h))).toEqual(['5', '6']);
	});

	test('tiles on the same data set share one request however many there are', async () => {
		const p = page([{}, { metric: 'wind_speed' }, { metric: 'wind_direction' }, { metric: 'power_pct' }],
			readings({ aggregate_active_power: 1, aggregate_wind_speed: 2, aggregate_wind_direction: 3 }));
		await settle();
		expect(p.fetch.tiles()).toHaveLength(1);
		expect(p.fetch.tiles()[0].params.fields.split(',').sort()).toEqual(['aggregate_active_power', 'aggregate_wind_direction', 'aggregate_wind_speed']);
		await tick(2000);
		expect(p.fetch.tiles()).toHaveLength(2);                // one request per refresh for all four tiles
	});

	test('a turbine tile adds one more request, not one per tile', async () => {
		const p = page([{}, { metric: 'rotor_speed' }, { metric: 'rotor_speed', layout: 'top' }], readings({ aggregate_active_power: 1, wec_rotor_speed: 9 }));
		await settle();
		expect(p.fetch.tiles().map((c) => c.params.family).sort()).toEqual(['site_instantaneous', 'wec_instantaneous']);
	});

	test('containers with missing or broken config are ignored without errors', () => {
		document.body.innerHTML = '<div class="acewd-reading"></div><div class="acewd-reading" data-config="{not json"></div>';
		H.installFetch();
		let api;
		jest.isolateModules(() => { api = require('../../src/reading/reading-view'); });
		expect(api.initReadings()).toHaveLength(0);
	});
});

describe('front-end entry point', () => {
	const load = () => jest.isolateModules(() => { require('../../src/reading/view-main'); });
	const container = () => {
		document.body.innerHTML = '<div class="acewd-reading" data-config=\'' + JSON.stringify(config({})) + '\'></div>';
		return document.querySelector('.acewd-reading');
	};

	test('mounts immediately when the document is already loaded', async () => {
		const el = container();
		H.installFetch(readings(POWER));
		load();
		await settle();
		expect(el.getAttribute('data-mounted')).toBe('1');
		expect(valueText(el)).toBe('1,234');
	});

	test('waits for DOMContentLoaded while the document is still loading', async () => {
		const el = container();
		const f = H.installFetch(readings(POWER));
		const state = jest.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
		load();
		await settle();
		expect(f.calls).toHaveLength(0);
		expect(el.getAttribute('data-mounted')).toBeNull();
		state.mockReturnValue('interactive');
		document.dispatchEvent(new Event('DOMContentLoaded'));
		await settle();
		expect(el.getAttribute('data-mounted')).toBe('1');
	});
});
