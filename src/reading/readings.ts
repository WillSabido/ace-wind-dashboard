import { catalogue, errorInfo, request } from '../api';
import type { DataResponse, Latest } from '../types';
import { lastVal, nowSeconds } from '../util';

/** Newest readings for one data set, delivered to every subscriber of it. */
export interface Update {
	values: Record<string, Latest | null>;
	/** Timestamp of the newest reading across all fields, or null. */
	newest: number | null;
	error: string | null;
}

export type Listener = (u: Update) => void;

interface Sub {
	field: string;
	cb: Listener;
}

interface Group {
	family: string;
	subs: Sub[];
	timer: number | undefined;
	busy: boolean;
	fail: number;
	retryAfter: number;
	last: Update | null;
}

/**
 * One poller for the whole page. Any number of tiles that read the same data set share a single request
 * (asking for the union of their fields), so ten tiles cost the same as one.
 */
export class ReadingHub {
	private readonly groups: Record<string, Group> = {};
	private listening = false;

	constructor(private readonly rest: string, private readonly liveRefresh: number) {}

	/** Start receiving readings of `field` in `family`. Returns an unsubscribe function. */
	subscribe(family: string, field: string, cb: Listener): () => void {
		let g = this.groups[family];
		if (!g) {
			g = this.groups[family] = { family, subs: [], timer: undefined, busy: false, fail: 0, retryAfter: 0, last: null };
		}
		const isNewField = !g.subs.some((s) => s.field === field);
		const sub: Sub = { field, cb };
		g.subs.push(sub);
		this.watchVisibility();

		if (g.last) {
			// A tile added later gets the latest known values straight away.
			const snapshot = g.last;
			window.setTimeout(() => { if (g.subs.indexOf(sub) >= 0) cb(snapshot); }, 0);
		}
		if (g.subs.length === 1 || (isNewField && !g.busy)) {
			window.clearTimeout(g.timer);
			g.timer = window.setTimeout(() => this.poll(g), 0);
		}

		return () => {
			g.subs = g.subs.filter((s) => s !== sub);
			if (!g.subs.length) {
				window.clearTimeout(g.timer);
				delete this.groups[family];
			}
		};
	}

	private watchVisibility(): void {
		if (this.listening) return;
		this.listening = true;
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) return;
			Object.keys(this.groups).forEach((k) => {
				const g = this.groups[k];
				window.clearTimeout(g.timer);
				if (!g.busy) this.poll(g);
			});
		});
	}

	private poll(g: Group): void {
		window.clearTimeout(g.timer);
		if (!g.subs.length || g.busy) return;
		if (document.hidden) return;   // resumed by the visibilitychange listener

		g.busy = true;
		let intervalS = Math.max(1, this.liveRefresh);

		catalogue(this.rest).then((cat) => {
			const f = cat.families.find((x) => x.family === g.family);
			if (!f) throw Object.assign(new Error('Unknown data set: ' + g.family), { status: 404 });
			const res = f.resolutions[0];
			intervalS = res.seconds <= 1 ? Math.max(1, this.liveRefresh) : Math.max(res.refresh, 5);
			const fields = g.subs.map((s) => s.field).filter((v, i, a) => a.indexOf(v) === i);
			return request<DataResponse>(this.rest, 'data', {
				family: g.family, resolution: res.resolution, limit: 5, _b: nowSeconds(),
				fields: fields.join(','), asset: f.scope === 'asset' ? f.assets[0] : ''
			});
		}).then((d) => {
			g.fail = 0;
			const values: Record<string, Latest | null> = {};
			let newest: number | null = null;
			g.subs.forEach((s) => {
				const v = lastVal(d, s.field);
				values[s.field] = v;
				if (v && (newest === null || v.t > newest)) newest = v.t;
			});
			this.deliver(g, { values, newest, error: null });
		}).catch((e: unknown) => {
			g.fail += 1;
			const info = errorInfo(e);
			if (info.retry) g.retryAfter = info.retry * 1000;
			console.warn('[ACE dashboard] live reading failed:', info.status ? 'HTTP ' + info.status + ': ' + info.message : info.message);
			this.deliver(g, { values: {}, newest: null, error: info.message || 'Data unavailable' }, false);
		}).then(() => {
			g.busy = false;
			if (!g.subs.length) return;
			let delay = g.fail ? Math.min(60000, intervalS * 1000 * Math.pow(2, Math.min(g.fail, 5))) : intervalS * 1000;
			if (g.retryAfter) { delay = Math.max(delay, g.retryAfter); g.retryAfter = 0; }
			g.timer = window.setTimeout(() => this.poll(g), delay);
		});
	}

	private deliver(g: Group, u: Update, remember = true): void {
		if (remember) g.last = u;
		g.subs.slice().forEach((s) => s.cb(u));
	}
}

const hubs: Record<string, ReadingHub> = {};

/** The shared hub for a REST base on this page. */
export function hubFor(rest: string, liveRefresh: number): ReadingHub {
	if (!hubs[rest]) hubs[rest] = new ReadingHub(rest, liveRefresh);
	return hubs[rest];
}
