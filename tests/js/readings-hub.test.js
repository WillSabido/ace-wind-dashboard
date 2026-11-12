/** The shared poller behind every live-reading tile. */
const H = require('./helpers');
const { settle, tick, jsonResponse, dataResponse, NOW_S, REST, installFetch } = H;
const { isTile } = require('./reading-helpers');

function load() {
	let m;
	jest.isolateModules(() => { m = require('../../src/reading/readings'); });
	return m;
}
const tileCalls = (f) => f.calls.filter(isTile);
const sub = (hub, family, field, cb) => hub.subscribe(family, field, cb || jest.fn());

describe('requests', () => {
	test('one request for the data set: newest 5 1-second rows, cache-busted, no asset for site data', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power');
		await settle();
		expect(tileCalls(f)).toHaveLength(1);
		expect(tileCalls(f)[0].params).toEqual({ family: 'site_instantaneous', resolution: '1s', limit: '5', fields: 'aggregate_active_power' });
		expect(tileCalls(f)[0].bucket).toBe(NOW_S);
	});

	test('asset-scoped data sets send the first asset', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 2), 'wec_instantaneous', 'wec_rotor_speed');
		await settle();
		expect(tileCalls(f)[0].params).toMatchObject({ family: 'wec_instantaneous', asset: 'wec1' });
	});

	test('tiles reading the same data set share one request carrying the union of their fields', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		sub(hub, 'site_instantaneous', 'aggregate_active_power');
		sub(hub, 'site_instantaneous', 'aggregate_wind_speed');
		sub(hub, 'site_instantaneous', 'aggregate_active_power');        // a second tile on the same field
		await settle();
		expect(tileCalls(f)).toHaveLength(1);
		expect(tileCalls(f)[0].params.fields).toBe('aggregate_active_power,aggregate_wind_speed');
	});

	test('different data sets are polled separately', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		sub(hub, 'site_instantaneous', 'aggregate_active_power');
		sub(hub, 'wec_instantaneous', 'wec_rotor_speed');
		await settle();
		expect(tileCalls(f).map((c) => c.params.family).sort()).toEqual(['site_instantaneous', 'wec_instantaneous']);
	});

	test('the catalogue is fetched once however many data sets are used', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		sub(hub, 'site_instantaneous', 'aggregate_active_power');
		sub(hub, 'wec_instantaneous', 'wec_rotor_speed');
		await settle();
		await tick(2000);
		expect(f.calls.filter((c) => c.path === 'catalogue')).toHaveLength(1);
	});

	test('data sets without 1-second data use their finest resolution', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 2), 'wecstd', 'wind_speed_mean');
		await settle();
		expect(tileCalls(f)[0].params).toMatchObject({ family: 'wecstd', resolution: '60s', asset: 'wec1' });
	});
});

describe('delivery', () => {
	test('subscribers get their newest non-null value, its time, and the newest time overall', async () => {
		installFetch((c) => (isTile(c) ? dataResponse(c.params.family, '1s', ['aggregate_active_power', 'aggregate_wind_speed'], {
			rows: 3, end: NOW_S, values: { aggregate_active_power: [1, 2, null], aggregate_wind_speed: [7, null, null] } }) : undefined));
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		const a = jest.fn(), b = jest.fn();
		sub(hub, 'site_instantaneous', 'aggregate_active_power', a);
		sub(hub, 'site_instantaneous', 'aggregate_wind_speed', b);
		await settle();
		const u = a.mock.calls[0][0];
		expect(u.error).toBeNull();
		expect(u.values.aggregate_active_power).toEqual({ v: 2, t: NOW_S - 1 });
		expect(u.values.aggregate_wind_speed).toEqual({ v: 7, t: NOW_S - 2 });
		expect(u.newest).toBe(NOW_S - 1);
		expect(b).toHaveBeenCalledTimes(1);
	});

	test('a field with no readings is delivered as null', async () => {
		installFetch((c) => (isTile(c) ? dataResponse(c.params.family, '1s', ['aggregate_active_power'], { rows: 2, values: { aggregate_active_power: [null, null] } }) : undefined));
		const { ReadingHub } = load();
		const cb = jest.fn();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power', cb);
		await settle();
		expect(cb.mock.calls[0][0]).toMatchObject({ values: { aggregate_active_power: null }, newest: null, error: null });
	});

	test('a tile added later on a known field gets the latest values at once, without another request', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		sub(hub, 'site_instantaneous', 'aggregate_active_power');
		await settle();
		const late = jest.fn();
		sub(hub, 'site_instantaneous', 'aggregate_active_power', late);
		await settle();
		expect(late).toHaveBeenCalledTimes(1);
		expect(tileCalls(f)).toHaveLength(1);
	});

	test('a tile added later on a NEW field triggers a request that includes it', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		sub(hub, 'site_instantaneous', 'aggregate_active_power');
		await settle();
		const late = jest.fn();
		sub(hub, 'site_instantaneous', 'aggregate_wind_speed', late);
		await settle();
		expect(tileCalls(f)).toHaveLength(2);
		expect(tileCalls(f)[1].params.fields).toBe('aggregate_active_power,aggregate_wind_speed');
		expect(late.mock.calls.pop()[0].values.aggregate_wind_speed).not.toBeUndefined();
	});
});

