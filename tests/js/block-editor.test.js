/** The block editor UI, run against a tiny fake of the wp.* globals (components are plain strings in the tree). */
const H = require('./helpers');
const { mount, settle } = H;
const M = require('../../src/reading/block-model');

const ENV = { rest: H.REST, ratedKw: 4200, liveRefresh: 2, tz: 'UTC' };

/** Fake wp: createElement builds {type, props, children}; hooks are controllable. */
function fakeWp(opts) {
	opts = opts || {};
	const registered = [];
	const effects = [];
	const setStates = [];
	const wp = {
		blocks: { registerBlockType: jest.fn((name, settings) => registered.push({ name, settings })) },
		element: {
			createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== false && c != null) }),
			Fragment: 'Fragment',
			useRef: () => opts.ref || { current: null },
			useEffect: (fn, deps) => effects.push({ fn, deps }),
			useState: (init) => { const setter = jest.fn(); setStates.push(setter); return [opts.cat !== undefined ? opts.cat : init, setter]; }
		},
		blockEditor: { InspectorControls: 'InspectorControls', useBlockProps: () => ({ className: 'wp-block-ace-wind-live-reading' }),
			MediaUpload: 'MediaUpload', MediaUploadCheck: 'MediaUploadCheck', PanelColorSettings: 'PanelColorSettings' },
		components: { PanelBody: 'PanelBody', SelectControl: 'SelectControl', ToggleControl: 'ToggleControl', TextControl: 'TextControl', RangeControl: 'RangeControl', Button: 'Button' },
		i18n: { __: (s) => s }
	};
	return { wp, registered, effects, setStates };
}

function walk(node, fn) {
	if (!node || typeof node !== 'object') return;
	fn(node);
	(node.children || []).forEach((c) => walk(c, fn));
	if (node.props && typeof node.props.render === 'function') walk(node.props.render({ open: jest.fn() }), fn);
}
const all = (tree, type) => { const out = []; walk(tree, (n) => { if (n.type === type) out.push(n); }); return out; };
const control = (tree, type, label) => all(tree, type).find((n) => n.props.label === label);

function render(attrs, wpOpts) {
	const f = fakeWp(wpOpts);
	// A fresh copy of the modules each time, so the shared catalogue cache never leaks between tests.
	jest.isolateModules(() => { require('../../src/reading/editor').registerBlock(f.wp, ENV); });
	const settings = f.registered[0].settings;
	const setAttributes = jest.fn();
	const tree = settings.edit({ attributes: attrs || {}, setAttributes });
	return Object.assign(f, { tree, setAttributes, settings });
}

describe('registration', () => {
	test('registers ace-wind/live-reading with an edit function and a null save (server-rendered)', () => {
		const f = fakeWp();
		require('../../src/reading/editor').registerBlock(f.wp, ENV);
		expect(f.registered).toHaveLength(1);
		expect(f.registered[0].name).toBe('ace-wind/live-reading');
		expect(typeof f.registered[0].settings.edit).toBe('function');
		expect(f.registered[0].settings.save()).toBeNull();
		expect(Object.keys(f.registered[0].settings).sort()).toEqual(['edit', 'save']);   // title/attributes/supports come from block.json
	});

	test('the entry point registers only when wp exists, using the printed site settings', () => {
		delete window.wp;
		jest.isolateModules(() => { require('../../src/reading/editor-main'); });   // no wp: must not throw
		const f = fakeWp();
		window.wp = f.wp;
		window.ACE_WIND_BLOCK = { ...ENV, ratedKw: 2500 };
		jest.isolateModules(() => { require('../../src/reading/editor-main'); });
		expect(f.registered).toHaveLength(1);
		delete window.wp; delete window.ACE_WIND_BLOCK;
	});
});

describe('layout of the editor', () => {
	test('block wrapper (with block props) containing the live tile host, plus two inspector panels', () => {
		const e = render();
		const panels = all(e.tree, 'PanelBody');
		expect(panels.map((p) => p.props.title)).toEqual(['Reading', 'Icon']);
		expect(all(e.tree, 'InspectorControls')).toHaveLength(1);
		const wrapper = e.tree.children.find((c) => c.type === 'div');
		expect(wrapper.props.className).toBe('wp-block-ace-wind-live-reading');
		expect(wrapper.children[0].props.className).toBe('acewd-reading');
	});
});

