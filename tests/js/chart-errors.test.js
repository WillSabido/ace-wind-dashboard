/** When the data service rejects a chart request, say so in the chart's place (and don't keep retrying). */
const H = require('./helpers');
const { mount, settle, tick, choose, control, button, jsonResponse, dataResponse } = H;

const isChart = (c) => c.path === 'data' && !c.params.limit;
const chartCalls = (m) => m.fetch.chart();
const msg = (m) => m.el.querySelector('.acewd-msg');

/** The exact failure reported: the proxy relays the API's 400 as { error, code: 'ace_upstream' }. */
const rejected = (message) => jsonResponse({ error: message || 'limit must be <= 1000', code: 'ace_upstream' }, 400);

/** Fail chart requests until `ok()` says otherwise. */
function failing(status, body, state) {
	state = state || { fail: true };
	return Object.assign((c) => (isChart(c) && state.fail ? (typeof body === 'function' ? body() : body) : undefined), { state });
}

describe('a rejected request is explained in place of the chart', () => {
	test('the reported case: a 1800 s default that the API refuses (HTTP 400 ace_upstream)', async () => {
		const m = mount({ range: 1800 }, failing(400, () => rejected()));
		await settle();
		const box = msg(m);
		expect(box.classList.contains('show')).toBe(true);
		expect(box.classList.contains('is-error')).toBe(true);
		expect(box.querySelector('.acewd-msg__title').textContent).toBe('This chart can’t be shown');
		expect(box.querySelector('.acewd-msg__reason').textContent).toBe('limit must be <= 1000.');
		expect(box.querySelector('.acewd-msg__hint').textContent).toBe('Try a shorter time period or a different measurement.');
		expect(box.querySelector('.acewd-msg__tech').textContent).toBe('HTTP 400 · ace_upstream');
		expect(m.uPlot.instances).toHaveLength(0);
	});

	test('it is announced to assistive technology as an alert (plain notes stay polite status messages)', async () => {
		const m = mount({}, failing(400, () => rejected()));
		await settle();
		expect(msg(m).getAttribute('role')).toBe('alert');
	});

	test('the chart area keeps its height, so the message is visible instead of collapsing to nothing', async () => {
		const m = mount({ height: 420 }, failing(400, () => rejected()));
		await settle();
		const wrap = m.el.querySelector('.acewd-chartwrap');
		expect(wrap.style.minHeight).toBe('432px');
		expect(wrap.contains(msg(m))).toBe(true);
	});

	test('the same reserved space makes the loading message visible before the first chart', async () => {
		const m = mount({ height: 300 }, (c) => (isChart(c) ? new Promise(() => {}) : undefined));   // the chart request never answers
		await settle();
		expect(msg(m).textContent).toBe('Loading chart…');
		expect(msg(m).classList.contains('show')).toBe(true);
		expect(m.el.querySelector('.acewd-chartwrap').style.minHeight).toBe('312px');
	});

	test('the server\'s wording is shown as text, never interpreted as HTML', async () => {
		const m = mount({}, failing(400, () => rejected('<img src=x onerror=alert(1)> too big')));
		await settle();
		expect(msg(m).querySelector('img')).toBeNull();
		expect(msg(m).querySelector('.acewd-msg__reason').textContent).toBe('<img src=x onerror=alert(1)> too big.');
	});

	test.each([
		['ace_too_many', 'That period is too long for this resolution.', 'Try a shorter time period.'],
		['ace_bad_fields', 'Unknown measurement.', 'Try a different measurement or data set.']
	])('%s gets a tailored hint', async (code, message, hint) => {
		const m = mount({}, failing(400, () => jsonResponse({ error: message, code }, 400)));
		await settle();
		expect(msg(m).querySelector('.acewd-msg__reason').textContent).toBe(message);
		expect(msg(m).querySelector('.acewd-msg__hint').textContent).toBe(hint);
		expect(msg(m).querySelector('.acewd-msg__tech').textContent).toBe('HTTP 400 · ' + code);
	});

	test('the failure is logged for the console as before', async () => {
		mount({}, failing(400, () => rejected()));
		await settle();
		expect(console.warn).toHaveBeenCalledWith('[ACE dashboard] chart request failed:', 'HTTP 400: limit must be <= 1000', expect.objectContaining({ family: 'site_instantaneous' }));
	});
});