describe('cadence', () => {
	test('1-second data repeats every liveRefresh seconds', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 3), 'site_instantaneous', 'aggregate_active_power');
		await settle();
		await tick(2999);
		expect(tileCalls(f)).toHaveLength(1);
		await tick(1);
		expect(tileCalls(f)).toHaveLength(2);
		expect(tileCalls(f)[1].bucket).toBe(NOW_S + 3);   // each poll has a fresh URL
	});

	test('slower data uses its recommended refresh (at least 5 s)', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 2), 'wecstd', 'wind_speed_mean');
		await settle();
		await tick(59000);
		expect(tileCalls(f)).toHaveLength(1);
		await tick(1000);
		expect(tileCalls(f)).toHaveLength(2);
	});

	test('unsubscribing the last tile stops polling; one of several keeps it going', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		const off1 = sub(hub, 'site_instantaneous', 'aggregate_active_power');
		const off2 = sub(hub, 'site_instantaneous', 'aggregate_wind_speed');
		await settle();
		off1();
		await tick(2000);
		expect(tileCalls(f)).toHaveLength(2);
		off2();
		await tick(20000);
		expect(tileCalls(f)).toHaveLength(2);
	});

	test('an unsubscribed tile is never called again', async () => {
		installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		const cb = jest.fn();
		const off = sub(hub, 'site_instantaneous', 'aggregate_active_power', cb);
		await settle();
		off();
		await tick(10000);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	test('a hidden tab skips polls; becoming visible polls every data set immediately', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		sub(hub, 'site_instantaneous', 'aggregate_active_power');
		sub(hub, 'wec_instantaneous', 'wec_rotor_speed');
		await settle();
		const before = tileCalls(f).length;
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
		await tick(10000);
		expect(tileCalls(f)).toHaveLength(before);
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(tileCalls(f)).toHaveLength(before + 2);
		await tick(2000);
		expect(tileCalls(f).length).toBeGreaterThan(before + 2);   // and the loop carries on
	});
});

describe('edge cases', () => {
	test('a visibility event while the tab is still hidden does not poll', async () => {
		const f = installFetch();
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power');
		await settle();
		const n = tileCalls(f).length;
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(tileCalls(f)).toHaveLength(n);
	});

	test('becoming visible while a request is already in flight does not start a second one', async () => {
		let release;
		const f = installFetch((c) => (isTile(c) ? new Promise((r) => { release = () => r(dataResponse(c.params.family, '1s', c.params.fields.split(','), { rows: 1 })); }) : undefined));
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power');
		await settle();
		expect(tileCalls(f)).toHaveLength(1);                 // pending
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(tileCalls(f)).toHaveLength(1);
		release();
		await settle();
	});

	test('removing the last tile while its request is in flight: no callback and no further polling', async () => {
		let release;
		const f = installFetch((c) => (isTile(c) ? new Promise((r) => { release = () => r(dataResponse(c.params.family, '1s', c.params.fields.split(','), { rows: 1 })); }) : undefined));
		const { ReadingHub } = load();
		const cb = jest.fn();
		const off = sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power', cb);
		await settle();
		off();
		release();
		await settle();
		await tick(30000);
		expect(cb).not.toHaveBeenCalled();
		expect(tileCalls(f)).toHaveLength(1);
	});

	test('a request that fails after the last tile left does not reschedule either', async () => {
		let fail;
		const f = installFetch((c) => (isTile(c) ? new Promise((r) => { fail = () => r(jsonResponse({ error: 'x' }, 500)); }) : undefined));
		const { ReadingHub } = load();
		const off = sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power');
		await settle();
		off();
		fail();
		await settle();
		await tick(60000);
		expect(tileCalls(f)).toHaveLength(1);
	});
});