describe('Reading panel', () => {
	test('Measurement lists the presets plus "Other measurement…" and resets dependent settings when changed', () => {
		const e = render({ metric: 'power' });
		const sel = control(e.tree, 'SelectControl', 'Measurement');
		expect(sel.props.options).toEqual(M.METRIC_OPTIONS);
		expect(sel.props.value).toBe('power');
		sel.props.onChange('wind_speed');
		expect(e.setAttributes).toHaveBeenCalledWith({ metric: 'wind_speed', unit: '', family: '', field: '' });
	});

	test('Unit appears only when there is a choice and sets the unit', () => {
		let e = render({ metric: 'wind_speed' });
		const unit = control(e.tree, 'SelectControl', 'Unit');
		expect(unit.props.options.map((o) => o.value)).toEqual(['m/s', 'mph', 'km/h', 'knots']);
		expect(unit.props.value).toBe('m/s');                // first unit when none chosen
		unit.props.onChange('knots');
		expect(e.setAttributes).toHaveBeenCalledWith({ unit: 'knots' });
		expect(control(render({ metric: 'wind_speed', unit: 'mph' }).tree, 'SelectControl', 'Unit').props.value).toBe('mph');
		expect(control(render({ metric: 'wind_direction' }).tree, 'SelectControl', 'Unit')).toBeUndefined();
	});

	test('direction format appears only for wind direction', () => {
		const e = render({ metric: 'wind_direction' });
		const f = control(e.tree, 'SelectControl', 'Show direction as');
		expect(f.props.options).toEqual(M.DIRECTION_OPTIONS);
		f.props.onChange('compass');
		expect(e.setAttributes).toHaveBeenCalledWith({ directionFormat: 'compass' });
		expect(control(render({ metric: 'power' }).tree, 'SelectControl', 'Show direction as')).toBeUndefined();
	});

	test('decimal places: -1 is automatic, clearing the control returns to automatic', () => {
		const e = render({ decimals: 2 });
		const r = control(e.tree, 'RangeControl', 'Decimal places');
		expect([r.props.min, r.props.max, r.props.value]).toEqual([-1, 3, 2]);
		r.props.onChange(1);
		expect(e.setAttributes).toHaveBeenLastCalledWith({ decimals: 1 });
		r.props.onChange(undefined);
		expect(e.setAttributes).toHaveBeenLastCalledWith({ decimals: -1 });
		expect(r.props.renderTooltipContent(-1)).toBe('Automatic');
	});

	test('toggles write their attribute', () => {
		const e = render({ showLabel: true, showDetail: true, showUpdated: false });
		[['Show label', 'showLabel', false], ['Show extra detail line', 'showDetail', false], ['Show time of last reading', 'showUpdated', true]].forEach(([label, key, next]) => {
			const t = control(e.tree, 'ToggleControl', label);
			t.props.onChange(next);
			expect(e.setAttributes).toHaveBeenLastCalledWith({ [key]: next });
		});
		expect(control(e.tree, 'ToggleControl', 'Show time of last reading').props.checked).toBe(false);
	});

	test('the Label field shows only while the label is shown', () => {
		const e = render({ showLabel: true });
		const t = control(e.tree, 'TextControl', 'Label');
		t.props.onChange('Our turbine');
		expect(e.setAttributes).toHaveBeenCalledWith({ label: 'Our turbine' });
		expect(control(render({ showLabel: false }).tree, 'TextControl', 'Label')).toBeUndefined();
	});
});

