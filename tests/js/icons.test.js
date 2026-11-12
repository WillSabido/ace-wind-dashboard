const { ICONS, BUILT_IN, resolveIcon, safeImageUrl } = require('../../src/reading/icons');
const { METRICS } = require('../../src/reading/metrics');
const fs = require('fs');
const path = require('path');

describe('built-in icons', () => {
	test('there are five, each a valid-looking 64x64 decorative SVG', () => {
		expect(BUILT_IN).toEqual(['turbine', 'wind', 'compass', 'bolt', 'gauge']);
		BUILT_IN.forEach((n) => {
			const svg = ICONS[n];
			expect(svg.startsWith('<svg')).toBe(true);
			expect(svg.endsWith('</svg>')).toBe(true);
			expect(svg).toContain('viewBox="0 0 64 64"');
			expect(svg).toContain('aria-hidden="true"');
			expect(svg).toContain('acewd-ico--' + n);
			const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
			expect(doc.querySelector('parsererror')).toBeNull();
		});
	});

	test('they are drawn in currentColor so the icon colour setting works, and contain nothing executable', () => {
		BUILT_IN.forEach((n) => {
			expect(ICONS[n]).toContain('currentColor');
			expect(ICONS[n]).not.toMatch(/<script|on\w+=|javascript:|href=/i);
		});
	});

	test('each has the element its animation targets', () => {
		expect(ICONS.turbine).toContain('class="acewd-blades"');
		expect(ICONS.turbine.match(/rotate\(\d+ 32 24\)/g)).toHaveLength(2);   // three blades, 120 degrees apart
		expect(ICONS.wind).toContain('class="acewd-flow"');
		expect(ICONS.compass).toContain('class="acewd-needle"');
		expect(ICONS.bolt).toContain('class="acewd-bolt"');
		expect(ICONS.gauge).toContain('class="acewd-arc"');
		expect(ICONS.gauge).toContain('class="acewd-gneedle"');
	});

	test('the stylesheet animates every hook the icons expose', () => {
		const css = fs.readFileSync(path.join(__dirname, '../../src/reading/style.css'), 'utf8');
		['.acewd-blades', '.acewd-flow', '.acewd-needle', '.acewd-bolt', '.acewd-arc', '.acewd-gneedle'].forEach((hook) => expect(css).toContain(hook));
		['--acewd-spin', '--acewd-flow', '--acewd-deg', '--acewd-frac', '--acewd-pulse', '--acewd-glow'].forEach((v) => expect(css).toContain(v));
		expect(css).toContain('prefers-reduced-motion: reduce');
		expect(css).toContain('data-animate="0"');
	});
});

describe('resolveIcon', () => {
	test('"auto" follows the measurement', () => {
		expect(resolveIcon('auto', METRICS.power)).toBe('bolt');
		expect(resolveIcon('auto', METRICS.wind_speed)).toBe('wind');
		expect(resolveIcon('auto', METRICS.wind_direction)).toBe('compass');
		expect(resolveIcon('auto', METRICS.rotor_speed)).toBe('turbine');
		expect(resolveIcon('auto', METRICS.power_pct)).toBe('gauge');
	});
	test('an explicit choice wins', () => {
		expect(resolveIcon('turbine', METRICS.power)).toBe('turbine');
		expect(resolveIcon('none', METRICS.power)).toBe('none');
		expect(resolveIcon('image', METRICS.power)).toBe('image');
	});
});

describe('safeImageUrl', () => {
	test.each([
		['https://example.org/a.svg', 'https://example.org/a.svg'], ['http://example.org/a.png', 'http://example.org/a.png'],
		['/wp-content/uploads/a.svg', '/wp-content/uploads/a.svg'], ['  /x.png  ', '/x.png']
	])('allows %p', (u, out) => expect(safeImageUrl(u)).toBe(out));

	test.each([
		['javascript:alert(1)'], ['data:image/svg+xml;base64,AAAA'], ['//evil.example/x.svg'], ['vbscript:x'], ['file:///etc/passwd'], ['not a url'], [''], [null], [undefined]
	])('rejects %p', (u) => expect(safeImageUrl(u)).toBe(''));
});
