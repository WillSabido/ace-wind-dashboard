/** Fixtures for the live-reading tile tests. */
const H = require('./helpers');
const { NOW_S, REST, dataResponse, installFetch, makeFakeUPlot } = H;
const { DEFAULT_ATTRS } = require('../../src/reading/block-model');

const ENV = { rest: REST, ratedKw: 4200, liveRefresh: 2, tz: 'UTC' };

/** Block config (attributes + site settings). */
const config = (over) => Object.assign({}, DEFAULT_ATTRS, ENV, over || {});

const isTile = (c) => c.path === 'data' && c.params.limit;

/**
 * A fetch handler answering tile requests with the given newest readings, e.g.
 * readings({ aggregate_active_power: 1234.4, wec_rotor_speed: 12 }, { age: 0 }).
 * Fields not mentioned come back as nulls. The newest of the 5 rows carries the value.
 */
function readings(values, opts) {
	opts = opts || {};
	return (c) => {
		if (!isTile(c)) return undefined;
		const fields = c.params.fields.split(',');
		const col = (f) => {
			const v = values[f];
			return Array.isArray(v) ? v : [null, null, null, null, v === undefined ? null : v];
		};
		const series = {};
		fields.forEach((f) => { series[f] = col(f); });
		return dataResponse(c.params.family, c.params.resolution, fields, { rows: 5, end: NOW_S - (opts.age || 0), values: series });
	};
}

/** Load a fresh copy of the reading modules and mount one tile into a new host element. */
function mountTile(cfgOver, handler, doc) {
	const d = doc || document;
	const host = d.createElement('div');
	host.className = 'acewd-reading';
	d.body.appendChild(host);
	const fetch = installFetch(handler);
	let api;
	jest.isolateModules(() => {
		api = Object.assign({}, require('../../src/reading/reading-view'), { hubs: require('../../src/reading/readings') });
	});
	const mounted = api.mountReading(host, config(cfgOver));
	return { host, fetch, api, mounted, root: () => host.querySelector('.acewd-r') };
}

/** Text helpers for a mounted tile. */
const text = (host, cls) => { const e = host.querySelector('.acewd-r__' + cls); return e ? e.textContent : null; };
const valueText = (host) => { const e = host.querySelector('.acewd-r__value'); return e ? e.firstChild.textContent : null; };
const unitText = (host) => { const e = host.querySelector('.acewd-r__unit'); return e ? e.textContent : null; };
const iconVar = (host, name) => { const i = host.querySelector('.acewd-r__icon'); return i ? i.style.getPropertyValue(name) : null; };

module.exports = { ENV, config, readings, mountTile, isTile, text, valueText, unitText, iconVar };