describe('Other measurement', () => {
	test('shows a loading data-set menu until the catalogue arrives', () => {
		const e = render({ metric: 'custom' });
		const ds = control(e.tree, 'SelectControl', 'Data set');
		expect(ds.props.options).toEqual([{ value: '', label: 'Loading…' }]);
		expect(control(e.tree, 'SelectControl', 'Value')).toBeUndefined();
	});

	test('with the catalogue: lists data sets; choosing one picks its first field', () => {
		const e = render({ metric: 'custom' }, { cat: H.catalogue() });
		const ds = control(e.tree, 'SelectControl', 'Data set');
		expect(ds.props.options[0]).toEqual({ value: '', label: 'Choose…' });
		expect(ds.props.options.slice(1).map((o) => o.value)).toEqual(H.catalogue().families.map((f) => f.family));
		ds.props.onChange('wecstd');
		expect(e.setAttributes).toHaveBeenCalledWith({ family: 'wecstd', field: 'aggregate_active_power' });
	});

	test('the Value menu appears once a data set is chosen', () => {
		const e = render({ metric: 'custom', family: 'wecstd', field: 'wind_speed_mean' }, { cat: H.catalogue() });
		const v = control(e.tree, 'SelectControl', 'Value');
		expect(v.props.options.map((o) => o.label)).toEqual(['Mean active power (kW)', 'Mean wind speed (m/s)']);
		expect(v.props.value).toBe('wind_speed_mean');
		v.props.onChange('aggregate_active_power');
		expect(e.setAttributes).toHaveBeenCalledWith({ field: 'aggregate_active_power' });
	});

	test('the data-set and value menus are not shown for preset measurements', () => {
		const e = render({ metric: 'power' }, { cat: H.catalogue() });
		expect(control(e.tree, 'SelectControl', 'Data set')).toBeUndefined();
	});
});

describe('Icon panel', () => {
	test('icon, layout, size and animation controls', () => {
		const e = render({ icon: 'auto', layout: 'left', iconSize: 56, animate: true });
		expect(control(e.tree, 'SelectControl', 'Icon').props.options).toEqual(M.ICON_OPTIONS);
		control(e.tree, 'SelectControl', 'Icon').props.onChange('turbine');
		expect(e.setAttributes).toHaveBeenLastCalledWith({ icon: 'turbine' });
		expect(control(e.tree, 'SelectControl', 'Layout').props.options).toEqual(M.LAYOUT_OPTIONS);
		control(e.tree, 'SelectControl', 'Layout').props.onChange('background');
		expect(e.setAttributes).toHaveBeenLastCalledWith({ layout: 'background' });
		const size = control(e.tree, 'RangeControl', 'Icon size');
		expect([size.props.min, size.props.max, size.props.value]).toEqual([24, 160, 56]);
		size.props.onChange(96);
		expect(e.setAttributes).toHaveBeenLastCalledWith({ iconSize: 96 });
		size.props.onChange(undefined);
		expect(e.setAttributes).toHaveBeenLastCalledWith({ iconSize: 56 });
		control(e.tree, 'ToggleControl', 'Animate the icon').props.onChange(false);
		expect(e.setAttributes).toHaveBeenLastCalledWith({ animate: false });
	});

	test('"No icon" hides everything about icons except the choice itself', () => {
		const e = render({ icon: 'none' });
		['Layout'].forEach((l) => expect(control(e.tree, 'SelectControl', l)).toBeUndefined());
		expect(control(e.tree, 'RangeControl', 'Icon size')).toBeUndefined();
		expect(control(e.tree, 'ToggleControl', 'Animate the icon')).toBeUndefined();
		expect(all(e.tree, 'PanelColorSettings')).toHaveLength(0);
		expect(control(e.tree, 'SelectControl', 'Icon')).toBeDefined();
	});

	test('icon colour: offered for built-in icons, writes a hex colour, clears to empty', () => {
		const e = render({ icon: 'auto', iconColor: '#1f8a4c' });
		const pcs = all(e.tree, 'PanelColorSettings')[0];
		expect(pcs.props.colorSettings[0].value).toBe('#1f8a4c');
		pcs.props.colorSettings[0].onChange('#e07b00');
		expect(e.setAttributes).toHaveBeenLastCalledWith({ iconColor: '#e07b00' });
		pcs.props.colorSettings[0].onChange(undefined);
		expect(e.setAttributes).toHaveBeenLastCalledWith({ iconColor: '' });
	});

	test('custom image: media library picker, preview, replace and remove', () => {
		let e = render({ icon: 'image', iconUrl: '' });
		expect(all(e.tree, 'MediaUploadCheck')).toHaveLength(1);
		const mu = all(e.tree, 'MediaUpload')[0];
		expect(mu.props.allowedTypes).toEqual(['image']);
		mu.props.onSelect({ url: 'https://example.org/t.svg' });
		expect(e.setAttributes).toHaveBeenCalledWith({ iconUrl: 'https://example.org/t.svg' });
		expect(all(e.tree, 'Button').map((b) => b.children[0])).toEqual(['Choose image or SVG']);
		expect(all(e.tree, 'PanelColorSettings')).toHaveLength(0);   // colour doesn't apply to an image

		e = render({ icon: 'image', iconUrl: 'https://example.org/t.svg' });
		expect(all(e.tree, 'Button').map((b) => b.children[0])).toEqual(['Replace image', 'Remove']);
		expect(all(e.tree, 'img')[0].props.src).toBe('https://example.org/t.svg');
		all(e.tree, 'Button')[1].props.onClick();
		expect(e.setAttributes).toHaveBeenCalledWith({ iconUrl: '' });
	});

	test('the media picker is not shown for other icons', () => {
		expect(all(render({ icon: 'turbine' }).tree, 'MediaUpload')).toHaveLength(0);
	});
});