describe('a rejected request is not retried', () => {
	test('the identical request is not repeated, however long the page stays open', async () => {
		const m = mount({}, failing(400, () => rejected()));
		await settle();
		await tick(10 * 60 * 1000);
		expect(chartCalls(m)).toHaveLength(1);
		expect(msg(m).classList.contains('is-error')).toBe(true);
	});

	test('changing any menu tries again, and a successful chart replaces the message', async () => {
		const state = { fail: true };
		const m = mount({}, failing(400, () => rejected(), state));
		await settle();
		state.fail = false;
		choose(control(m.el, 'Time period'), 3600);
		await settle();
		expect(chartCalls(m)).toHaveLength(2);
		expect(m.uPlot.instances).toHaveLength(1);
		expect(msg(m).classList.contains('show')).toBe(false);
		expect(msg(m).classList.contains('is-error')).toBe(false);
		expect(msg(m).getAttribute('role')).toBe('status');
		expect(msg(m).querySelector('.acewd-msg__title')).toBeNull();
		await tick(60000);
		expect(chartCalls(m).length).toBeGreaterThan(2);        // live refresh works again
	});

	test('"Resume live" after the error also tries again', async () => {
		const state = { fail: true };
		const m = mount({}, failing(400, () => rejected(), state));
		await settle();
		state.fail = false;
		button(m.el, 'Pause').click();
		button(m.el, 'Resume live').click();
		await settle();
		expect(m.uPlot.instances).toHaveLength(1);
	});

	test('a rejected selection after a chart was showing replaces that chart (no stale chart behind the message)', async () => {
		const state = { fail: false };
		const m = mount({}, failing(400, () => rejected(), state));
		await settle();
		expect(m.uPlot.instances).toHaveLength(1);
		const first = m.uPlot.instances[0];
		state.fail = true;
		choose(control(m.el, 'Time period'), 86400);
		await settle();
		expect(first.destroy).toHaveBeenCalled();
		expect(msg(m).classList.contains('is-error')).toBe(true);
		expect(m.el.querySelector('.acewd-note').textContent).toBe('');
		await tick(5 * 60 * 1000);
		expect(chartCalls(m)).toHaveLength(2);
	});

	test('the CSV button has nothing to export while the error is showing', async () => {
		const state = { fail: false };
		const m = mount({}, failing(400, () => rejected(), state));
		await settle();
		state.fail = true;
		choose(control(m.el, 'Time period'), 86400);
		await settle();
		URL.createObjectURL = jest.fn();
		button(m.el, 'Download CSV').click();
		expect(URL.createObjectURL).not.toHaveBeenCalled();
		delete URL.createObjectURL;
	});

	test('an error for a selection the visitor has already moved on from is not shown', async () => {
		let release;
		let first = true;
		const m = mount({}, (c) => {
			if (!isChart(c)) return undefined;
			if (first) { first = false; return new Promise((r) => { release = () => r(rejected()); }); }
			return undefined;
		});
		await settle();
		choose(control(m.el, 'Time period'), 3600);       // while the first request is still pending
		await settle();
		release();
		await settle();
		expect(msg(m).classList.contains('is-error')).toBe(false);
		expect(m.uPlot.instances).toHaveLength(1);        // the new selection drew normally
		// ...and live refresh carries on: the stale error must not have switched polling off for the new chart.
		const n = chartCalls(m).length;
		await tick(60000);
		expect(chartCalls(m).length).toBeGreaterThan(n);
	});
});

describe('failures that are worth retrying keep their existing behaviour', () => {
	test.each([
		['server error', 502, 'The data service could not be reached.', 'Couldn’t load data – retrying… (HTTP 502: The data service could not be reached.)'],
		['rate limit', 429, 'busy', 'The data service is busy – retrying… (HTTP 429: busy)']
	])('%s: a retry note, not the in-place error, and it recovers', async (_n, status, error, text) => {
		const state = { fail: true };
		const m = mount({}, failing(status, () => jsonResponse({ error, code: 'ace_x' }, status), state));
		await settle();
		expect(msg(m).textContent).toBe(text);
		expect(msg(m).classList.contains('is-error')).toBe(false);
		expect(msg(m).getAttribute('role')).toBe('status');
		state.fail = false;
		await tick(5000);
		expect(m.uPlot.instances).toHaveLength(1);
		expect(msg(m).classList.contains('show')).toBe(false);
	});

	test('a network failure also retries', async () => {
		let n = 0;
		const m = mount({}, (c) => { if (isChart(c) && ++n === 1) throw new TypeError('Failed to fetch'); });
		await settle();
		expect(msg(m).classList.contains('is-error')).toBe(false);
		await tick(4000);
		expect(m.uPlot.instances).toHaveLength(1);
	});
});

describe('the row-limit bug (1000+ seconds of 1-second data)', () => {
	test('ranges either side of the 1000-second boundary all ask for 1-second data, with the span, and draw', async () => {
		for (const range of [999, 1000, 1001, 1800, 3000]) {
			const m = mount({ range });
			await settle();
			const p = chartCalls(m)[0].params;
			expect(p).toMatchObject({ family: 'site_instantaneous', resolution: '1s', span: String(range) });
			expect(m.uPlot.instances).toHaveLength(1);
			expect(msg(m).classList.contains('show')).toBe(false);
		}
	});

	test('the default view is no longer blank when the first answer is a rejection that a retry-free design would hide', async () => {
		// Whatever the cause, a refused default view must now say so rather than leaving an empty box.
		const m = mount({ range: 1800 }, failing(400, () => rejected('Requested window too large')));
		await settle();
		expect(m.el.querySelector('.acewd-chartwrap').textContent).toContain('Requested window too large.');
	});
});