describe('failures', () => {
	const failing = (n, status, headers) => {
		let count = 0;
		return (c) => (isTile(c) && ++count <= n ? jsonResponse({ error: 'upstream down' }, status || 502, headers) : undefined);
	};

	test('subscribers are told, with the reason', async () => {
		installFetch(failing(1));
		const { ReadingHub } = load();
		const cb = jest.fn();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power', cb);
		await settle();
		expect(cb.mock.calls[0][0]).toEqual({ values: {}, newest: null, error: 'upstream down' });
		expect(console.warn).toHaveBeenCalledWith('[ACE dashboard] live reading failed:', 'HTTP 502: upstream down');
	});

	test('retries with exponential back-off, then recovers', async () => {
		const f = installFetch(failing(2));
		const { ReadingHub } = load();
		const cb = jest.fn();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power', cb);
		await settle();
		await tick(3999);                                  // 2 s x 2^1
		expect(tileCalls(f)).toHaveLength(1);
		await tick(1);
		expect(tileCalls(f)).toHaveLength(2);              // fails again
		await tick(7999);                                  // 2 s x 2^2
		expect(tileCalls(f)).toHaveLength(2);
		await tick(1);
		expect(tileCalls(f)).toHaveLength(3);              // succeeds
		expect(cb.mock.calls.pop()[0].error).toBeNull();
		await tick(2000);
		expect(tileCalls(f)).toHaveLength(4);              // normal cadence
	});

	test('honours Retry-After', async () => {
		const f = installFetch(failing(1, 429, { 'Retry-After': '30' }));
		const { ReadingHub } = load();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power');
		await settle();
		await tick(29999);
		expect(tileCalls(f)).toHaveLength(1);
		await tick(1);
		expect(tileCalls(f)).toHaveLength(2);
	});

	test('an error is not remembered: a tile added afterwards waits for real data', async () => {
		installFetch(failing(1));
		const { ReadingHub } = load();
		const hub = new ReadingHub(REST, 2);
		sub(hub, 'site_instantaneous', 'aggregate_active_power');
		await settle();
		const late = jest.fn();
		sub(hub, 'site_instantaneous', 'aggregate_active_power', late);
		await settle();
		expect(late).not.toHaveBeenCalled();
	});

	test('a data set missing from the catalogue is reported, not thrown', async () => {
		installFetch();
		const { ReadingHub } = load();
		const cb = jest.fn();
		sub(new ReadingHub(REST, 2), 'no_such_family', 'x', cb);
		await settle();
		expect(cb.mock.calls[0][0].error).toBe('Unknown data set: no_such_family');
	});

	test('if the catalogue cannot be loaded subscribers are told', async () => {
		installFetch((c) => (c.path === 'catalogue' ? jsonResponse({ error: 'no catalogue' }, 502) : undefined));
		const { ReadingHub } = load();
		const cb = jest.fn();
		sub(new ReadingHub(REST, 2), 'site_instantaneous', 'aggregate_active_power', cb);
		await settle();
		expect(cb.mock.calls[0][0].error).toBe('no catalogue');
	});
});

describe('hubFor', () => {
	test('returns one hub per REST base', () => {
		const { hubFor } = load();
		expect(hubFor(REST, 2)).toBe(hubFor(REST, 9));
		expect(hubFor('https://other.test/wp-json/ace-wind/v1/', 2)).not.toBe(hubFor(REST, 2));
	});
});