describe('live preview', () => {
	test('mounts the real tile into the host and removes it on cleanup', async () => {
		const host = document.createElement('div');
		document.body.appendChild(host);
		H.installFetch();
		const e = render({ metric: 'wind_speed', layout: 'top' }, { ref: { current: host } });
		const preview = e.effects[0];
		const cleanup = preview.fn();
		expect(host.querySelector('.acewd-r--top')).not.toBeNull();
		await settle();
		expect(host.querySelector('.acewd-r__label').textContent).toBe('Wind speed');
		cleanup();
		expect(host.innerHTML).toBe('');
	});

	test('re-runs whenever any setting changes (the effect depends on all attributes)', () => {
		const a = render({ metric: 'power' }).effects[0].deps[0];
		const b = render({ metric: 'power', iconSize: 99 }).effects[0].deps[0];
		const c = render({ metric: 'power' }).effects[0].deps[0];
		expect(a).not.toBe(b);
		expect(a).toBe(c);
	});

	test('does nothing if there is no host element yet', () => {
		const e = render({}, { ref: { current: null } });
		expect(e.effects[0].fn()).toBeUndefined();
	});

	test('uses the site settings (REST URL, rated power) given by PHP', async () => {
		const host = document.createElement('div');
		document.body.appendChild(host);
		const f = H.installFetch();
		render({}, { ref: { current: host } }).effects[0].fn();
		await settle();
		expect(f.calls[0].url.startsWith(H.REST)).toBe(true);
	});

	test('the catalogue is fetched only for "Other measurement", then stored', async () => {
		const f = H.installFetch();
		let e = render({ metric: 'power' });
		e.effects[1].fn();
		await settle();
		expect(f.calls.filter((c) => c.path === 'catalogue')).toHaveLength(0);

		e = render({ metric: 'custom' });
		e.effects[1].fn();
		await settle();
		expect(f.calls.filter((c) => c.path === 'catalogue')).toHaveLength(1);
		expect(e.setStates[0]).toHaveBeenCalledWith(expect.objectContaining({ site: 'ace' }));

		const before = f.calls.length;
		render({ metric: 'custom' }, { cat: H.catalogue() }).effects[1].fn();   // already loaded
		await settle();
		expect(f.calls).toHaveLength(before);
	});

	test('a catalogue failure in the editor is swallowed (the menu just stays on "Loading…")', async () => {
		H.installFetch((c) => (c.path === 'catalogue' ? H.jsonResponse({ error: 'x' }, 502) : undefined));
		const e = render({ metric: 'custom' });
		e.effects[1].fn();
		await expect(settle()).resolves.toBeUndefined();
		expect(e.setStates[0]).not.toHaveBeenCalled();
	});
});
