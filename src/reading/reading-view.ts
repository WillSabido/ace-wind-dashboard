import { catalogue } from '../api';
import type { FieldInfo } from '../types';
import { hIn, nowSeconds } from '../util';
import { BUILT_IN, ICONS, resolveIcon, safeImageUrl } from './icons';
import type { MetricSpec } from './metrics';
import { CUSTOM, computeDisplay, customSpec, METRICS } from './metrics';
import type { ReadingHub, Update } from './readings';
import { hubFor } from './readings';
import type { ReadingConfig } from './types';

export interface Mounted {
	destroy(): void;
}

export interface MountOptions {
	hub?: ReadingHub;
	/** Current Unix seconds; a parameter so tests can control it. */
	now?: () => number;
}

/**
 * Build a live-reading tile inside `host` and keep it updated until destroy() is called.
 * The same function runs on the front end and inside the block editor, so the editor preview is exact.
 */
export function mountReading(host: HTMLElement, cfg: ReadingConfig, opts: MountOptions = {}): Mounted {
	const doc = host.ownerDocument || document;
	const hub = opts.hub || hubFor(cfg.rest, cfg.liveRefresh);
	const now = opts.now || nowSeconds;
	let unsubscribe: (() => void) | null = null;
	let destroyed = false;
	let spec: MetricSpec | null = METRICS[cfg.metric] || null;

	// ---- host-level settings ----
	host.innerHTML = '';
	host.setAttribute('data-animate', cfg.animate ? '1' : '0');
	host.style.setProperty('--acewd-icon-size', cfg.iconSize + 'px');
	if (cfg.iconColor) host.style.setProperty('--acewd-icon-color', cfg.iconColor);

	// ---- markup ----
	const root = hIn(doc, 'div', { class: 'acewd-r acewd-r--' + cfg.layout });
	host.appendChild(root);

	const iconName = cfg.icon;
	let iconEl: HTMLElement | null = null;
	const placeIcon = (name: string): void => {
		if (iconEl) iconEl.remove();
		iconEl = null;
		if (name === 'none') return;
		const box = hIn(doc, 'div', { class: 'acewd-r__icon' });
		if (name === 'image') {
			const url = safeImageUrl(cfg.iconUrl);
			if (!url) return;
			box.appendChild(hIn(doc, 'img', { src: url, alt: '', class: 'acewd-r__img' }));
		} else if ((BUILT_IN as readonly string[]).indexOf(name) >= 0) {
			box.innerHTML = ICONS[name as keyof typeof ICONS];
		} else {
			return;
		}
		iconEl = box;
		root.insertBefore(box, root.firstChild);
	};

	const body = hIn(doc, 'div', { class: 'acewd-r__body' });
	const labelEl = cfg.showLabel ? hIn(doc, 'div', { class: 'acewd-r__label' }) : null;
	const valueEl = hIn(doc, 'div', { class: 'acewd-r__value', 'aria-live': 'off' });
	const unitEl = hIn(doc, 'small', { class: 'acewd-r__unit' });
	const valueText = doc.createTextNode('–');
	valueEl.appendChild(valueText);
	valueEl.appendChild(unitEl);
	const detailEl = cfg.showDetail ? hIn(doc, 'div', { class: 'acewd-r__detail' }) : null;
	const updatedEl = cfg.showUpdated ? hIn(doc, 'div', { class: 'acewd-r__updated' }) : null;
	[labelEl, valueEl, detailEl, updatedEl].forEach((e) => { if (e) body.appendChild(e); });
	root.appendChild(body);

	// Placeholder until the measurement is known.
	if (labelEl) labelEl.textContent = cfg.label || (spec ? spec.label : '…');
	placeIcon(iconName === 'auto' ? (spec ? spec.icon : 'gauge') : iconName);

	// ---- updating ----
	const render = (u: Update): void => {
		if (destroyed || !spec) return;
		const hit = u.values[spec.field];
		const d = computeDisplay(cfg, spec, hit ? hit.v : null, hit ? hit.t : null, now());

		root.classList.toggle('is-stale', d.stale);
		root.classList.toggle('is-error', !!u.error);
		if (labelEl) labelEl.textContent = d.label;
		valueText.nodeValue = d.value;
		unitEl.textContent = d.unit;
		unitEl.style.display = d.unit ? '' : 'none';
		if (detailEl) {
			detailEl.textContent = u.error ? 'Data unavailable'
				: d.stale ? 'Data delayed – last reading ' + d.updated
					: d.detail;
		}
		if (updatedEl) updatedEl.textContent = d.updated ? 'Updated ' + d.updated : '';

		if (iconEl) {
			const s = iconEl.style;
			s.setProperty('--acewd-spin', (d.spin === null ? 8 : d.spin) + 's');
			s.setProperty('--acewd-spin-play', d.spin === null || d.stale ? 'paused' : 'running');
			s.setProperty('--acewd-flow', (d.flow === null ? 4 : d.flow) + 's');
			s.setProperty('--acewd-flow-play', d.flow === null || d.stale ? 'paused' : 'running');
			s.setProperty('--acewd-deg', d.deg + 'deg');
			s.setProperty('--acewd-frac', String(d.fraction));
			s.setProperty('--acewd-pulse', d.pulse + 's');
			s.setProperty('--acewd-glow', d.glow + 'px');
		}
	};

	const start = (): void => {
		if (destroyed || !spec) return;
		const resolved = resolveIcon(iconName, spec);
		if (iconName === 'auto') placeIcon(resolved);
		if (labelEl) labelEl.textContent = cfg.label || spec.label;
		unsubscribe = hub.subscribe(spec.family, spec.field, render);
	};

	if (spec) {
		start();
	} else if (cfg.metric === CUSTOM && cfg.family && cfg.field) {
		// "Other measurement": find its label and unit in the catalogue first.
		catalogue(cfg.rest).then((cat) => {
			const fam = cat.families.find((f) => f.family === cfg.family);
			const fld: FieldInfo | undefined = fam && fam.fields.find((f) => f.name === cfg.field);
			if (!fam || !fld) throw new Error('Unknown measurement');
			spec = customSpec(cfg.family, fld);
			start();
		}).catch(() => {
			if (labelEl) labelEl.textContent = 'Measurement unavailable';
			root.classList.add('is-error');
		});
	} else {
		if (labelEl) labelEl.textContent = 'Choose a measurement';
		root.classList.add('is-error');
	}

	return {
		destroy(): void {
			destroyed = true;
			if (unsubscribe) unsubscribe();
			host.innerHTML = '';
		}
	};
}

/** Turn every `.acewd-reading[data-config]` on the page into a live tile. */
export function initReadings(root: ParentNode = document): Mounted[] {
	const out: Mounted[] = [];
	root.querySelectorAll<HTMLElement>('.acewd-reading[data-config]').forEach((el) => {
		if (el.getAttribute('data-mounted')) return;
		let cfg: ReadingConfig;
		try {
			cfg = JSON.parse(el.getAttribute('data-config') || '') as ReadingConfig;
		} catch (e) {
			return;
		}
		el.setAttribute('data-mounted', '1');
		out.push(mountReading(el, cfg));
	});
	return out;
}
