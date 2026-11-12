import type { BuiltInIcon, IconName } from './types';
import type { MetricSpec } from './metrics';

/**
 * Built-in icons: 64x64, drawn in currentColor, with hooks (classes) the stylesheet animates.
 * CSS variables set by the view: --acewd-spin, --acewd-flow, --acewd-deg, --acewd-frac, --acewd-pulse, --acewd-glow.
 */
const open = (name: string): string =>
	'<svg class="acewd-ico acewd-ico--' + name + '" viewBox="0 0 64 64" aria-hidden="true" focusable="false">';

const BLADE = 'M32 22C30 14 31 6 32 3c1 3 2 11 0 19z';

export const ICONS: Readonly<Record<BuiltInIcon, string>> = {
	turbine:
		open('turbine') +
		'<path d="M30.5 27h3L35 62H29z" fill="currentColor" opacity=".55"/>' +
		'<g class="acewd-blades" fill="currentColor">' +
		'<path d="' + BLADE + '"/>' +
		'<path d="' + BLADE + '" transform="rotate(120 32 24)"/>' +
		'<path d="' + BLADE + '" transform="rotate(240 32 24)"/>' +
		'</g><circle cx="32" cy="24" r="3.2" fill="currentColor"/></svg>',
	wind:
		open('wind') +
		'<g class="acewd-flow" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round">' +
		'<path d="M6 22h30a7 7 0 1 0-7-7"/><path d="M6 34h44a8 8 0 1 1-8 8"/><path d="M6 46h20"/>' +
		'</g></svg>',
	compass:
		open('compass') +
		'<circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="3" opacity=".45"/>' +
		'<path d="M32 4v6M32 54v6M4 32h6M54 32h6" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".6"/>' +
		'<g class="acewd-needle"><path d="M32 11l8 21H24z" fill="currentColor"/>' +
		'<path d="M32 53l-8-21h16z" fill="currentColor" opacity=".3"/></g></svg>',
	bolt:
		open('bolt') +
		'<path class="acewd-bolt" d="M37 3L13 36h15l-4 25 27-35H35z" fill="currentColor"/></svg>',
	gauge:
		open('gauge') +
		'<path d="M8 46a24 24 0 0 1 48 0" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity=".25"/>' +
		'<path class="acewd-arc" d="M8 46a24 24 0 0 1 48 0" pathLength="100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>' +
		'<g class="acewd-gneedle"><path d="M32 46V26" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>' +
		'<circle cx="32" cy="46" r="4.5" fill="currentColor"/></g></svg>'
};

export const BUILT_IN: readonly BuiltInIcon[] = ['turbine', 'wind', 'compass', 'bolt', 'gauge'];

/** Which icon to show for a block: "auto" follows the measurement; "none" and "image" are handled by the view. */
export function resolveIcon(icon: IconName, spec: Pick<MetricSpec, 'icon'>): IconName {
	return icon === 'auto' ? spec.icon : icon;
}

/** Only http(s) and site-relative URLs may be used for a custom image. */
export function safeImageUrl(url: string): string {
	const u = String(url || '').trim();
	if (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u)) return u;
	return '';
}
