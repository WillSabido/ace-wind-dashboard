import type { Catalogue } from '../types';

export type Layout = 'left' | 'right' | 'top' | 'background';
export type IconName = 'auto' | 'turbine' | 'wind' | 'compass' | 'bolt' | 'gauge' | 'image' | 'none';
export type BuiltInIcon = 'turbine' | 'wind' | 'compass' | 'bolt' | 'gauge';
export type DirFormat = 'both' | 'compass' | 'degrees';

/** The block's saved attributes (defaults live in blocks/live-reading/block.json). */
export interface ReadingAttrs {
	/** A preset key, or "custom" together with `family` + `field`. */
	metric: string;
	family: string;
	field: string;
	unit: string;
	/** -1 = automatic per unit. */
	decimals: number;
	showLabel: boolean;
	label: string;
	showDetail: boolean;
	showUpdated: boolean;
	directionFormat: DirFormat;
	icon: IconName;
	iconUrl: string;
	iconColor: string;
	layout: Layout;
	iconSize: number;
	animate: boolean;
}

/** Site-wide values the PHP side supplies. */
export interface ReadingEnv {
	rest: string;
	ratedKw: number;
	liveRefresh: number;
	tz: string;
}

/** What the front end receives in `data-config`. */
export type ReadingConfig = ReadingAttrs & ReadingEnv;

/* ---- Minimal typing of the WordPress editor globals we use (all components are `any`). ---- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any;

export interface WpGlobal {
	blocks: { registerBlockType(name: string, settings: Record<string, Any>): void };
	element: {
		createElement: (type: Any, props?: Any, ...children: Any[]) => Any;
		Fragment: Any;
		useRef: <T>(initial: T | null) => { current: T | null };
		useEffect: (fn: () => void | (() => void), deps?: Any[]) => void;
		useState: <T>(initial: T) => [T, (v: T) => void];
	};
	blockEditor: Record<string, Any>;
	components: Record<string, Any>;
	i18n: { __: (text: string, domain?: string) => string };
}

declare global {
	interface Window {
		/** Printed by PHP before the editor script. */
		ACE_WIND_BLOCK?: ReadingEnv;
		wp?: WpGlobal;
	}
}

export type { Catalogue };
